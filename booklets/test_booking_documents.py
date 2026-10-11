import json,unittest
from unittest.mock import patch
from types import SimpleNamespace
from pypdf import PdfReader
import test_cloud,booking_documents,google_connection
s=test_cloud.cloud.server
ctx=SimpleNamespace(**vars(s))

class BookingDocumentTests(unittest.TestCase):
    def test_explicit_sanity_page_break_preserves_both_sides(self):
        def text(value):return {'_type':'block','style':'normal','children':[{'_type':'span','text':value,'marks':[]}]}
        doc={'kind':'letter','title':'Brief','content':[text('FIRST PAGE'),{'_type':'pageBreak'},text('SECOND PAGE')]}
        r=booking_documents.render(ctx,{'document':doc,'format':'A4'});pdf=PdfReader(s.DATA/'pdfs'/f"{r['asset']}.pdf")
        self.assertEqual(len(pdf.pages),2);self.assertIn('FIRST PAGE',pdf.pages[0].extract_text());self.assertIn('SECOND PAGE',pdf.pages[1].extract_text())
    def test_letter_layout_in_both_formats_and_private_api(self):
        doc={'kind':'letter','bookingId':'private.test','documentId':'private.letter','title':'Brief','digest':'test','content':[{'_type':'block','style':'normal','children':[{'_type':'span','text':'Beste Test Reiziger,','marks':[]}]}]}
        for fmt in ('A4','A5'):
            r=booking_documents.render(ctx,{'document':doc,'format':fmt});pdf=PdfReader(s.DATA/'pdfs'/f"{r['asset']}.pdf");self.assertIn('Beste Test Reiziger',pdf.pages[0].extract_text());self.assertAlmostEqual(float(pdf.pages[0].mediabox.height),s.SIZES[fmt][1],places=2);self.assertEqual(r['bookingDocument']['bookingId'],'private.test')
        self.assertEqual(test_cloud.request('/api/booking-documents/render','POST',authorized=False)[0],401)
    def test_templates_never_save_customer_documents_and_export_never_skips_missing_slots(self):
        slots=[{'choice':'document','documentKind':k,'title':k,'options':[],'selected':None} for k in booking_documents.KINDS]
        s.validate_body('template',{'sections':slots,'format':'A4'})
        self.assertRaisesRegex(ValueError,'ontbrekende',s.make_export,{'id':'test','body':{'sections':slots,'format':'A4'}},{'skipChoices':True,'allowUneven':True,'dryRun':True})
        slots[0]['selected']={'asset':'anything'}
        self.assertRaisesRegex(ValueError,'Klantdocumenten',s.validate_body,'template',{'sections':slots,'format':'A4'})
    def test_drive_scope_is_explicit_and_preserved(self):
        with patch.object(google_connection,'read',return_value={'client_id':'test','scope':google_connection.CREATE_SCOPE}):
            self.assertNotIn('drive.readonly',google_connection.connect(s.DATA,8766))
            self.assertIn('drive.readonly',google_connection.connect(s.DATA,8766,drive=True))
        with patch.object(google_connection,'status',return_value={'canReadDrive':False}):
            self.assertRaisesRegex(ValueError,'leestoegang',booking_documents.drive_search,ctx,{'number':'1234','kind':'schedule'})
    def test_drive_filters_number_boundaries_and_revalidates_before_download(self):
        rows=[{'id':'a','name':'1234A tijdlijn.pdf','mimeType':'application/pdf'},{'id':'b','name':'91234A voucher.pdf','mimeType':'application/pdf'},{'id':'c','name':'1234 voucher.pdf','mimeType':'application/pdf'}]
        with patch.object(google_connection,'status',return_value={'canReadDrive':True}),patch.object(google_connection,'token',return_value='test-only'),patch.object(google_connection,'request',return_value=json.dumps({'files':rows}).encode()):
            r=booking_documents.drive_search(ctx,{'number':'1234A','kind':'schedule'});self.assertEqual([f['id'] for f in r['items']],['a','c'])
        with patch.object(google_connection,'status',return_value={'canReadDrive':True}),patch.object(google_connection,'token',return_value='test-only'),patch.object(google_connection,'request',return_value=json.dumps({'name':'9999 voucher.pdf'}).encode()):
            self.assertRaisesRegex(ValueError,'ander boekingsnummer',booking_documents.drive_load,ctx,{'number':'1234A','id':'test-file-id'})
