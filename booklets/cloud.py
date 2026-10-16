"""Private WSGI adapter. Seinhuis authenticates every customer-data request."""
import hmac
import json
import os
import re
import shutil
import threading
from email.message import Message
from types import SimpleNamespace
from urllib.parse import urlsplit
from wsgiref.util import FileWrapper
import server

PREFIX='/seinhuis/boekjesmaker'
SECRET=os.environ.get('BOOKLETS_GATEWAY_SECRET','')
if len(SECRET)<32:
    raise RuntimeError('BOOKLETS_GATEWAY_SECRET must contain at least 32 characters')
server.POPPLER=shutil.which('pdftoppm') or server.POPPLER
BUSY=threading.BoundedSemaphore(1)

def page(raw):
    text=raw.decode('utf-8')
    text=re.sub(r'(?<=[\x22\x27`])/(api|files|digital)/',lambda m:PREFIX+m.group(),text)
    return text.replace('/seinhuis-logout-placeholder','/api/admin-security/logout').replace('href="/"','href="'+PREFIX+'/"').encode()

class Handler(server.Handler):
    def auth(self):
        return {'user':{'name':'Seinhuis-beheerder','admin':True}}

    def send(self,status,body,ctype='application/json',headers=None):
        if ctype=='application/json':
            if isinstance(body,dict) and isinstance(body.get('url'),str) and body['url'].startswith('/files/'):
                body={**body,'url':PREFIX+body['url']}
            raw=json.dumps(body,ensure_ascii=False).encode()
        elif ctype.startswith('text/html'):
            raw=page(body)
        else:
            raw=body
        self.result=(status,raw,ctype,headers or {})

class ExportStream:
    """Keep a verified temporary PDF alive only until the HTTP stream closes."""
    def __init__(self,context):
        self.context=context
        self.closed=False
        self.path=context.__enter__()
        try:self.stream=self.path.open('rb')
        except Exception:
            context.__exit__(None,None,None)
            raise
    def read(self,size=-1):return self.stream.read(size)
    def close(self):
        if self.closed:return
        self.closed=True
        try:self.stream.close()
        finally:self.context.__exit__(None,None,None)

