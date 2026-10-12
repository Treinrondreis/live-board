import io,json,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud,features,preflight,booking_documents
s=test_cloud.cloud.server

class DocumentOmissionTests(unittest.TestCase):
    def body(self):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.drawString(70,700,'Voorwoord');cv.showPage();cv.save()
        a=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Omission test')
        return {'format':'A4','duplex':False,'contents':True,'sections':[{'title':'Voorwoord','asset':a['asset'],'pages':1,'fields':[]},{'choice':'document','documentKind':'nsTickets','title':'Terugreis tickets','selected':None,'omitted':True,'todoCondition':'CORA2'}]}

    def test_omission_allows_export_but_remains_visible_in_check_and_export_report(self):
        b=self.body();slot=b['sections'][1]
        self.assertFalse(features.document_condition(slot,b))
        check=preflight.check(SimpleNamespace(**vars(s)),b,[])
        self.assertEqual(check['errors'],[]);self.assertEqual(check['missing'],[])
        self.assertEqual(len(check['warnings']),1);self.assertIn('Terugreis tickets',check['warnings'][0])
        export=s.make_export({'id':'omission','title':'Test','body':b},{'allowUneven':True})
        self.assertIn(check['warnings'][0],export['report']['warnings'])
        pdf=PdfReader(s.DATA/'exports'/f"{export['id']}.pdf")
        text='\n'.join(p.extract_text() for p in pdf.pages)
        self.assertNotIn('Terugreis tickets',text)
        self.assertEqual(export['report']['pages'],2)

    def test_restoring_requirement_blocks_missing_document_again(self):
        b=self.body();slot=b['sections'][1];slot.pop('todoCondition');slot['omitted']=False
        self.assertTrue(preflight.check(SimpleNamespace(**vars(s)),b,[])['errors'])
        self.assertRaisesRegex(ValueError,'ontbrekende',s.make_export,{'id':'test','title':'Test','body':b},{'allowUneven':True})

    def test_save_and_reload_preserves_choice_but_template_and_non_boolean_values_are_rejected(self):
        b=self.body();status,_,raw=test_cloud.request('/api/save','POST',json.dumps({'kind':'book','title':'Skip test','body':b}).encode())
        self.assertEqual(status,200,raw);saved=json.loads(raw)
        state=json.loads(test_cloud.request('/api/state')[2])
        book=next(o for o in state['objects'] if o['id']==saved['id'])
        self.assertTrue(book['body']['sections'][1]['omitted'])
        for value in ('yes',1,None):
            b['sections'][1]['omitted']=value
            with self.subTest(value=value),self.assertRaises(ValueError):s.validate_body('book',b)
        b['sections'][1]['omitted']=True
        self.assertRaises(ValueError,s.validate_body,'template',b)

if __name__=='__main__':unittest.main()
