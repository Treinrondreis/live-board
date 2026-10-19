import io
import unittest
from PIL import Image
import pdfplumber
import test_cloud
import google_layout


class RouteImageOrderTests(unittest.TestCase):
    def fixture(self):
        pictures={}
        for name,size,color in [('map',(240,120),'#22aa88'),('photo',(240,60),'#3388cc')]:
            out=io.BytesIO();Image.new('RGB',size,color).save(out,'PNG');pictures[name]=out.getvalue()
        def obj(name,y):return {'positionedObjectProperties':{'positioning':{'topOffset':{'magnitude':y,'unit':'PT'},'leftOffset':{'magnitude':0,'unit':'PT'}},'embeddedObject':{'imageProperties':{'contentUri':name}}}}
        doc={'title':'Fictieve route','tabs':[{'tabProperties':{'title':'Route'},'documentTab':{
            'body':{'content':[{'paragraph':{'elements':[{'textRun':{'content':'Een korte fictieve routebeschrijving.\n'}}],'positionedObjectIds':['photo','map']}}]},
            'positionedObjects':{'photo':obj('photo',250),'map':obj('map',5)}}}]}
        return doc,pictures

    def test_visual_order_overrides_object_insertion_order_at_the_same_anchor(self):
        doc,pictures=self.fixture();model,images=google_layout.normalize(doc,pictures.__getitem__)
        ordered=[b for b in model['blocks'] if b['type']=='image']
        self.assertEqual([(b['width'],b['height']) for b in ordered],[(240,120),(240,60)])
        self.assertEqual(len(images),2)

    def test_short_a4_route_keeps_both_images_wide_in_correct_order_and_ratio(self):
        doc,pictures=self.fixture();model,images=google_layout.normalize(doc,pictures.__getitem__)
        raw=google_layout.render(model,images,'A4','route')
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            self.assertEqual(len(pdf.pages),1)
            page=pdf.pages[0];drawn=sorted(page.images,key=lambda b:b['top']);self.assertEqual(len(drawn),2)
            width=page.width-2*25*72/25.4
            for image in drawn:self.assertAlmostEqual(image['width'],width,places=2)
            self.assertAlmostEqual(drawn[0]['width']/drawn[0]['height'],2,places=2)
            self.assertAlmostEqual(drawn[1]['width']/drawn[1]['height'],4,places=2)
            self.assertGreaterEqual(drawn[0]['x0'],25*72/25.4-.01)
            self.assertLess(drawn[-1]['bottom'],page.height-25*72/25.4)
            self.assertIn('Een korte fictieve routebeschrijving.',page.extract_text())

    def test_separate_anchors_keep_their_document_order(self):
        doc,pictures=self.fixture();tab=doc['tabs'][0]['documentTab']
        tab['body']['content'][0]['paragraph']['positionedObjectIds']=['photo']
        tab['body']['content'].append({'paragraph':{'elements':[],'positionedObjectIds':['map']}})
        model,_=google_layout.normalize(doc,pictures.__getitem__)
        self.assertEqual([b['height'] for b in model['blocks'] if b['type']=='image'],[60,120])


if __name__=='__main__':unittest.main()
