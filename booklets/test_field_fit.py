import copy,io,re,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
import pdfplumber
import test_cloud,booking_documents,field_fit,field_flow,preflight
s=test_cloud.cloud.server

class AutoFitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.showPage();cv.save()
        cls.source=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Fictieve basis')
    def field(self,**extra):return {'key':'Reistitel','page':0,'x':10,'y':20,'w':40,'h':8,'size':24,'font':'Open Sans','color':'#000000','required':True,**extra}
    def body(self,f):return {'asset':self.source['asset'],'pages':1,'format':'A4','fields':[f],'numberingConfigured':True}
    def book(self,f,values):return {'format':'A4','outputMode':'screen','duplex':False,'values':values,'sections':[{'oneOff':True,'title':'Fictieve pagina',**self.body(f)}]}
    def test_plain_uses_largest_fitting_size_never_enlarges_or_mutates(self):
        f=self.field(autoFit=True,minSize=8);before=copy.deepcopy(f);value='Rondreis met de nachttrein door bergland'
        result=field_fit.plain(f,value,238,67,'Booklet');self.assertTrue(result['fits']);self.assertTrue(result['shrunk']);self.assertGreaterEqual(result['size'],8);self.assertLess(result['size'],24)
        self.assertGreater(pdfmetrics.stringWidth(value,'Booklet',result['size']+.25),238)
        self.assertEqual(field_fit.plain(f,'Wenen',238,67,'Booklet')['size'],24);self.assertEqual(f,before)
        self.assertFalse(field_fit.plain(self.field(),value,238,67,'Booklet')['fits'])
    def test_check_preflight_actual_pdf_agree_for_dynamic_values(self):
        f=self.field(autoFit=True,minSize=8);values={'Reistitel':'Rondreis met de nachttrein door bergland'}
        checked=s.check_layout(self.body(f),values);self.assertTrue(checked['fits']);row=checked['results'][0];self.assertTrue(row['shrunk'])
        book=self.book(f,values);self.assertFalse(preflight.check(SimpleNamespace(**vars(s)),book,[])['errors'])
        exported=s.make_export({'id':'demo','title':'Fictieve titel','body':book},{'allowUneven':True})
        with pdfplumber.open(s.DATA/'exports'/f"{exported['id']}.pdf") as pdf:
            page=pdf.pages[0];self.assertIn(values['Reistitel'],page.extract_text());letters=[c for c in page.chars if c['text'].isalpha()]
            self.assertTrue(letters);self.assertTrue(all(abs(c['size']-row['size'])<.01 for c in letters))
            self.assertTrue(all(c['x0']>=page.width*.1-.1 and c['x1']<=page.width*.5+.1 for c in letters))
        self.assertEqual(f['size'],24)
    def test_minimum_failure_still_blocks_export_without_truncation(self):
        f=self.field(autoFit=True,minSize=8,h=1);values={'Reistitel':'Fictieve reistitel'}
        row=s.check_layout(self.body(f),values)['results'][0];self.assertFalse(row['fits']);self.assertEqual(row['size'],8)
        book=self.book(f,values);self.assertTrue(preflight.check(SimpleNamespace(**vars(s)),book,[])['errors']);existing=set((s.DATA/'exports').iterdir())
        self.assertRaisesRegex(ValueError,'past niet',s.make_export,{'id':'demo','title':'Fictief','body':book},{'allowUneven':True})
        self.assertEqual(set((s.DATA/'exports').iterdir()),existing)
    def test_rich_one_and_two_columns_shrink_without_losing_words(self):
        value=' '.join('woord%02d'%i for i in range(50))
        for columns in (1,2):
            with self.subTest(columns=columns):
                f=self.field(type='text',template='{{informatie}}',autoFit=True,minSize=8,columns=columns,h=20)
                result=field_flow.layout(f,f['template'],{'informatie':value},238,168,s.TOKEN,'Booklet','left');self.assertTrue(result['fits']);self.assertLess(result['size'],24)
                out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);field_flow.draw(cv,result,60,700);cv.save()
                with pdfplumber.open(io.BytesIO(out.getvalue())) as pdf:self.assertCountEqual(re.findall(r'woord\d\d',pdf.pages[0].extract_text()),value.split())
    def test_reusable_layout_retains_only_explicit_sizing_settings(self):
        import json
        f=self.field(type='text',template='{{reisnaam}}',autoFit=True,minSize=12)
        status,_,raw=test_cloud.request('/api/save','POST',json.dumps({'kind':'layout','title':'Fictieve titelopmaak','body':{'format':'A4','fields':[f]}}).encode())
        self.assertEqual(status,200);saved=s.obj(json.loads(raw)['id'])['body']['fields'][0]
        self.assertTrue(saved['autoFit']);self.assertEqual(saved['minSize'],12);self.assertEqual(saved['size'],24)
    def test_invalid_options_are_rejected_and_search_is_bounded(self):
        for setting in ({'autoFit':'yes'},{'autoFit':True,'minSize':float('nan')},{'autoFit':True,'minSize':True},{'autoFit':True,'minSize':5},{'autoFit':True,'minSize':25},{'autoFit':True,'type':'contents'},{'autoFit':True,'type':'pageNumber'}):
            with self.subTest(setting=setting),self.assertRaises(ValueError):field_fit.validate(self.field(**setting))
        calls=[];result=field_fit.fit(self.field(size=72,autoFit=True,minSize=6),lambda size:(calls.append(size) or {'fits':size<=12.3}))
        self.assertEqual(result['size'],12.25);self.assertLessEqual(len(calls),12)
    def test_centered_full_width_and_prefilled_values_use_same_policy(self):
        f=self.field(type='prefilled',template='Oude standaard',autoFit=True,minSize=8,backgroundColor='#000000',backgroundFullWidth=True,centerFullWidth=True,color='#ffffff',w=10)
        value='Een lange aangepaste tekst voor een fictieve reis door het bergland '*2
        checked=s.check_layout(self.body(f),{'Reistitel':value});self.assertTrue(checked['fits']);self.assertTrue(checked['results'][0]['shrunk']);self.assertEqual(f['template'],'Oude standaard')

if __name__=='__main__':unittest.main()