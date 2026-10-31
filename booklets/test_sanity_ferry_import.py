"""Fictional originals only; rendering never calls a Sanity mutation endpoint."""
import base64,hashlib,unittest
from types import SimpleNamespace
from pypdf import PdfReader
import test_ticket_dates as fixtures
import booking_documents,ticket_dates,ticket_drive

class SanityFerryTests(unittest.TestCase):
    def test_sanity_ticket_render_preserves_original_and_records_exact_booking_source(self):
        _,raw=fixtures.TicketDateTests.upload(self,['Ticket\nDeparture: 06.06.2028','Seat reservation\nDeparture: 06.06.2028'])
        doc={'bookingId':'fictional-booking','documentId':'file-'+('a'*40)+'-pdf','title':'Ticket','kind':'ticket','content':[],'attachment':True,'digest':'fictional-digest','revision':'fictional-revision','originalPdf':base64.b64encode(raw).decode()}
        ctx=SimpleNamespace(**vars(fixtures.s));r=booking_documents.render(ctx,{'format':'A4','document':doc})
        self.assertEqual((fixtures.s.DATA/'pdfs'/f"{r['asset']}.pdf").read_bytes(),raw)
        self.assertEqual(r['sourceDigest'],hashlib.sha256(raw).hexdigest());self.assertEqual(r['bookingDocument']['kind'],'ticket');self.assertEqual(r['bookingDocument']['bookingId'],'fictional-booking')
        self.assertEqual(len(PdfReader(fixtures.s.DATA/'pdfs'/f"{r['asset']}.pdf").pages),2)
        for change in ({'originalPdf':''},{'attachment':False}):
            with self.assertRaises(ValueError):booking_documents.render(ctx,{'format':'A4','document':{**doc,**change}})

    def test_unknown_ferry_or_upload_date_does_not_inherit_one_todo_date(self):
        a,_=fixtures.TicketDateTests.upload(self,['Original document without a readable departure'])
        for provider in ['sanity','finnlines','fjordline','entur']:
            p=ticket_dates.inspect(SimpleNamespace(**vars(fixtures.s)),{'asset':a['id'],'provider':provider,'suggestedDates':['2028-06-06']})['pages'][0]
            self.assertFalse(p['travelDate']);self.assertTrue(p['dateNeedsReview'])

    def test_drive_ferry_and_entur_sources_exclude_receipts_and_general_information(self):
        for provider,name in [('finnlines','Finnlines F280000001 ticket.pdf'),('fjordline','Fjord Line 12345678 ticket.pdf'),('entur','Entur ABCD1234 ticket.pdf')]:self.assertTrue(ticket_drive.ticket_name(name,provider))
        for provider,name in [('entur','Entur ABCD1234 sales-receipt.pdf'),('finnlines','Finnlines F280000001 invoice.pdf'),('cd','CD 12345678900 Additional Services.pdf')]:self.assertFalse(ticket_drive.ticket_name(name,provider))

    def test_ferry_departure_tables_ignore_issue_arrival_and_check_in_dates(self):
        finn='Finnlines\nIssuing Date: 01/06/2028\nPORT ALPHA-PORT BETA 06/06/2028 02:00 07/06/2028 10:00 VESSEL'
        fjord='Fjord Line\nBooking date: 01.06.2028\nTravel details Name of passengers\n06.06.2028 PORT ALPHA 19.15 PORT BETA 13.00\nCHECK-IN TIME 05.06.2028 18.15'
        for provider,text in [('finnlines',finn),('fjordline',fjord),('sanity',finn),('sanity',fjord)]:self.assertEqual(ticket_dates.labelled_date(text,provider),('2028-06-06','pdf',False))
        self.assertFalse(ticket_dates.labelled_date('Issuing Date: 01/06/2028','finnlines')[0])
        self.assertFalse(ticket_dates.labelled_date('CHECK-IN TIME 05.06.2028','fjordline')[0])
        self.assertEqual(ticket_dates.labelled_date(finn+'\nPORT BETA-PORT ALPHA 08/06/2028 02:00 09/06/2028 10:00 VESSEL','finnlines'),('','ambiguous',True))

    def test_fjord_adjacent_payment_column_does_not_hide_printed_sailing_date(self):
        text='Fjord Line\nBooking date: 01.06.2028\nTravel details\n  Payment Details\n06.06.2028 19.15 13.00\nCHECK-IN TIME 05.06.2028 18.15'
        for provider in ('fjordline','sanity'):
            self.assertEqual(ticket_dates.labelled_date(text,provider),('2028-06-06','pdf',False))
            self.assertFalse(ticket_dates.labelled_date('Fjord Line\nTravel details\nPayment Details\nBooking date: 01.06.2028',provider)[0])
            self.assertFalse(ticket_dates.labelled_date(text.replace('19.15 13.00','99.99 88.88'),provider)[0])

    def test_renamed_entur_receipt_cannot_become_a_sanity_ticket(self):
        a,_=fixtures.TicketDateTests.upload(self,['Electronic sales receipt\nThis receipt is not valid as a ticket.'])
        for provider in ['entur','sanity']:
            with self.assertRaisesRegex(ValueError,'betalingsbewijs'):ticket_dates.inspect(SimpleNamespace(**vars(fixtures.s)),{'asset':a['id'],'provider':provider})
