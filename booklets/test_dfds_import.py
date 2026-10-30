"""Fictional confirmations: customer-only sources and no guessed return dates."""
import unittest
from types import SimpleNamespace
import automatic_builder,booking_documents,ticket_dates,ticket_drive
import test_ticket_dates as fixtures

class DfdsImportTests(unittest.TestCase):
    def test_standalone_and_combined_sources_are_validated(self):
        self.assertIn('dfdsTickets',booking_documents.TICKET_KINDS)
        self.assertIn('dfds',automatic_builder.PROVIDERS)
        for kind,sources in [('dfdsTickets',None),('combinedTickets',list(automatic_builder.PROVIDERS))]:
            slot={'choice':'document','documentKind':kind}
            if sources:slot['ticketSources']=sources
            fixtures.s.validate_body('template',{'format':'A4','sections':[slot]})
        for sources in [['dfds','dfds'],['dfds','unknown']]:
            with self.assertRaises(ValueError):fixtures.s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'combinedTickets','ticketSources':sources}]})

    def test_all_confirmation_pages_preserved_and_unknown_dates_require_review(self):
        asset,raw=fixtures.TicketDateTests.upload(self,['Departure: 02.05.2027','Departure: 05.05.2027','Guest list'])
        ctx=SimpleNamespace(**vars(fixtures.s))
        result=ticket_dates.inspect(ctx,{'asset':asset['id'],'provider':'dfds','suggestedDates':['2027-05-02','2027-05-05']})
        self.assertEqual([p['page'] for p in result['pages']],[0,1,2])
        self.assertEqual([p['travelDate'] for p in result['pages']],['2027-05-02','2027-05-05',''])
        self.assertTrue(result['pages'][2]['dateNeedsReview'])
        self.assertEqual((fixtures.s.DATA/'pdfs'/f"{asset['id']}.pdf").read_bytes(),raw)
        unknown,_=fixtures.TicketDateTests.upload(self,['Guest list without a date','Departure: 02.05.2027\nDeparture: 05.05.2027'])
        result=ticket_dates.inspect(ctx,{'asset':unknown['id'],'provider':'dfds','suggestedDates':['2027-05-02']})
        self.assertTrue(all(p['dateNeedsReview'] for p in result['pages']))
        self.assertTrue(all(not p['travelDate'] for p in result['pages']))

    def test_drive_requires_an_explicit_customer_confirmation(self):
        for filename in ['DFDS klant 12345678.pdf','DFDS_KLANT_12345678.pdf','DFDS customer confirmation 12345678.pdf']:
            self.assertTrue(ticket_drive.ticket_name(filename,'dfds'),filename)
        for filename in ['DFDS agent 12345678.pdf','DFDS invoice klant 12345678.pdf','DFDS 12345678.pdf','Other klant 12345678.pdf']:
            self.assertFalse(ticket_drive.ticket_name(filename,'dfds'),filename)
