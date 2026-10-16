"""Private original-photo archive. No S3 credentials, public sharing or Sanity writes."""
import hashlib
import json
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
import export_storage as drive
import google_connection as google

NAME = 'KMtein26'
MAX_PHOTO = 15_000_000
TYPES = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','image/avif':'avif'}
LOCK = threading.RLock()
SLOTS = threading.BoundedSemaphore(2)
TOKEN = {}


def initialize(c):
    c.executescript('''
        CREATE TABLE IF NOT EXISTS km_archive_config(id INTEGER PRIMARY KEY CHECK(id=1),instance TEXT NOT NULL,account TEXT,folder TEXT,url TEXT);
        CREATE TABLE IF NOT EXISTS km_archive_photos(id TEXT PRIMARY KEY,file_id TEXT NOT NULL,owner TEXT NOT NULL,photo TEXT NOT NULL,
            mime TEXT NOT NULL,size INTEGER NOT NULL,md5 TEXT NOT NULL,sha256 TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0);
    ''')
    c.execute('INSERT OR IGNORE INTO km_archive_config(id,instance) VALUES(1,?)',(uuid.uuid4().hex,))


def config(s):
    with s.db() as c:return dict(c.execute('SELECT * FROM km_archive_config WHERE id=1').fetchone())


def row(s, ident):
    with s.db() as c:
        result=c.execute('SELECT * FROM km_archive_photos WHERE id=?',(ident,)).fetchone()
        return dict(result) if result else None


def identity(owner, photo):
    if not re.fullmatch('[a-f0-9]{64}',owner or '') or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',photo or ''):
        raise ValueError('Ongeldige fotoverwijzing.')
    return hashlib.sha256(('2026/'+owner+'/'+photo).encode()).hexdigest()


def token(s):
    with google.LOCK:
        stamp=(s.DATA/'google-connection.bin').stat().st_mtime_ns if (s.DATA/'google-connection.bin').exists() else 0
        key=(str(s.DATA),stamp)
        cached=TOKEN.get(key)
        if cached and cached[2]>time.monotonic():return cached[:2]
        access,account=drive.connection(s,config(s)['account'])
        TOKEN.clear();TOKEN[key]=(access,account,time.monotonic()+60)
        return access,account


def setup(s):
    with LOCK,drive.time_budget(80):
        cfg=config(s);access,account=token(s)
        if cfg['account'] and cfg['account']!=account:raise ValueError('Gebruik het oorspronkelijke Google-account voor het fotoarchief.')
        if not cfg['folder']:
            cfg.update(account=account,folder=drive.generated_id(access))
            with s.db() as c:c.execute('UPDATE km_archive_config SET account=?,folder=? WHERE id=1',(account,cfg['folder']))
        item=drive.metadata(access,cfg['folder'],missing=True)
        if item is None:
            drive.request_json(drive.API+'files?fields=id',access,'POST',{
                'id':cfg['folder'],'name':NAME,'mimeType':drive.FOLDER_MIME,'appProperties':{'kmArchive':cfg['instance']}},conflict=True)
            item=drive.metadata(access,cfg['folder'])
        if item.get('trashed') or item.get('mimeType')!=drive.FOLDER_MIME or item.get('appProperties',{}).get('kmArchive')!=cfg['instance']:
            raise ValueError('Herstel de oorspronkelijke fotoarchiefmap in Drive.')
        url=item.get('webViewLink','')
        if url and not re.fullmatch(r'https://drive\.google\.com/drive/(?:u/\d+/)?folders/[A-Za-z0-9_-]+(?:\?[^\s]*)?',url):url=''
        with s.db() as c:c.execute('UPDATE km_archive_config SET url=? WHERE id=1',(url or cfg.get('url'),))
        quota=drive.request_json(drive.API+'about?fields=storageQuota',access).get('storageQuota',{})
        return {'folderName':NAME,'folderUrl':url or cfg.get('url'), 'freeBytes':max(0,int(quota['limit'])-int(quota.get('usage',0))) if quota.get('limit') else None}


def verify(item, photo, cfg, allow_trashed=False):
    if (not item or item.get('id')!=photo['file_id'] or (item.get('trashed') and not allow_trashed)
            or item.get('mimeType')!=photo['mime'] or str(item.get('size'))!=str(photo['size'])
            or item.get('md5Checksum')!=photo['md5']
            or cfg['folder'] not in item.get('parents',[])
            or (item.get('sha256Checksum') and item['sha256Checksum']!=photo['sha256'])
            or item.get('appProperties',{}).get('kmPhoto')!=photo['id']
            or item.get('appProperties',{}).get('kmArchive')!=cfg['instance']):
        raise ValueError('De Drive-foto is niet bevestigd. Het origineel op de hosting blijft behouden.')


