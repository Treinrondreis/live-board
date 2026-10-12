import io,json,unittest,uuid
from types import SimpleNamespace
from reportlab.pdfgen import canvas
import test_cloud,booking_documents,document_duplicates,export_history
s=test_cloud.cloud.server
ctx=lambda:SimpleNamespace(**vars(s))
def pdf():
    out=io.BytesIO();c=canvas.Canvas(out,pagesize=s.SIZES['A4']);c.drawString(60,700,'Ticket');c.showPage();c.drawString(60,700,'Return');c.showPage();c.save();return out.getvalue()

class VersionToolsTests(unittest.TestCase):
    def test_layout_save_validates_and_keeps_only_reusable_settings(self):
        body={'format':'A4','pageType':'Voorpagina','fields':[{'key':'Titel','type':'text','page':0,'x':10,'y':75,'w':80,'h':8,'size':24,'color':'#ffffff','template':'{{reisnaam}} {{klantachternaam}}'}],'values':{'klantachternaam':'Private customer'},'asset':'customer-pdf'}
        status,_,raw=test_cloud.request('/api/save','POST',json.dumps({'kind':'layout','title':'Mijn voorpagina','body':body}).encode())
        self.assertEqual(status,200,raw);saved=s.obj(json.loads(raw)['id'])['body'];self.assertNotIn('values',saved);self.assertNotIn('asset',saved)
        body['fields'][0]['page']=1;self.assertRaises(ValueError,s.validate_body,'layout',body)

    def exports(self):
        book=uuid.uuid4().hex;ids=[uuid.uuid4().hex for _ in range(2)]
        with s.db() as c:
            for ident in ids:
                c.execute('INSERT INTO exports VALUES(?,?,?,?,?,?)',(ident,book,'Test export',s.now(),'{}','{"pages":2}'))
                (s.DATA/'exports'/(ident+'.pdf')).write_bytes(pdf())
        return book,ids

    def action(self,book,ident,action,**extra):return test_cloud.request('/api/export-status','POST',json.dumps(dict(bookId=book,id=ident,action=action,**extra)).encode())

    def test_previous_export_notes_trash_restore_purge_and_latest_protection(self):
        book,(old,new)=self.exports()
        self.assertEqual(self.action(book,new,'trash')[0],400)
        self.assertEqual(self.action(book,old,'note',note='Tickets gewijzigd')[0],200)
        self.assertEqual(self.action(book,old,'trash')[0],200)
        self.assertEqual(test_cloud.request('/files/export/'+old)[0],404)
        self.assertEqual(test_cloud.request('/digital/'+old)[0],404)
        self.assertEqual(self.action(book,old,'restore')[0],200)
        self.assertEqual(test_cloud.request('/files/export/'+old)[0],200)
        self.assertEqual(self.action(book,old,'purge')[0],400)
        self.assertEqual(self.action(book,old,'trash')[0],200)
        preview=s.DATA/'previews'/('export-'+old+'-0.png');preview.write_bytes(b'preview')
        self.assertEqual(self.action(book,old,'purge')[0],200);self.assertFalse(preview.exists());self.assertFalse((s.DATA/'exports'/(old+'.pdf')).exists())
        self.assertEqual(test_cloud.request('/files/export/'+new)[0],200)
        self.assertEqual(self.action('other-book',new,'note',note='Wrong')[0],400)

    def test_cleanup_still_works_when_application_quota_is_full(self):
        import os
        book,(old,new)=self.exports();os.environ['BOOKLETS_STORAGE_LIMIT']='1'
        try:self.assertEqual(self.action(book,old,'trash')[0],200)
        finally:os.environ.pop('BOOKLETS_STORAGE_LIMIT')

    def test_change_notes_are_specific_and_do_not_include_customer_values(self):
        a={'title':'Test','body':{'values':{'naam':'Private A'},'sections':[{'title':'Tickets','selected':{'asset':'a'}}]}}
        b={'title':'Test','body':{'values':{'naam':'Private B'},'sections':[{'title':'Tickets','selected':{'asset':'b'}}]}}
        result=export_history.summary(a,b);self.assertIn('Persoonlijke gegevens gewijzigd',result);self.assertIn('paginaselectie gewijzigd: Tickets',result);self.assertNotIn('Private',result)
        self.assertIn('Geen duidelijk',export_history.summary(a,a))

    def test_duplicates_use_included_source_pages_and_identical_uploads(self):
        raw=pdf();one=booking_documents.store(ctx(),raw,'Tickets');two=booking_documents.store(ctx(),raw,'Copy')
        section=lambda asset,page,title:{'choice':'document','title':title,'selected':{'asset':asset,'pages':1,'pageSources':[{'asset':asset,'page':page}]}}
        body={'sections':[section(one['asset'],0,'Heenreis'),section(two['asset'],1,'Terugreis')]}
        self.assertEqual(document_duplicates.warnings(ctx(),body),[])
        body['sections'][1]['selected']['pageSources'][0]['page']=0
        warnings=document_duplicates.warnings(ctx(),body);self.assertEqual(len(warnings),1);self.assertIn('Heenreis',warnings[0]);self.assertIn('Terugreis',warnings[0])
        body['sections'][1]['omitted']=True;self.assertEqual(document_duplicates.warnings(ctx(),body),[])
        self.assertEqual(document_duplicates.warnings(ctx(),{'sections':[{'oneOff':True,'title':'Nog geen PDF'}]}),[])

    def test_duplicate_warning_is_in_preflight_and_export_without_blocking(self):
        import preflight
        a=booking_documents.store(ctx(),pdf(),'Tickets')
        section={'oneOff':True,'title':'Ticket','asset':a['asset'],'pages':2,'fields':[]}
        body={'format':'A4','duplex':False,'sections':[section,dict(section,title='Copy')]}
        result=preflight.check(ctx(),body,[]);self.assertEqual(result['errors'],[]);self.assertEqual(len(result['warnings']),2)
        exported=s.make_export({'id':uuid.uuid4().hex,'title':'Test','body':body},{'allowUneven':True,'note':'Controle'})
        self.assertTrue(any('Dubbele documentpagina' in w for w in exported['report']['warnings']))
        with s.db() as c:row=c.execute('SELECT * FROM export_details WHERE id=?',(exported['id'],)).fetchone()
        self.assertEqual(row['note'],'Controle');self.assertEqual(row['summary'],'Eerste drukversie.')

if __name__=='__main__':unittest.main()
