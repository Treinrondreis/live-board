import json,unittest
from unittest.mock import patch
from types import SimpleNamespace
from pypdf import PdfReader
import test_cloud,booking_documents,google_connection
s=test_cloud.cloud.server
ctx=SimpleNamespace(**vars(s))

class BookingDocumentTests(unittest.TestCase):
    def test_house_voucher_preserves_table_values_and_brand_in_both_formats(self):
        import pdfplumber,io
        doc={'kind':'voucher','title':'Hotel voucher: Test Hotel','content':[{'_type':'block','style':'h3','children':[{'_type':'span','text':'Hotelvoucher'}]},{'_type':'block','style':'h2','children':[{'_type':'span','text':'Test Hotel Wien'}]},{'_type':'table','rows':[{'cells':['Gereserveerd op naam','Test Reiziger']},{'cells':['Check-in','20-11-2026 - Vanaf 15:00 uur']},{'cells':['Kamers','1x Standaardkamer']}]}]}
        for fmt in ('A4','A5'):
            r=booking_documents.render(ctx,{'document':doc,'format':fmt})
            with pdfplumber.open(io.BytesIO((s.DATA/'pdfs'/f"{r['asset']}.pdf").read_bytes())) as pdf:
                page=pdf.pages[0];text=page.extract_text()
                for value in ('Hotelvoucher','Test Hotel Wien','Test Reiziger','20-11-2026','1x Standaardkamer','contact@treinrondreis.nl'):self.assertIn(value,text)
                self.assertTrue(page.images)
                words=page.extract_words();label=next(w for w in words if w['text']=='Gereserveerd');value=next(w for w in words if w['text']=='Reiziger')
                self.assertGreater(value['x0'],label['x0']+120)
                self.assertAlmostEqual(value['top'],label['top'],delta=1)
                self.assertFalse(page.lines)
            self.assertEqual(r['bookingDocument']['layout'],'treinrondreis-voucher-1')
        doc['content'][-1]['rows'][0]['cells'][0]={'bad':True}
        self.assertRaisesRegex(ValueError,'tabelcel',booking_documents.render,ctx,{'document':doc,'format':'A4'})
    def test_import_warnings_are_preserved_outside_the_voucher_pdf(self):
        warning='Het reserveringsnummer is leeg gelaten.'
        doc={'kind':'voucher','title':'Hotelvoucher','warnings':[warning],'content':[{'_type':'block','children':[{'_type':'span','text':'Hotelvoucher Premier Inn'}]}]}
        result=booking_documents.render(ctx,{'document':doc,'format':'A4'})
        self.assertIn(warning,result['warnings']);self.assertTrue(any('opnieuw opgemaakt' in w for w in result['warnings']))
        self.assertNotIn(warning,PdfReader(s.DATA/'pdfs'/f"{result['asset']}.pdf").pages[0].extract_text())
        doc['warnings']=['x'*2001]
        self.assertRaisesRegex(ValueError,'documentwaarschuwingen',booking_documents.render,ctx,{'document':doc,'format':'A4'})
    def test_unreviewed_drive_voucher_blocks_pdf_generation(self):
        doc={'kind':'voucher','title':'Voucher','content':[{'_type':'block','children':[{'_type':'span','text':'Voucher'}]}]}
        result=booking_documents.render(ctx,{'document':doc,'format':'A4'})
        selected={'asset':result['asset'],'pages':result['pages'],'title':'Vouchers','fields':[],'reviewRequired':True}
        body={'format':'A4','sections':[{'choice':'document','documentKind':'voucher','selected':selected}]}
        self.assertRaisesRegex(ValueError,'Controleer eerst',s.make_export,{'id':'test','body':body},{'skipChoices':True,'allowUneven':True,'dryRun':True})
        report=s.preflight.check(s,body,[])
        self.assertTrue(any('Controleer deze voucher' in e['message'] for e in report['errors']))
    def test_multiple_voucher_sources_must_all_belong_to_the_selected_booking(self):
        doc={'kind':'voucher','title':'Voucher','content':[{'_type':'block','children':[{'_type':'span','text':'Voucher'}]}]}
        result=booking_documents.render(ctx,{'document':doc,'format':'A4'})
        selected={'asset':result['asset'],'pages':result['pages'],'oneOff':True,'fields':[],'bookingDocuments':[{'bookingId':'private.customer','documentId':'v1'},{'bookingId':'private.customer','documentId':'v2'}]}
        body={'format':'A4','sanityBooking':{'id':'private.customer'},'sections':[{'choice':'document','documentKind':'voucher','selected':selected}]}
        s.validate_body('book',body)
        selected['bookingDocuments'][1]['bookingId']='private.other'
        self.assertRaisesRegex(ValueError,'andere Sanity-boeking',s.validate_body,'book',body)
        selected['bookingDocuments']='not-a-source-list'
        self.assertRaisesRegex(ValueError,'documentbronnen',s.validate_body,'book',body)
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
    def test_house_letter_has_safe_margins_stationery_and_no_large_document_title(self):
        import pdfplumber,io
        doc={'kind':'letter','title':'Briefing: This is metadata only','content':[{'_type':'block','children':[{'_type':'span','text':'Test Reiziger\nStationsplein 1\n1234 AB Wenen','marks':[]}]},{'_type':'block','children':[{'_type':'span','text':'Beste Test Reiziger,','marks':[]}]},{'_type':'block','style':'h2','children':[{'_type':'span','text':'Reizen met de Nightjet','marks':[]}]},{'_type':'block','children':[{'_type':'span','text':'Uw reisgegevens staan hieronder.','marks':[]}]},{'_type':'pageBreak'},{'_type':'block','children':[{'_type':'span','text':'Tweede pagina van de brief.','marks':[]}]}]}
        for fmt in ('A4','A5'):
            result=booking_documents.render(ctx,{'document':doc,'format':fmt})
            raw=(s.DATA/'pdfs'/f"{result['asset']}.pdf").read_bytes()
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                self.assertEqual(len(pdf.pages),2)
                for page in pdf.pages:
                    text=page.extract_text()
                    self.assertIn('contact@treinrondreis.nl',text)
                    self.assertIn('KvK: 86245007',text)
                    self.assertNotIn(doc['title'],text)
                    self.assertTrue(page.images)
                words=pdf.pages[0].extract_words()
                greeting=next(w for w in words if w['text']=='Beste')
                self.assertGreaterEqual(greeting['x0'],76 if fmt=='A4' else 29)
                self.assertGreater(greeting['top'],170 if fmt=='A4' else 125)
                self.assertIn('Tweede pagina',pdf.pages[1].extract_text())
            self.assertEqual(result['bookingDocument']['layout'],'treinrondreis-letter-1')
            self.assertTrue(any('huisstijl' in w for w in result['warnings']))
            self.assertFalse(any('opnieuw opgemaakt' in w for w in result['warnings']))
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
