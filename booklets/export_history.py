"""Notes and recoverable removal of prior exports; PDF contents stay immutable."""
import json,re
from collections import Counter

def initialize(c):
    c.execute("CREATE TABLE IF NOT EXISTS export_details(id TEXT PRIMARY KEY,note TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',deleted_at TEXT)")

def summary(previous,current):
    if not previous:return 'Eerste drukversie.'
    a,b=previous.get('body',{}),current.get('body',{});changes=[]
    if previous.get('title')!=current.get('title'):changes.append('Naam van het boekje gewijzigd')
    if a.get('values')!=b.get('values'):changes.append('Persoonlijke gegevens gewijzigd')
    for key,label in [('format','Formaat'),('duplex','Drukuitvoering'),('contents','Inhoudsopgave'),('pageNumbers','Nummering')]:
        if a.get(key)!=b.get(key):changes.append(label+' gewijzigd')
    old,new=a.get('sections',[]),b.get('sections',[])
    names=lambda rows:[r.get('title','Hoofdstuk') for r in rows]
    before,after=names(old),names(new)
    for counts,label in [(Counter(after)-Counter(before),'Toegevoegd'),(Counter(before)-Counter(after),'Verwijderd')]:
        if counts:changes.append(label+': '+', '.join(counts))
    if before!=after and Counter(before)==Counter(after):changes.append('Hoofdstukvolgorde gewijzigd')
    # Only pair unique chapter names; repeated names are deliberately not guessed.
    for title in set(before)&set(after):
        if before.count(title)!=1 or after.count(title)!=1:continue
        x,y=old[before.index(title)],new[after.index(title)]
        if x==y:continue
        sx,sy=x.get('selected') or x,y.get('selected') or y
        if sx.get('asset')!=sy.get('asset') or sx.get('pageSources')!=sy.get('pageSources'):changes.append('PDF of paginaselectie gewijzigd: '+title)
        elif sx.get('fields')!=sy.get('fields'):changes.append('Opmaak gewijzigd: '+title)
        else:changes.append('Instellingen gewijzigd: '+title)
    return '; '.join(changes)[:2000]+'.' if changes else 'Geen duidelijk herkenbare wijziging in de opgeslagen instellingen.'

def deleted(c,ident):
    row=c.execute('SELECT deleted_at FROM export_details WHERE id=?',(ident,)).fetchone()
    return bool(row and row['deleted_at'])

def action(s,b):
    ident=b.get('id','');book=b.get('bookId');operation=b.get('action')
    if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise ValueError('Ongeldige drukversie.')
    cleanup=[];staged=None
    with s.LOCK,s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT * FROM exports WHERE id=? AND book_id=?',(ident,book)).fetchone()
        if not row:raise ValueError('Drukversie niet gevonden bij dit boekje.')
        c.execute('INSERT OR IGNORE INTO export_details(id) VALUES(?)',(ident,))
        if operation=='note':
            note=b.get('note','')
            if not isinstance(note,str) or len(note)>1000:raise ValueError('Gebruik maximaal 1000 tekens voor de opmerking.')
            c.execute('UPDATE export_details SET note=? WHERE id=?',(note.strip(),ident))
        elif operation=='restore':c.execute('UPDATE export_details SET deleted_at=NULL WHERE id=?',(ident,))
        elif operation in ('trash','purge'):
            latest=c.execute('SELECT e.id FROM exports e LEFT JOIN export_details d ON d.id=e.id WHERE e.book_id=? AND d.deleted_at IS NULL ORDER BY e.rowid DESC LIMIT 1',(book,)).fetchone()
            if latest and latest['id']==ident:raise ValueError('De nieuwste drukversie blijft behouden. Maak eerst een nieuwe versie.')
            if operation=='trash':c.execute('UPDATE export_details SET deleted_at=? WHERE id=?',(s.now(),ident))
            else:
                if not deleted(c,ident):raise ValueError('Verplaats deze drukversie eerst naar de prullenbak.')
                import export_storage
                export_storage.trash(s,ident)
                pdf=s.DATA/'exports'/(ident+'.pdf');staged=pdf.with_suffix('.removed')
                if pdf.exists():pdf.replace(staged)
                try:
                    c.execute('DELETE FROM exports WHERE id=?',(ident,));c.execute('DELETE FROM export_details WHERE id=?',(ident,))
                    c.execute('DELETE FROM export_drive WHERE id=?',(ident,));c.commit()
                except Exception:
                    if staged.exists():staged.replace(pdf)
                    raise
                cleanup=[staged,*s.DATA.joinpath('previews').glob('export-'+ident+'-*.png')]
        else:raise ValueError('Ongeldige versieactie.')
    for path in cleanup:path.unlink(missing_ok=True)
    return {'ok':True}
