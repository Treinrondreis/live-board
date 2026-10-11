import json,unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
import ticket_drive,google_connection as connection,booking_documents

class DriveTickets(unittest.TestCase):
    def setUp(self):
        self.ctx=SimpleNamespace(DATA=Path('.'))
        self.payload={'provider':'obb','query':'0726369981792179','references':[]}
    def test_exact_references_provider_and_invoice_exclusions(self):
        self.assertTrue(ticket_drive.ticket_name('Tickets OBB 0726369981792179 2026-10-09.pdf','obb'))
        self.assertTrue(ticket_drive.ticket_name('OEBBTicket-0726369981792179.pdf','obb'))
        self.assertFalse(ticket_drive.ticket_name('VSt-Bescheinigung_OEBBTicket-0726369981792179.pdf','obb'))
        self.assertFalse(ticket_drive.ticket_name('Tickets DB 0726369981792179.pdf','obb'))
        self.assertTrue(ticket_drive.matches('Tickets OBB 0726 3699 8179 2179 2026-10-09.pdf','0726369981792179'))
        self.assertFalse(ticket_drive.matches('Tickets OBB 10726369981792179.pdf','0726369981792179'))
    def test_search_latest_exact_filename_and_all_separate_ticket_pdfs(self):
        rows=[{'id':i,'name':n,'mimeType':'application/pdf'} for i,n in [('new','Tickets OBB 0726369981792179.pdf'),('other','Tickets OBB 0726369981792179 traveller2.pdf'),('old','Tickets OBB 0726369981792179.pdf'),('wrong','Tickets DB 0726369981792179.pdf'),('invoice','OBB invoice 0726369981792179.pdf'),('unrelated','Tickets OBB 9999999999999999.pdf')]]
        with patch.object(connection,'status',return_value={'canReadDrive':True}),patch.object(connection,'token',return_value='test'),patch.object(connection,'request',return_value=json.dumps({'files':rows}).encode()) as request:
            r=ticket_drive.search(self.ctx,self.payload)
        self.assertEqual([x['id'] for x in r['items']],['new','other'])
        self.assertEqual(r['items'][0]['reference'],self.payload['query'])
        self.assertIn('mimeType',request.call_args.args[0])
    def test_download_revalidates_provider_reference_mime_and_revision(self):
        payload={**self.payload,'id':'test-file-id','updatedAt':'new'}
        for info in [{'name':'Tickets OBB 9999999999999999.pdf','mimeType':'application/pdf'}, {'name':'Tickets DB 0726369981792179.pdf','mimeType':'application/pdf'}, {'name':'Tickets OBB 0726369981792179.pdf','mimeType':'text/html'}, {'name':'Tickets OBB 0726369981792179.pdf','mimeType':'application/pdf','modifiedTime':'old'}]:
            with patch.object(connection,'status',return_value={'canReadDrive':True}),patch.object(connection,'token',return_value='test'),patch.object(connection,'request',return_value=json.dumps(info).encode()) as request:
                self.assertRaises(ValueError,ticket_drive.load,self.ctx,payload)
                self.assertEqual(request.call_count,1)
    def test_download_preserves_original_bytes(self):
        info={'name':'Tickets OBB 0726369981792179.pdf','mimeType':'application/pdf','modifiedTime':'new'};raw=b'%PDF-original'
        with patch.object(connection,'status',return_value={'canReadDrive':True}),patch.object(connection,'token',return_value='test'),patch.object(connection,'request',side_effect=[json.dumps(info).encode(),raw]),patch.object(booking_documents,'store',return_value={'asset':'asset','pages':3}) as store:
            r=ticket_drive.load(self.ctx,{**self.payload,'id':'test-file-id','updatedAt':'new'})
        self.assertEqual(store.call_args.args[1],raw);self.assertEqual(r['pages'],3)
    def test_invalid_inputs_and_missing_drive_scope(self):
        for payload in [{**self.payload,'query':"123' OR x"},{**self.payload,'references':['bad']},{**self.payload,'provider':'evil'}]:self.assertRaises(ValueError,ticket_drive.settings,payload)
        with patch.object(connection,'status',return_value={'canReadDrive':False}):self.assertRaisesRegex(ValueError,'leestoegang',ticket_drive.search,self.ctx,self.payload)
    def test_new_endpoints_require_gateway_authentication(self):
        import test_cloud
        for path in ('/api/tickets/drive-search','/api/tickets/drive-load'):
            self.assertEqual(test_cloud.request(path,'POST',json.dumps(self.payload).encode(),authorized=False)[0],401)

if __name__=='__main__':unittest.main()
