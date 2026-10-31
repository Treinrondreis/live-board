"""Fictional ticket text and synthetic raster patterns only."""
import base64,io,unittest
from PIL import Image
from pypdf import PdfReader
import mail_ticket_pdf,ticket_dates

def image():
    im=Image.new('RGB',(42,42),'white')
    for x in range(42):
        for y in range(42):
            if (x//3+y//3)%2:im.putpixel((x,y),(0,0,0))
    out=io.BytesIO();im.save(out,format='PNG');return out.getvalue()

class MailTicketTests(unittest.TestCase):
    def payload(self):
        return {'provider':'citylink','html':'<html><body><h1>Citylink</h1><p>Booking Ref: 12345678 Ticket No: ETS12345678</p><p>Your trip details Saturday, June 3, 2028</p><img src="cid:original"></body></html>','images':[{'src':'cid:original','data':base64.b64encode(image()).decode(),'required':True}]}
    def test_original_barcode_pixels_and_ticket_text_survive(self):
        raw=mail_ticket_pdf.make_pdf(self.payload());reader=PdfReader(io.BytesIO(raw));self.assertGreaterEqual(len(reader.pages),1);self.assertIn('ETS12345678',''.join(p.extract_text() or '' for p in reader.pages));self.assertTrue(any(p.images for p in reader.pages))
    def test_missing_or_unreferenced_original_barcode_is_rejected(self):
        for change in ({'images':[]},{'html':'<p>Citylink ticket without its barcode</p>'}):
            with self.assertRaisesRegex(ValueError,'barcode'):mail_ticket_pdf.make_pdf({**self.payload(),**change})
    def test_email_layout_table_can_flow_across_pages_without_losing_barcode(self):
        p=self.payload();p['html']='<table><tr><td>'+p['html']+''.join('<p>Fictional journey information</p>' for _ in range(100))+'</td></tr></table>'
        reader=PdfReader(io.BytesIO(mail_ticket_pdf.make_pdf(p)))
        self.assertGreater(len(reader.pages),1);self.assertEqual(sum((page.extract_text() or '').count('Fictional journey information') for page in reader.pages),100)
    def test_external_resources_attachments_scripts_and_local_file_urls_are_not_rendered(self):
        p=self.payload();p['html']=p['html'].replace('</body>','<script>SECRET_SCRIPT</script><iframe src="file:///etc/passwd">SECRET_FRAME</iframe><img src="file:///etc/passwd"><img src="https://127.0.0.1/private"><link rel="attachment" href="file:///etc/passwd"></body>')
        raw=mail_ticket_pdf.make_pdf(p);reader=PdfReader(io.BytesIO(raw));text=''.join(page.extract_text() or '' for page in reader.pages);self.assertNotIn('SECRET',text);self.assertFalse(reader.attachments)
    def test_new_dates_are_journey_or_check_in_dates_never_issue_dates(self):
        cases=[('citylink','Your trip details Saturday, June 3, 2028','2028-06-03'),('eurostar','Outbound Tuesday, 6 June 2028','2028-06-06'),('sj','Saturday, 3 June 2028','2028-06-03'),('gonordic','Order date: 01 Jun 2028\nPORT A 6 Jun 2028 16:30 - Departure\nPORT B 7 Jun 2028 10:00 - Arrival','2028-06-06'),('pkp','Departure / arrival date: 06.06.2028 06.06.2028','2028-06-06'),('teldar','PREPAID BOOKING\n06/06/2028        08/06/2028','2028-06-06'),('zssk','ODCHOD / HINFAHRT\n06.06.28 10:15 PORT A','2028-06-06'),('sncf','Valable le 6 juin 2028','2028-06-06')]
        for provider,text,expected in cases:self.assertEqual(ticket_dates.labelled_date(text,provider),(expected,'pdf',False),provider)
        self.assertEqual(ticket_dates.labelled_date('Outbound Tuesday, 6 June 2028\nReturn Friday, 9 June 2028','eurostar'),('','ambiguous',True))