def save(s, ident, env):
    owner=env.get('HTTP_X_KM_OWNER','');photo=env.get('HTTP_X_KM_PHOTO','');mime=env.get('CONTENT_TYPE','').split(';')[0]
    if identity(owner,photo)!=ident or mime not in TYPES:raise ValueError('Ongeldige foto of bestandssoort.')
    size=int(env.get('CONTENT_LENGTH') or 0)
    if not 0<size<=MAX_PHOTO:raise ValueError('Een archieffoto mag maximaal 15 MB zijn.')
    expected=(env.get('HTTP_X_KM_MD5',''),env.get('HTTP_X_KM_SHA256',''))
    if not re.fullmatch('[a-f0-9]{32}',expected[0]) or not re.fullmatch('[a-f0-9]{64}',expected[1]):raise ValueError('Fotocontrole ontbreekt.')
    existing=row(s,ident)
    if existing and (existing['trashed'] or (existing['size'],existing['md5'],existing['sha256'],existing['mime'])!=(size,*expected,mime)):
        raise ValueError('Deze foto is verwijderd of hoort bij een andere versie.')
    s.ensure_capacity(size)
    directory=s.DATA/'km-transfer';directory.mkdir(exist_ok=True)
    temp=None
    try:
        with tempfile.NamedTemporaryFile(prefix='photo-',suffix='.tmp',dir=directory,delete=False) as output:
            temp=Path(output.name);remaining=size
            while remaining:
                chunk=env['wsgi.input'].read(min(1024*1024,remaining))
                if not chunk:raise ValueError('De foto is onvolledig ontvangen.')
                output.write(chunk);remaining-=len(chunk)
        if drive.fingerprints(temp)!=(size,*expected):raise ValueError('De ontvangen foto wijkt af; het origineel blijft op de hosting.')
        cfg=config(s)
        if not cfg['folder']:raise ValueError('Maak eerst de fotoarchiefmap aan.')
        access,account=token(s)
        if account!=cfg['account']:raise ValueError('Het gekoppelde Google-account is gewijzigd.')
        if existing is None:
            with LOCK,s.db() as c:
                existing=row(s,ident)
                if existing is None:
                    existing={'id':ident,'file_id':drive.generated_id(access),'owner':owner,'photo':photo,'mime':mime,'size':size,'md5':expected[0],'sha256':expected[1],'verified':0,'trashed':0}
                    c.execute('INSERT INTO km_archive_photos VALUES(:id,:file_id,:owner,:photo,:mime,:size,:md5,:sha256,:verified,:trashed)',existing)
        item=drive.metadata(access,existing['file_id'],missing=True)
        if item is None:
            if existing['verified']:raise ValueError('De eerder opgeslagen foto ontbreekt in Drive. Herstel de toegang.')
            drive.upload(temp,{**existing,'folder':cfg['folder']},{'instance':cfg['instance']},'Foto',access,mime=mime,
                         properties={'kmPhoto':ident,'kmArchive':cfg['instance']},name=photo+'.'+TYPES[mime])
            item=drive.metadata(access,existing['file_id'])
        verify(item,existing,cfg)
        with s.db() as c:c.execute('UPDATE km_archive_photos SET verified=1 WHERE id=?',(ident,))
        return {'verified':True,'id':ident,'size':size,'md5':expected[0],'sha256':expected[1],'type':mime}
    finally:
        if temp:temp.unlink(missing_ok=True)


def download(s, ident):
    photo=row(s,ident)
    if not photo or not photo['verified'] or photo['trashed']:raise ValueError('Archieffoto niet beschikbaar.')
    access,_=token(s);verify(drive.metadata(access,photo['file_id']),photo,config(s))
    try:
        with drive.open_request(drive.API+'files/'+photo['file_id']+'?alt=media',access) as response:raw=response.read(photo['size']+1)
    except HTTPError:raise ValueError('De archieffoto kan nu niet uit Drive worden opgehaald.') from None
    if len(raw)!=photo['size'] or hashlib.sha256(raw).hexdigest()!=photo['sha256']:raise ValueError('De opgehaalde foto is onvolledig of gewijzigd.')
    return raw,photo['mime']


def trash(s, ident):
    with LOCK:
        photo=row(s,ident)
        if not photo:return {'ok':True}
        access,_=token(s);item=drive.metadata(access,photo['file_id'],missing=True)
        if item is not None:
            verify(item,photo,config(s),allow_trashed=True)
            if not item.get('trashed'):drive.request_json(drive.API+'files/'+photo['file_id']+'?fields=id,trashed',access,'PATCH',{'trashed':True})
            if not drive.metadata(access,photo['file_id']).get('trashed'):raise ValueError('Verwijderen van de archieffoto is niet bevestigd.')
        elif photo['verified']:raise ValueError('De archieffoto is niet bereikbaar. De verwijdering is nog niet bevestigd.')
        with s.db() as c:c.execute('UPDATE km_archive_photos SET trashed=1 WHERE id=?',(ident,))
        return {'ok':True}


def handle(s, path, env, respond):
    """Called only after the private gateway header has been verified."""
    if not SLOTS.acquire(blocking=False):return respond(429,{'error':'Fotoarchief is bezig. Probeer opnieuw.'})
    try:
        with drive.time_budget(90):
            method=env['REQUEST_METHOD']
            if path=='/internal/km-archive/setup' and method=='POST':return respond(200,setup(s))
            match=re.fullmatch('/internal/km-archive/photo/([a-f0-9]{64})(/trash)?',path)
            if not match:return respond(404,{'error':'Archiefactie niet gevonden.'})
            ident,removal=match.groups()
            if removal and method=='POST':return respond(200,trash(s,ident))
            if not removal and method=='POST':return respond(200,save(s,ident,env))
            if not removal and method=='GET':
                raw,mime=download(s,ident);return respond(200,raw,mime)
            return respond(405,{'error':'Ongeldige methode.'})
    except ValueError as error:return respond(400,{'error':str(error)})
    except Exception:return respond(503,{'error':'Fotoarchief is tijdelijk niet beschikbaar. Bestaande foto’s blijven behouden.'})
    finally:SLOTS.release()
