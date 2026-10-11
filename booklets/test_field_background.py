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

if __name__=='__main__':unittest.main()
