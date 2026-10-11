import io,json,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud,ticket_import
s=test_cloud.cloud.server

class TicketTests(unittest.TestCase):
    def test_order_selection_and_original_preserved(self):
        stream=io.BytesIO();cv=canvas.Canvas(stream,pagesize=s.SIZES['A4'])
        for text in ['FIRST','REMOVE','LAST']:cv.drawString(50,700,text);cv.showPage()
        cv.save();original=stream.getvalue();status,_,raw=test_cloud.request('/api/upload','POST',original);self.assertEqual(status,200);a=json.loads(raw)
        r=ticket_import.compose(SimpleNamespace(**vars(s)),{'format':'A5','pages':[{'asset':a['id'],'page':2},{'asset':a['id'],'page':0}]})
        pdf=PdfReader(s.DATA/'pdfs'/f"{r['asset']}.pdf");self.assertEqual(len(pdf.pages),2);self.assertIn('LAST',pdf.pages[0].extract_text());self.assertIn('FIRST',pdf.pages[1].extract_text());self.assertTrue(r['scaled']);self.assertEqual(float(pdf.pages[0].mediabox.height),s.SIZES['A5'][1]);self.assertEqual((s.DATA/'pdfs'/f"{a['id']}.pdf").read_bytes(),original)
    def test_private_and_empty(self):
        self.assertEqual(test_cloud.request('/api/tickets/compose','POST',authorized=False)[0],401)
        with self.assertRaises(ValueError):ticket_import.compose(SimpleNamespace(**vars(s)),{'pages':[]})
