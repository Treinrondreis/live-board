"""Only fictional booklets; no live mailbox, Sanity or external publication."""
import io,json,time,unittest
from types import SimpleNamespace
from urllib.parse import urlsplit
from unittest.mock import patch
from pypdf import PdfReader
from reportlab.pdfgen import canvas
import test_cloud as fixtures
import travel_sites
s=fixtures.cloud.server

class TravelSiteTests(unittest.TestCase):
    def setUp(self):travel_sites.ATTEMPTS.clear()
    def export(self,title='Example journey',ticket=False):
        stream=io.BytesIO();cv=canvas.Canvas(stream,pagesize=s.SIZES['A4']);cv.drawString(30,790,'Fictional journey information');cv.drawString(30,765,'Example Town to Other Town');cv.showPage();cv.save()
        status,_,raw=fixtures.request('/api/upload','POST',stream.getvalue());self.assertEqual(status,200);asset=json.loads(raw)
        body={'format':'A4','outputMode':'screen','sections':[{'asset':asset['id'],'pages':1,'fields':[],'title':'Practical information','values':{}}]}
        if ticket:
            section=body['sections'][0]
            section['pageSources']=[{'asset':asset['id'],'page':0,'travelDate':'2028-06-08','dateNeedsReview':False}]
            body['sections']=[{'choice':'document','documentKind':'nsTickets','title':'Train tickets','selected':section}]
        status,_,raw=fixtures.request('/api/save','POST',json.dumps({'kind':'book','title':title,'body':body}).encode());self.assertEqual(status,200);book=json.loads(raw)
        status,_,raw=fixtures.request('/api/export','POST',json.dumps({**book,'allowUneven':True}).encode());self.assertEqual(status,200,raw);result=json.loads(raw)
        self.assertIn('personalWebsite',result,raw);return book,result
    def customer(self,site,action='',method='GET',body=None,token='',owner=False,authorized=True):
        ident=site['url'].split('/')[-1];status=[];raw=json.dumps(body or {}).encode()
        env={'PATH_INFO':'/internal/travel-sites/'+ident+('/'+action if action else ''),'REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(raw)) if method=='POST' else '0','wsgi.input':io.BytesIO(raw)}
        if authorized:env['HTTP_X_BOOKLETS_GATEWAY']='test-secret-'*4
        if token:env['HTTP_X_TRAVEL_SITE_SESSION']=token
        if owner:env['HTTP_X_TRAVEL_SITE_OWNER']='1'
        result=fixtures.cloud.application(env,lambda code,headers:status.extend([int(code.split()[0]),dict(headers)]))
        try:raw=b''.join(result)
        finally:
            if hasattr(result,'close'):result.close()
        return *status,raw
    def login(self,site):
        status,headers,raw=self.customer(site,'login','POST',{'code':site['code']});self.assertEqual(status,200,raw)
        self.assertIn('HttpOnly; Secure; SameSite=Strict',headers['Set-Cookie']);return headers['Set-Cookie'].split('=',1)[1].split(';')[0]
    def manage(self,export,action):
        status,_,raw=fixtures.request('/api/travel-site','POST',json.dumps({'id':export['id'],'action':action}).encode());self.assertEqual(status,200,raw);return json.loads(raw)
    def test_export_automatically_creates_versioned_encrypted_site_and_downloads_unchanged_pdf(self):
        book,result=self.export();site=result['personalWebsite'];token=self.login(site)
        status,_,raw=self.customer(site,'data',token=token);self.assertEqual(status,200);data=json.loads(raw)
        self.assertEqual(data['title'],'Example journey');self.assertIn('Fictional journey information',data['chapters'][0]['text']);self.assertNotIn('pageNumbers',data['chapters'][0])
        self.assertEqual(self.customer(site,'book',token=token)[2],fixtures.request('/files/export/'+result['id'])[2])
        chapter=self.customer(site,'chapter/0',token=token);self.assertEqual(chapter[0],200);self.assertEqual(len(PdfReader(io.BytesIO(chapter[2])).pages),1)
        with s.db() as c:row=c.execute('SELECT * FROM travel_sites WHERE export_id=?',(result['id'],)).fetchone()
        self.assertNotIn(site['code'].encode(),row['code']);self.assertNotEqual(row['digest'],site['code'])
        status,_,raw=fixtures.request('/api/export','POST',json.dumps({**book,'allowUneven':True}).encode());self.assertEqual(status,200)
        second=json.loads(raw)['personalWebsite'];self.assertNotEqual(second['url'],site['url']);self.assertNotEqual(second['code'],site['code'])
    def test_no_customer_data_or_files_without_code_and_no_internal_access_without_gateway(self):
        _,result=self.export('PRIVATE EXAMPLE NAME');site=result['personalWebsite']
        page=self.customer(site);self.assertEqual(page[0],200);self.assertNotIn(b'PRIVATE EXAMPLE NAME',page[2]);self.assertIn('sha256-',page[1]['Content-Security-Policy'])
        for action in ('data','book','cover','chapter/0'):
            self.assertEqual(self.customer(site,action)[0],401)
            self.assertEqual(self.customer(site,action,authorized=False)[0],401)
        self.assertEqual(fixtures.request('/api/travel-site','POST',b'{}',authorized=False)[0],401)
    def test_sessions_are_scoped_to_one_export_and_rotating_code_invalidates_previous_sessions(self):
        _,a=self.export('Customer A');_,b=self.export('Customer B');site=a['personalWebsite'];token=self.login(site)
        self.assertEqual(self.customer(b['personalWebsite'],'data',token=token)[0],401)
        updated=self.manage(a,'reset');self.assertNotEqual(updated['code'],site['code']);self.assertEqual(self.customer(site,'data',token=token)[0],401)
        self.assertEqual(self.customer(site,'login','POST',{'code':site['code']})[0],401)
        self.assertEqual(self.customer(updated,'data',token=self.login(updated))[0],200)
    def test_disable_expiry_and_export_or_book_trash_block_every_customer_route(self):
        book,result=self.export();site=result['personalWebsite'];token=self.login(site)
        self.manage(result,'disable');self.assertEqual(self.customer(site,'data',token=token)[0],404)
        site=self.manage(result,'enable');token=self.login(site)
        with s.db() as c:c.execute('UPDATE travel_sites SET expires=? WHERE export_id=?',(int(time.time())-1,result['id']))
        self.assertEqual(self.customer(site,'book',token=token)[0],404)
        site=self.manage(result,'enable');token=self.login(site)
        with s.db() as c:c.execute('UPDATE export_details SET deleted_at=? WHERE id=?',(s.now(),result['id']))
        self.assertEqual(self.customer(site,'data',token=token)[0],404)
        with s.db() as c:
            c.execute('UPDATE export_details SET deleted_at=NULL WHERE id=?',(result['id'],))
            c.execute('UPDATE objects SET body=? WHERE id=?',(json.dumps({'deletedAt':s.now()}),book['id']))
        self.assertEqual(self.customer(site,'data',token=token)[0],404)
    def test_wrong_codes_are_rate_limited_and_oversized_or_foreign_paths_are_rejected(self):
        _,result=self.export();site=result['personalWebsite']
        for _ in range(10):self.assertEqual(self.customer(site,'login','POST',{'code':'AAAAAAAAAA'})[0],401)
        self.assertEqual(self.customer(site,'login','POST',{'code':site['code']})[0],429)
        site=self.manage(result,'reset');self.login(site)
        self.assertEqual(self.customer(site,'chapter/999',owner=True)[0],404)
        self.assertEqual(self.customer(site,'chapter/../data',owner=True)[0],404)
    def test_customer_view_is_fixed_snapshot_and_pdf_failure_does_not_lose_completed_export(self):
        book,result=self.export();site=result['personalWebsite'];token=self.login(site)
        with s.db() as c:c.execute('UPDATE objects SET title=? WHERE id=?',('Changed live book',book['id']))
        self.assertEqual(json.loads(self.customer(site,'data',token=token)[2])['title'],'Example journey')
        with patch.object(travel_sites,'ensure',side_effect=ValueError('No sensitive errors in response')):
            status,_,raw=fixtures.request('/api/export','POST',json.dumps({**book,'allowUneven':True}).encode());self.assertEqual(status,200)
            failed=json.loads(raw);self.assertIn('websiteWarning',failed);self.assertNotIn('sensitive',raw.decode());self.assertEqual(fixtures.request('/files/export/'+failed['id'])[0],200)
    def test_chapter_types_and_journey_dates_use_existing_checked_metadata(self):
        m=travel_sites.chapter_metadata({'ticketImport':{},'pageSources':[{'travelDate':'2028-06-08'}]})
        self.assertEqual(m['dates'],['2028-06-08'])
        self.assertEqual(travel_sites.category({'ticketImport':{'provider':'Example'}}),'tickets')
        self.assertEqual(travel_sites.category({'bookingDocuments':[{'kind':'voucher'}]}),'hotels')

    def test_purging_old_export_removes_private_website_content_and_credentials(self):
        book,result=self.export();site=result['personalWebsite']
        status,_,raw=fixtures.request('/api/export','POST',json.dumps({**book,'allowUneven':True}).encode());self.assertEqual(status,200)
        for action in ('trash','purge'):
            status,_,raw=fixtures.request('/api/export-status','POST',json.dumps({'id':result['id'],'bookId':book['id'],'action':action}).encode());self.assertEqual(status,200,raw)
        with s.db() as c:self.assertIsNone(c.execute('SELECT id FROM travel_sites WHERE export_id=?',(result['id'],)).fetchone())
        self.assertEqual(self.customer(site)[0],404)

    def test_manual_ticket_upload_stays_a_pdf_with_checked_day_filter_and_no_barcode_text_dump(self):
        _,result=self.export(ticket=True);site=result['personalWebsite'];token=self.login(site)
        status,_,raw=self.customer(site,'data',token=token);self.assertEqual(status,200);chapter=json.loads(raw)['chapters'][0]
        self.assertEqual(chapter['kind'],'tickets');self.assertEqual(chapter['dates'],['2028-06-08']);self.assertEqual(chapter['text'],'')
        self.assertTrue(self.customer(site,'chapter/0',token=token)[2].startswith(b'%PDF-'))

    def test_existing_pdf_uses_only_its_saved_snapshot_to_recover_chapter_types_and_dates(self):
        _,result=self.export(ticket=True)
        with s.db() as c:
            row=c.execute('SELECT report,snapshot FROM exports WHERE id=?',(result['id'],)).fetchone();report=json.loads(row['report']);snapshot=json.loads(row['snapshot'])
            for chapter in report['digitalChapters']:chapter.pop('kind',None);chapter.pop('dates',None)
            section=snapshot['body']['sections'][0];section.pop('_websiteKind',None);section['ticketImport']={'provider':'fictional'}
            c.execute('UPDATE exports SET report=?,snapshot=? WHERE id=?',(json.dumps(report),json.dumps(snapshot),result['id']));c.execute('DELETE FROM travel_sites WHERE export_id=?',(result['id'],))
        site=self.manage(result,'ensure');status,_,raw=self.customer(site,'data',token=self.login(site));self.assertEqual(status,200)
        chapter=json.loads(raw)['chapters'][0];self.assertEqual(chapter['kind'],'tickets');self.assertEqual(chapter['dates'],['2028-06-08']);self.assertEqual(chapter['text'],'')

if __name__=='__main__':unittest.main()
