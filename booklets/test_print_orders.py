"""Fictional print sources, private streaming and durable duplicate protection."""
import io,json,time,unittest,uuid
from reportlab.pdfgen import canvas
import test_cloud,print_orders
s=test_cloud.cloud.server

class PrintOrderTests(unittest.TestCase):
    def source(self,pages=8,mode='print',size=(595.276,841.89)):
        ident=uuid.uuid4().hex;book=uuid.uuid4().hex
        raw=io.BytesIO();pdf=canvas.Canvas(raw,pagesize=size)
        for n in range(pages):pdf.drawString(60,700,'Fictional booklet page '+str(n));pdf.showPage()
        pdf.save();(s.DATA/'exports'/(ident+'.pdf')).write_bytes(raw.getvalue())
        body={'format':'A4','outputMode':mode,'sections':[],'sanityBooking':{'id':'synthetic-booking'}}
        with s.db() as c:
            c.execute('INSERT INTO objects VALUES(?,?,?,?,?)',(book,'book','Synthetic magazine',1,json.dumps(body)))
            c.execute('INSERT INTO exports VALUES(?,?,?,?,?,?)',(ident,book,'Synthetic magazine',s.now(),json.dumps({'body':body}),'{}'))
        return ident,book,raw.getvalue()
    def call(self,action,body,authorized=True):return test_cloud.request('/internal/print-orders/'+action,'POST',json.dumps(body).encode(),authorized)
    def quote(self,ident):
        q={'id':uuid.uuid4().hex,'exportId':ident,'expires':time.time()*1000+600000,'reference':'TRR-'+ident,'price':{'totalCents':1452},'environment':'sandbox'}
        self.assertEqual(self.call('quote',{'exportId':ident,'quote':q})[0],200);return q
    def test_private_routes_and_exact_pdf_checksum(self):
        ident,_,raw=self.source();status,_,result=self.call('metadata',{'exportId':ident});self.assertEqual(status,200);meta=json.loads(result)
        self.assertEqual(meta['pages'],8);self.assertEqual(self.call('metadata',{'exportId':ident},False)[0],401)
        self.assertEqual(self.call('pdf',{'exportId':ident,'sha256':'0'*64})[0],400)
        status,headers,data=self.call('pdf',{'exportId':ident,'sha256':meta['sha256']});self.assertEqual(status,200);self.assertEqual(data,raw);self.assertEqual(headers['Content-Type'],'application/pdf')
    def test_screen_wrong_size_uneven_deleted_and_old_exports_are_rejected(self):
        for kwargs in [{'pages':3},{'mode':'screen'},{'size':(420,595)}]:
            ident,_,_=self.source(**kwargs);self.assertEqual(self.call('metadata',{'exportId':ident})[0],400)
        ident,book,_=self.source()
        with s.db() as c:c.execute('INSERT INTO export_details(id,deleted_at) VALUES(?,?)',(ident,s.now()))
        self.assertEqual(self.call('metadata',{'exportId':ident})[0],400)
        ident,book,_=self.source()
        with s.db() as c:
            row=c.execute('SELECT * FROM exports WHERE id=?',(ident,)).fetchone()
            c.execute('INSERT INTO exports VALUES(?,?,?,?,?,?)',(uuid.uuid4().hex,book,row['title'],s.now(),row['snapshot'],row['report']))
        self.assertEqual(self.call('metadata',{'exportId':ident})[0],400)
    def test_claim_survives_restart_and_never_retries_uncertain_orders(self):
        ident,_,_=self.source();q=self.quote(ident);other=self.quote(ident)
        self.assertTrue(json.loads(self.call('claim',{'exportId':ident,'quoteId':q['id']})[2])['claimed'])
        self.assertFalse(json.loads(self.call('claim',{'exportId':ident,'quoteId':other['id']})[2])['claimed'])
        with s.db() as c:print_orders.initialize(c)
        self.assertFalse(json.loads(self.call('claim',{'exportId':ident,'quoteId':q['id']})[2])['claimed'])
        self.assertEqual(self.call('update',{'exportId':ident,'quoteId':other['id'],'state':'upload_failed'})[0],400)
        for state in ['submitting','uncertain']:self.assertEqual(self.call('update',{'exportId':ident,'quoteId':q['id'],'state':state})[0],200)
        self.assertFalse(json.loads(self.call('claim',{'exportId':ident,'quoteId':other['id']})[2])['claimed'])
        self.assertEqual(self.call('update',{'exportId':ident,'quoteId':q['id'],'state':'placed','receipt':{'orderId':123}})[0],200)
        self.assertEqual(print_orders.record(s,ident)['payload']['orderId'],123)
    def test_upload_retry_expiry_and_quote_ownership(self):
        ident,_,_=self.source();q=self.quote(ident)
        self.call('claim',{'exportId':ident,'quoteId':q['id']});self.call('update',{'exportId':ident,'quoteId':q['id'],'state':'upload_failed'})
        self.assertTrue(json.loads(self.call('claim',{'exportId':ident,'quoteId':q['id']})[2])['claimed'])
        other,_,_=self.source();self.assertEqual(self.call('claim',{'exportId':other,'quoteId':q['id']})[0],400)
        with s.db() as c:
            q['expires']=0;c.execute('UPDATE print_quotes SET payload=? WHERE id=?',(json.dumps(q),q['id']))
        self.assertEqual(self.call('claim',{'exportId':ident,'quoteId':q['id']})[0],400)

if __name__=='__main__':unittest.main()
