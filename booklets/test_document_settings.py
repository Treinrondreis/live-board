import base64, io, unittest
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud
from features import refresh_blocks
s=test_cloud.cloud.server

class DocumentSettingsTests(unittest.TestCase):
    def test_original_sanity_pdf_is_stored_byte_for_byte(self):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.drawString(80,700,'ORIGINAL HOUSE STYLE');cv.save();raw=out.getvalue()
        import booking_documents
        from types import SimpleNamespace
        result=booking_documents.render(SimpleNamespace(**vars(s)),{'document':{'title':'Voucher','kind':'voucher','content':[],'originalPdf':base64.b64encode(raw).decode(),'bookingId':'customer'},'format':'A4'})
        self.assertEqual((s.DATA/'pdfs'/f"{result['asset']}.pdf").read_bytes(),raw)
        self.assertTrue(result['bookingDocument']['originalPdf']);self.assertEqual(result['warnings'],[])
    def test_original_ticket_pages_are_preserved_and_only_letter_gets_number(self):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4'])
        for text in ('LETTER', 'NS TICKET RETURN'):
            cv.drawString(50,700,text);cv.showPage()
        cv.save();source=out.getvalue()
        from booking_documents import store
        from types import SimpleNamespace
        result=store(SimpleNamespace(**vars(s)),source,'Original')
        from ticket_import import compose
        ctx=SimpleNamespace(**vars(s))
        letter=compose(ctx,{'format':'A4','pages':[{'asset':result['asset'],'page':0}]})
        ticket=compose(ctx,{'format':'A4','pages':[{'asset':result['asset'],'page':1}]})
        field={'key':'Paginanummer','type':'pageNumber','page':0,'x':89,'y':95,'w':10,'h':3,'size':10,'font':'Open Sans','color':'#ffffff'}
        body={'format':'A4','duplex':False,'sanityBooking':{'id':'customer'},'sections':[
            {'title':'Brief','asset':letter['asset'],'pages':1,'fields':[field],'numberingConfigured':True},
            {'title':'Terugreis','asset':ticket['asset'],'pages':1,'fields':[],'numberingConfigured':True}
        ]}
        exported=s.make_export({'id':'test','title':'Test','body':body},{'allowUneven':True})
        pdf=PdfReader(s.DATA/'exports'/f"{exported['id']}.pdf")
        self.assertIn('LETTER',pdf.pages[0].extract_text());self.assertIn('1',pdf.pages[0].extract_text())
        self.assertEqual(pdf.pages[1].extract_text().strip(),'NS TICKET RETURN')
        self.assertEqual((s.DATA/'pdfs'/f"{result['asset']}.pdf").read_bytes(),source)
    def test_route_pattern_refreshes_but_choice_local_override_is_preserved(self):
        obj={'id':'route','kind':'block','revision':2,'title':'Route','body':{'asset':'a','pages':1,'todoMatch':'Premier inn Wien'}}
        selected={'block':'route','todoMatch':'Outdated'}
        body={'sections':[{'choice':'route','selected':selected},{'choice':'manual','options':[{**selected,'todoMatch':'RITAD','todoMatchOverride':True}]}]}
        updated=refresh_blocks(body,[obj])
        self.assertEqual(updated['sections'][0]['selected']['todoMatch'],'Premier inn Wien')
        self.assertEqual(updated['sections'][1]['options'][0]['todoMatch'],'RITAD')
    def test_shared_recognition_overrides_stale_copies_without_losing_values(self):
        block={'id':'page','kind':'block','revision':2,'title':'Page','body':{'asset':'a','pages':1,'todoMatch':'fallback'}}
        shared={'id':'shared','kind':'choice','body':{'slot':{'options':[{'block':'page','todoMatch':'RITAD; RITAX'}]}}}
        option={'block':'page','todoMatch':'old','todoMatchOverride':True,'values':{'name':'Customer'}}
        body={'sections':[{'choice':'manual','choiceSource':'shared','options':[option],'selected':option}]}
        result=refresh_blocks(body,[block,shared])['sections'][0]
        self.assertEqual(result['options'][0]['todoMatch'],'RITAD; RITAX')
        self.assertEqual(result['selected']['todoMatch'],'RITAD; RITAX')
        self.assertEqual(result['selected']['values'],{'name':'Customer'})

    def test_invalid_retriever_settings_cannot_be_saved(self):
        for extra in ({'numberX':91},{'numberY':float('nan')},{'pageNumbers':'true'},{'tocTitle':'a'*301}):
            with self.subTest(extra=extra),self.assertRaises(ValueError):
                s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'letter',**extra}]})

if __name__=='__main__':unittest.main()