def application(environ,start_response):
    def response(status,body,ctype='application/json',headers=None):
        raw=json.dumps(body).encode() if ctype=='application/json' else body
        start_response(str(status)+' '+{200:'OK',400:'Bad Request',401:'Unauthorized',404:'Not Found',405:'Method Not Allowed',413:'Content Too Large',429:'Too Many Requests',500:'Internal Server Error'}.get(status,'Response'),
            [('Content-Type',ctype),('Content-Length',str(len(raw))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),*(headers or {}).items()])
        return [raw]
    path=environ.get('PATH_INFO','/')
    if path=='/health' and environ['REQUEST_METHOD']=='GET':
        return response(200,{'ok':True})
    supplied=environ.get('HTTP_X_BOOKLETS_GATEWAY','')
    if not hmac.compare_digest(supplied.encode(),SECRET.encode()):
        return response(401,{'error':'Geen toegang.'})
    method=environ['REQUEST_METHOD']
    if method not in ('GET','POST','HEAD'):
        return response(405,{'error':'Ongeldige methode.'})
    if path in ('/api/setup','/api/login','/api/users','/api/logout','/api/google/configure'):
        return response(404,{'error':'Beheer dit via Seinhuis of Railway Secrets.'})
    if path=='/api/session':
        return response(200,{'setup':False,'user':{'name':'Seinhuis-beheerder','admin':True},'version':server.APP_VERSION+'-online','cloud':True})
    if path=='/import' and method=='GET' and os.environ.get('BOOKLETS_IMPORT_ENABLED')=='1':
        return response(200,(server.ROOT/'import.html').read_bytes(),'text/html; charset=utf-8')
    try:
        size=int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError:
        return response(400,{'error':'Ongeldige uploadlengte.'})
    if not 0<=size<=50*1024*1024:
        return response(413,{'error':'Maximaal 50 MB per upload.'})
    if path.startswith('/internal/km-archive/'):
        return server.km_archive.handle(server,path,environ,response)
    if path.startswith('/internal/print-orders/'):
        return server.print_orders.handle(server,path,environ,response,ExportStream,start_response)
    # Stream immutable PDFs without retaining the document in memory.
    match=re.fullmatch(r'/files/(asset|export)/([a-f0-9]{32})',path)
    if match and method in ('GET','HEAD'):
        kind,ident=match.groups()
        if kind=='export':
            with server.db() as c:
                if server.export_history.deleted(c,ident):return response(404,{'error':'Deze drukversie staat in de prullenbak.'})
                if not c.execute('SELECT id FROM exports WHERE id=?',(ident,)).fetchone():return response(404,{'error':'Niet gevonden.'})
        filename=server.DATA/('pdfs' if kind=='asset' else 'exports')/(ident+'.pdf')
        stream=None
        try:
            if kind=='export' and not filename.is_file():
                if method=='HEAD':
                    row=server.export_storage.remote(server,ident)
                    if not row or not row['verified']:return response(404,{'error':'Niet gevonden.'})
                    length=row['size']
                else:
                    stream=ExportStream(server.export_storage.pdf(server,ident))
                    length=stream.path.stat().st_size
            else:
                if not filename.is_file():return response(404,{'error':'Niet gevonden.'})
                length=filename.stat().st_size
                if method!='HEAD':stream=filename.open('rb')
        except ValueError as error:
            if stream:stream.close()
            return response(400,{'error':str(error)})
        except Exception:
            if stream:stream.close()
            return response(500,{'error':'De druk-PDF kon niet worden geopend. Probeer opnieuw.'})
        mode='attachment' if 'download=' in environ.get('QUERY_STRING','') else 'inline'
        try:start_response('200 OK',[('Content-Type','application/pdf'),('Content-Length',str(length)),('Content-Disposition',f'{mode}; filename="boekje-{ident[:8]}.pdf"'),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff')])
        except Exception:
            if stream:stream.close()
            raise
        return [] if method=='HEAD' else FileWrapper(stream,64*1024)
    # One mutation/render at a time. Mutations fail fast; the fixed four HTTP
    # threads may briefly wait for previews, which browsers request in parallel.
    heavy=(method=='POST' and path not in ('/api/routes/load','/api/routes/stations','/api/export-cancel')) or path.startswith('/files/') or path=='/google/callback'
    acquired=not heavy or (BUSY.acquire(timeout=30) if method in ('GET','HEAD') and path.startswith('/files/') else BUSY.acquire(blocking=False))
    if not acquired:
        return response(429,{'error':'Er wordt al een boekje of pagina verwerkt. Probeer het zo nog eens.'},headers={'Retry-After':'3'})
    try:
        if method=='POST' and path not in ('/api/export-status','/api/export-storage','/api/export-archive','/api/export-cancel','/api/book-trash','/api/template-status'):server.ensure_capacity(size*3+1024*1024)
        if path.startswith('/api/migration/'):
            import migration
            result=migration.handle(path,environ,server)
            return response(*result)
        handler=Handler.__new__(Handler)
        handler.path=path+('?' + environ['QUERY_STRING'] if environ.get('QUERY_STRING') else '')
        handler.server=SimpleNamespace(server_port=8766)
        handler.headers=Message()
        for key,value in {'Host':'127.0.0.1:8766','Origin':'http://127.0.0.1:8766','X-Booklets':'1','Content-Length':str(size),'Content-Type':environ.get('CONTENT_TYPE','application/json')}.items():handler.headers[key]=value
        handler.rfile=environ['wsgi.input']
        handler.result=(500,b'{"error":"Verwerking mislukt."}','application/json',{})
        (handler.do_POST if method=='POST' else handler.do_GET)()
        status,raw,ctype,headers=handler.result
        return response(status,raw,ctype if ctype!='application/json' else 'application/json; charset=utf-8',headers)
    except ValueError as error:
        return response(400,{'error':str(error)})
    except Exception:
        return response(500,{'error':'Verwerking mislukt. De oorspronkelijke bestanden blijven bewaard.'})
    finally:
        if heavy:BUSY.release()
