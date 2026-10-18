import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud
import google_sources

class GoogleSelectionTests(unittest.TestCase):
    def setUp(self):
        self.app=SimpleNamespace(**vars(test_cloud.cloud.server))
        self.source={'url':'https://docs.google.com/document/d/'+'a'*32+'/edit','format':'A5','layout':'route'}
        self.cache={'a'*32:({'digest':'v1','title':'Selection test','warnings':[]},{})}
        stream=io.BytesIO();pdf=canvas.Canvas(stream,pagesize=(595.276,419.528))
        for n in range(3):pdf.drawString(30,300,f'Source page {n+1}');pdf.showPage()
        pdf.save();self.raw=stream.getvalue()

    def load(self,source=None):
        with patch.object(google_sources.google_layout,'render',return_value=self.raw):
            return google_sources.load(self.app,source or self.source,self.cache)

    def test_subset_roundtrip_and_changed_source_requires_review(self):
        full=self.load();chosen=google_sources.select_pages(self.app,full,[0,2])
        self.assertEqual(chosen['pages'],2)
        self.assertEqual(chosen['googleDoc']['sourcePages'],3)
        pdf=PdfReader(self.app.DATA/'pdfs'/f"{chosen['asset']}.pdf")
        self.assertIn('Source page 1',pdf.pages[0].extract_text())
        self.assertIn('Source page 3',pdf.pages[1].extract_text())
        self.assertEqual(self.load(chosen['googleDoc'])['asset'],chosen['asset'])
        self.cache['a'*32][0]['digest']='v2'
        with self.assertRaisesRegex(ValueError,'paginaselectie'):self.load(chosen['googleDoc'])
        reviewed=self.load({**chosen['googleDoc'],'selectedPages':None})
        self.assertEqual(reviewed['pages'],3)
        self.assertNotIn('selectedPages',reviewed['googleDoc'])

    def test_invalid_selections_and_all_pages(self):
        full=self.load()
        for bad in [[],[-1],[3],[1,1],[2,0],[True],None]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):google_sources.select_pages(self.app,full,bad)
        self.assertEqual(google_sources.select_pages(self.app,full,[0,1,2])['asset'],full['asset'])
        self.cache['a'*32][0]['digest']='v2'
        self.assertEqual(self.load(full['googleDoc'])['pages'],3)

    def test_interrupted_or_expired_preparation_can_be_rechecked_without_exporting(self):
        full=self.load()
        body={'format':'A5','outputMode':'screen','sections':[{**full,'oneOff':True,'fields':[],'numberingConfigured':True}]}
        def prepare(body):
            with patch.object(google_sources,'load',return_value=full):
                return google_sources.prepare(self.app,body)['body']
        def check(body):
            status,_,raw=test_cloud.request('/api/export-plan','POST',json.dumps({'body':body}).encode())
            self.assertEqual(status,200,raw)
            return json.loads(raw)
        with self.app.db() as c:before=c.execute('SELECT count(*) FROM exports').fetchone()[0]
        prepared=prepare(body)
        self.assertFalse(check(prepared)['errors'])
        deadline=google_sources.PREPARED[prepared['_googlePreparation']]['expires']
        with patch.object(google_sources.time,'time',return_value=deadline+1):
            expired=check(prepared)
        self.assertTrue(expired['googlePreparationRequired'])
        self.assertTrue(expired['errors'])
        google_sources.PREPARED.pop(prepared['_googlePreparation'])
        self.assertTrue(check(prepared)['googlePreparationRequired'])
        recovered=prepare(prepared)
        self.assertFalse(check(recovered)['errors'])
        recovered['sections'][0]['googleDoc']['digest']='changed-after-check'
        self.assertTrue(check(recovered)['googlePreparationRequired'])
        with self.app.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM exports').fetchone()[0],before)

    def test_a4_layout_update_invalidates_cached_pdf_and_protects_selection(self):
        self.source['format']='A4'
        with patch.object(google_sources.google_layout,'A4_ROUTE_VERSION',''):
            full=self.load();chosen=google_sources.select_pages(self.app,full,[0,2])
        self.assertNotEqual(self.load(full['googleDoc'])['asset'],full['asset'])
        self.assertRaisesRegex(ValueError,'paginaselectie',self.load,chosen['googleDoc'])
        self.assertEqual(self.app.asset(chosen['asset'])['pages'],2)

    def test_a4_route_render_has_25mm_margins_including_maps(self):
        import pdfplumber
        from reportlab.lib.units import mm
        from PIL import Image
        picture=io.BytesIO();Image.new('RGB',(400,200),'blue').save(picture,format='PNG')
        model={'title':'Route naar het hotel','tabCount':1,'blocks':[{'type':'text','plain':'Adres: Stationsplein 1','html':'Adres: Stationsplein 1'},{'type':'text','plain':'Loop vanaf het station naar het hotel.','html':'Loop vanaf het station naar het hotel.'},{'type':'image','key':'map','width':400,'height':200}]}
        raw=google_sources.google_layout.render(model,{'map':picture.getvalue()},'A4','route')
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            for page in pdf.pages:
                for item in [*page.extract_words(),*page.images]:
                    self.assertGreaterEqual(item['x0'],25*mm-.01)
                    self.assertLessEqual(item['x1'],page.width-25*mm+.01)
                    self.assertGreaterEqual(item['top'],25*mm-.01)
                    self.assertLessEqual(item['bottom'],page.height-25*mm+.01)

if __name__=='__main__':unittest.main()
