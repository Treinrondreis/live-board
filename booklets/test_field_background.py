import io, unittest
import test_cloud
import field_background
from reportlab.pdfgen import canvas
import pypdfium2

class BackgroundTests(unittest.TestCase):
    def test_alpha_and_full_width(self):
        field={'x':25,'y':25,'w':50,'h':25,'backgroundColor':'#000000','backgroundOpacity':.5,'backgroundFullWidth':True}
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=(200,200));field_background.draw(cv,field,200,200)
        cv.setFillColor('#000000');cv.rect(80,80,20,20,fill=1,stroke=0);cv.save()
        pdf=pypdfium2.PdfDocument(out.getvalue());bitmap=pdf[0].render(scale=1);im=bitmap.to_pil()
        self.assertTrue(120<=im.getpixel((5,65))[0]<=135,'Backing extends beyond text width with 50% opacity')
        self.assertEqual(im.getpixel((90,110))[:3],(0,0,0),'Alpha restored for later drawing')
        self.assertEqual(im.getpixel((5,10))[:3],(255,255,255))
        bitmap.close();pdf.close()

    def test_invalid_values(self):
        for data in [{'backgroundColor':'red'},{'backgroundColor':'#000000','backgroundOpacity':float('nan')},{'backgroundColor':'#000000','backgroundOpacity':1.5},{'backgroundColor':'#000000','backgroundFullWidth':'yes'}]:
            with self.assertRaises(ValueError):field_background.validate(data)
        field_background.validate({})

    def test_centering_uses_full_width_only_with_a_wide_backing(self):
        f={'x':20,'w':30,'align':'right','centerFullWidth':True}
        self.assertEqual(field_background.text_geometry(f,200),(40,60,'right'))
        f.update(backgroundColor='#000000',backgroundFullWidth=True)
        self.assertEqual(field_background.text_geometry(f,200),(0,200,'center'))
        f['backgroundFullWidth']=False
        self.assertEqual(field_background.text_geometry(f,200),(40,60,'right'))
        with self.assertRaises(ValueError):field_background.validate({'centerFullWidth':'yes'})

    def test_fit_preflight_and_pdf_all_use_the_same_centered_geometry(self):
        import pdfplumber
        s=test_cloud.cloud.server
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.showPage();cv.save()
        from types import SimpleNamespace
        import booking_documents
        a=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Center test')
        f={'key':'caption','page':0,'x':10,'y':20,'w':12,'h':10,'size':12,'color':'#ffffff','backgroundColor':'#000000','backgroundFullWidth':True,'centerFullWidth':True,'required':False}
        body={'asset':a['asset'],'pages':1,'fields':[f],'values':{'caption':'Centered across the entire page'}}
        self.assertTrue(s.check_layout(body,body['values'])['fits'])
        book={'format':'A4','values':body['values'],'sections':[{**body,'oneOff':True,'title':'Center test'}]}
        self.assertFalse(s.preflight.check(s,book,[])['errors'])
        result=s.make_export({'id':'test','title':'Center test','body':book},{'skipChoices':True,'allowUneven':True})
        self.assertEqual(result['report']['pages'],1)
        with pdfplumber.open(s.DATA/'exports'/f"{result['id']}.pdf") as pdf:
            words=pdf.pages[0].extract_words()
            self.assertAlmostEqual((min(w['x0'] for w in words)+max(w['x1'] for w in words))/2,pdf.pages[0].width/2,places=2)

if __name__=='__main__':unittest.main()
