import io,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
import pdfplumber
import test_cloud,field_flow,booking_documents,preflight
s=test_cloud.cloud.server

class FieldFlowTests(unittest.TestCase):
    def field(self,**extra):
        return {'key':'Voorwoord','type':'text','template':'{{tekst}}','page':0,'x':25/210*100,'y':52,'w':160/210*100,'h':48-25/297*100,'size':10,'font':'Open Sans','color':'#000000','columns':2,'columnGapMm':8,'lineSpacing':1.65,**extra}
    def layout(self,f,text,height=180):
        return field_flow.layout(f,f['template'],{'tekst':text},160*72/25.4,height,s.TOKEN,'Booklet','left')
    def test_single_long_paragraph_flows_left_then_right_without_loss(self):
        text=' '.join('woord%03d'%i for i in range(80));result=self.layout(self.field(),text)
        self.assertTrue(result['fits']);self.assertTrue(all(result['columns']))
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);field_flow.draw(cv,result,25*72/25.4,350);cv.save()
        with pdfplumber.open(io.BytesIO(out.getvalue())) as pdf:
            words=pdf.pages[0].extract_words();actual=[w['text'] for w in words]
            self.assertCountEqual(actual,text.split());self.assertEqual(len(actual),80)
            mid=25*72/25.4+result['width']+result['gap']/2
            left=[w for w in words if w['x0']<mid];right=[w for w in words if w['x0']>mid]
            self.assertTrue(left and right);self.assertEqual(left[0]['text'],'woord000')
            self.assertGreater(int(right[0]['text'][5:]),int(left[0]['text'][5:]))
            self.assertTrue(all(w['bottom']<=s.SIZES['A4'][1]-350+180+.1 for w in words))
            self.assertTrue(all(w['x0']>=25*72/25.4-.1 and w['x1']<=(25+160)*72/25.4+.1 for w in words))
    def test_markup_bullets_and_personal_values_survive_column_split(self):
        f=self.field(template='Beste {{tekst}},\n\n# Uw reis\n- **Eerste** onderdeel\n- Tweede onderdeel\n'+'Reisinformatie '*40)
        result=self.layout(f,'A & B <naam>',height=230);self.assertTrue(result['fits'])
        out=io.BytesIO();cv=canvas.Canvas(out);field_flow.draw(cv,result,70,700);cv.save()
        with pdfplumber.open(io.BytesIO(out.getvalue())) as pdf:
            text=pdf.pages[0].extract_text();self.assertIn('A & B <naam>',text);self.assertIn('Eerste',text);self.assertIn('Tweede',text)
    def test_overflow_blocks_export_and_check_uses_same_geometry(self):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.showPage();cv.save()
        a=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Source')
        f=self.field();body={'asset':a['asset'],'pages':1,'format':'A4','fields':[f]}
        for text,fits in [('Kort voorwoord',True),('te veel tekst '*800,False)]:
            checked=s.check_layout(body,{'tekst':text});self.assertEqual(checked['fits'],fits)
            book={'format':'A4','duplex':False,'values':{'tekst':text},'sections':[{'title':'Voorwoord',**body}]}
            report=preflight.check(SimpleNamespace(**vars(s)),book,[]);self.assertEqual(not report['errors'],fits)
            if not fits:self.assertRaisesRegex(ValueError,'past niet',s.make_export,{'id':'test','title':'Test','body':book},{'allowUneven':True})
    def test_legacy_single_column_keeps_existing_leading_and_flow(self):
        f=self.field(columns=1);f.pop('lineSpacing');result=self.layout(f,'Een regel')
        self.assertEqual(result['columns'][0][0][0].style.leading,15);self.assertEqual(result['width'],160*72/25.4)
    def test_invalid_columns_spacing_and_narrow_frames_are_rejected(self):
        for extra in ({'columns':True},{'columns':3},{'lineSpacing':float('nan')},{'columnGapMm':-1},{'columns':2,'type':'field'}):
            with self.subTest(extra=extra),self.assertRaises(ValueError):field_flow.validate(self.field(**extra))
        self.assertRaises(ValueError,field_flow.layout,self.field(), '{{tekst}}',{'tekst':'tekst'},20,100,s.TOKEN,'Booklet','left')

if __name__=='__main__':unittest.main()
