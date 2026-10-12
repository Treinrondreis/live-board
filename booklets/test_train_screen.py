import io,json,unittest
from pypdf import PdfReader
import test_cloud,train_screen
s=test_cloud.cloud.server

def model(mode='roundtrip',fmt='A5'):
    return dict(mode=mode,format=fmt,title='Stedentrip Wenen',heading='Treinreis naar',subtitle='Met de nachttrein',train='Nightjet',showDates=True,legs=[dict(departureStation='Utrecht C',arrivalStation='Wien Hbf',departureTime='19:58',arrivalTime='09:58',departureDate='2026-11-05',arrivalDate='2026-11-06'),dict(departureStation='Wien Hbf',arrivalStation='Utrecht C',departureTime='18:38',arrivalTime='09:41',departureDate='',arrivalDate='')],destinations=['Nederland','Wenen','Boedapest','Praag','Nederland'])

class TrainScreenTests(unittest.TestCase):
    def test_explicit_times_only_and_no_invented_dates(self):
        text='Issue date 01.10.2026\n12:00\n05.11. 19:58 Utrecht Centraal -> 06.11. 09:58 Wien Hbf\n'
        result=train_screen.parse_ticket(text)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['arrivalStation'],'Wien Hbf')
        self.assertEqual(result[0]['departureDate'],'')
        self.assertEqual(train_screen.parse_ticket('Wien Hbf\n19:58\n09:58\n'),[])
        result=train_screen.parse_ticket('Departure: Utrecht C 2026-11-05 19:58\nArrival: Wien Hbf 2026-11-06 09:58')
        self.assertEqual(result[0]['arrivalDate'],'2026-11-06')
    def test_formats_photo_resolution_text_and_optional_dates(self):
        for fmt in ['A4','A5']:
            for mode in ['roundtrip','circuit']:
                b=model(mode,fmt)
                status,_,raw=test_cloud.request('/api/train-screen/render','POST',json.dumps(b).encode());self.assertEqual(status,200,raw[:500])
                result=json.loads(raw);reader=PdfReader(s.DATA/'pdfs'/(result['asset']+'.pdf'));p=reader.pages[0]
                self.assertEqual((float(p.mediabox.width),float(p.mediabox.height)),s.SIZES[fmt])
                self.assertEqual(p.images[0].image.size,(6000,4002))
                text=p.extract_text();self.assertIn('Treinreis naar',text)
                if mode=='roundtrip':
                    for value in ['HEENREIS','TERUGREIS','Wien Hbf','19:58','2026-11-06']:self.assertIn(value,text)
                else:
                    for value in ['Boedapest','Praag','UW RONDREIS']:self.assertIn(value,text)
                    self.assertNotIn('19:58',text)
        b=model();b['showDates']=False
        raw=train_screen.pdf(s,train_screen.settings(b))
        self.assertNotIn('2026-11-05',PdfReader(io.BytesIO(raw)).pages[0].extract_text())
    def test_invalid_and_private(self):
        for path in ['/api/train-screen/render','/api/train-screen/inspect']:
            self.assertEqual(test_cloud.request(path,'POST',b'{}',authorized=False)[0],401)
        b=model();b['legs'][0]['departureTime']='25:70'
        with self.assertRaises(ValueError):train_screen.settings(b)
        b=model();b['legs'][0]['arrivalDate']='2026-02-30'
        with self.assertRaises(ValueError):train_screen.settings(b)
        with self.assertRaises(ValueError):train_screen.inspect(s,{'pages':[{'asset':'../bad','page':0}]})

    def test_ticket_inspection_trace_duplicates_and_original_bytes(self):
        from reportlab.pdfgen import canvas
        buf=io.BytesIO();c=canvas.Canvas(buf,pagesize=s.SIZES['A4'])
        c.drawString(20,800,'19:58 Utrecht C -> 09:58 Wien Hbf');c.showPage()
        c.drawString(20,800,'Issue date: 05.11.2026');c.save();original=buf.getvalue()
        status,_,body=test_cloud.request('/api/upload','POST',original);self.assertEqual(status,200)
        asset=json.loads(body)['id'];pages=[{'asset':asset,'page':0},{'asset':asset,'page':0},{'asset':asset,'page':1}]
        status,_,body=test_cloud.request('/api/train-screen/inspect','POST',json.dumps({'pages':pages}).encode());self.assertEqual(status,200)
        candidates=json.loads(body)['candidates'];self.assertEqual(len(candidates),1)
        self.assertEqual(candidates[0]['sourcePage'],0);self.assertEqual(candidates[0]['sourceAsset'],asset)
        self.assertEqual((s.DATA/'pdfs'/(asset+'.pdf')).read_bytes(),original)

if __name__=='__main__':unittest.main()
