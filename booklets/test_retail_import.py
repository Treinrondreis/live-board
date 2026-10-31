"""Only fictional tickets and references; never connect to a live mailbox."""
import unittest
from types import SimpleNamespace
import automatic_builder,booking_documents,ticket_dates,ticket_drive
import test_ticket_dates as fixtures

class RetailImportTests(unittest.TestCase):
    def test_supported_document_sources_and_all_combined_sources_validate(self):
        for kind in ['trainlineTickets','raileuropeTickets','sbbTickets','finnlinesTickets','fjordlineTickets','enturTickets','sanityTickets']:
            self.assertIn(kind,booking_documents.TICKET_KINDS)
            fixtures.s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':kind}]})
        sources=list(automatic_builder.PROVIDERS)
        self.assertEqual(len(sources),13)
        fixtures.s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'combinedTickets','ticketSources':sources}]})
        for invalid in [sources+['unknown'],sources+['sbb']]:
            with self.assertRaises(ValueError):fixtures.s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'combinedTickets','ticketSources':invalid}]})

    def test_actual_ticket_date_shapes_ignore_issue_dates_and_keep_both_travellers(self):
        for provider,text,date in [('raileurope','My ticket\nFRIDAY, 19 MARCH 2027\nPurchased: 30.10.2026','2027-03-19'),('sbb','Gültig:\n02.05.2027 00:00\nVerkauft: 30.10.2026','2027-05-02'),('sbb','Date of travel Train no.\nTu, 04.05.2027\nZürich, 30.10.2026','2027-05-04'),('trainline','FECHA: 02/05/2027\nIssued: 30.10.2026','2027-05-02')]:
            self.assertEqual(ticket_dates.labelled_date(text,provider),(date,'pdf' if 'Gültig' not in text else 'pdf-validity',False))
        asset,raw=fixtures.TicketDateTests.upload(self,['My ticket\nFRIDAY, 19 MARCH 2027','My ticket\nFRIDAY, 19 MARCH 2027'])
        pages=ticket_dates.inspect(SimpleNamespace(**vars(fixtures.s)),{'provider':'raileurope','asset':asset['id']})['pages']
        self.assertEqual(len(pages),2);self.assertTrue(all(p['travelDate']=='2027-03-19' for p in pages))
        self.assertEqual((fixtures.s.DATA/'pdfs'/f"{asset['id']}.pdf").read_bytes(),raw)

    def test_trainline_printed_route_dates_override_a_single_outbound_todo_hint(self):
        asset,_=fixtures.TicketDateTests.upload(self,['17 Nov 2027 NCL - EDB\nIssued 30 October 2027','19 Nov 2027 EDB - NCL\nIssued 30 October 2027','Origen: EXAMPLE CITY 25/11/2027 09:43\nDestino: OTHER CITY 25/11/2027 10:37\n21/10/2027 - 12:38'])
        pages=ticket_dates.inspect(SimpleNamespace(**vars(fixtures.s)),{'provider':'trainline','asset':asset['id'],'suggestedDates':['2027-11-17']})['pages']
        self.assertEqual([p['travelDate'] for p in pages],['2027-11-17','2027-11-19','2027-11-25'])
        self.assertTrue(pages[1]['dateNeedsReview']);self.assertTrue(pages[2]['dateNeedsReview'])

    def test_drive_requires_the_provider_and_a_ticket_name(self):
        for provider,filename in [('trainline','Trainline ABC123 ticket.pdf'),('raileurope','Rail_Europe_REABC123_tickets.pdf'),('sbb','SBB 123456789012 Billett.pdf'),('sbb','SBB 1234567890 reservation.pdf')]:
            self.assertTrue(ticket_drive.ticket_name(filename,provider),filename)
        for provider in ['trainline','raileurope','sbb']:
            for filename in ['Other ABC123 ticket.pdf','SBB order_confirmation.pdf','Trainline invoice.pdf','Rail Europe receipt.pdf']:
                self.assertFalse(ticket_drive.ticket_name(filename,provider),filename)

    def test_trainline_compact_uk_dates_require_route_codes_and_spanish_dates_require_the_route_table(self):
        for text,expected in [('06Jun2028 AAA-BBB','2028-06-06'),('07June2028 BBB - AAA','2028-06-07'),('06/06/2028\nOrigen: EXAMPLE CITY\nDestino: OTHER CITY\n09:43','2028-06-06')]:
            self.assertEqual(ticket_dates.labelled_date(text,'trainline'),(expected,'pdf',False))
        for text in ['Issued: 06Jun2028','Birth date: 06Jun2028\nAAA-BBB','06/06/2028\nIssued ticket\nOrigen: EXAMPLE CITY\nDestino: OTHER CITY','06/06/2028\nOrigen: EXAMPLE CITY','31Feb2028 AAA-BBB']:
            self.assertFalse(ticket_dates.labelled_date(text,'trainline')[0],text)
        self.assertEqual(ticket_dates.labelled_date('06Jun2028 AAA-BBB\n07Jun2028 BBB-AAA','trainline'),('','ambiguous',True))

    def test_compact_trainline_dates_keep_every_traveller_and_the_return_date(self):
        asset,raw=fixtures.TicketDateTests.upload(self,['06Jun2028 AAA-BBB','06Jun2028 AAA-BBB','08Jun2028 BBB-AAA','08Jun2028 BBB-AAA'])
        pages=ticket_dates.inspect(SimpleNamespace(**vars(fixtures.s)),{'provider':'trainline','asset':asset['id'],'suggestedDates':['2028-06-06','2028-06-08']})['pages']
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-06','2028-06-06','2028-06-08','2028-06-08'])
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))
        self.assertEqual((fixtures.s.DATA/'pdfs'/f"{asset['id']}.pdf").read_bytes(),raw)
