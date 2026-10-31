"""Synthetic supplier layouts only; no real customer documents or identifiers."""
import unittest
from types import SimpleNamespace
import ticket_dates
import test_ticket_dates as fixtures
s=fixtures.s

class SupplierTravelDateTests(unittest.TestCase):
    def inspect(self,provider,texts,**extra):
        asset,raw=fixtures.TicketDateTests.upload(self,texts)
        result=ticket_dates.inspect(SimpleNamespace(**vars(s)),{'provider':provider,'asset':asset['id'],**extra})['pages']
        self.assertEqual((s.DATA/'pdfs'/f"{asset['id']}.pdf").read_bytes(),raw)
        return result

    def test_ter_validity_selects_only_the_unique_matching_todo_not_birth_or_issue_date(self):
        text='BILLET TER\n08/06/1950 REF : ABC123\nDE : EXAMPLE ORIGIN\nA : EXAMPLE DESTINATION\nUtilisable du 07/06/2028 au 09/06/2028\nEmis le 15/05/2028 a 11h00'
        self.assertEqual(ticket_dates.labelled_date(text,'sncf',['2028-06-08']),('2028-06-08','sanity-todo-validity',False))
        self.assertEqual(ticket_dates.labelled_date(text,'sncf'),('2028-06-07','pdf-validity-range',True))
        self.assertEqual(ticket_dates.labelled_date(text,'sncf',['2028-06-08','2028-06-09']),('2028-06-07','pdf-validity-range',True))
        self.assertEqual(ticket_dates.labelled_date('Emis le 15/05/2028\n08/06/2028 REF : ABC123','sncf'),('','unknown',True))
        self.assertEqual(ticket_dates.labelled_date('Utilisable du 01/06/2028 au 30/06/2028','sncf'),('2028-06-01','pdf-validity-range',True))
        self.assertEqual(ticket_dates.labelled_date('Valable le 8 juin 2028','sncf'),('2028-06-08','pdf',False))
        self.assertEqual(ticket_dates.labelled_date(text+'\nDepart: 08/06/2028','sncf'),('2028-06-08','pdf',False))
        pages=self.inspect('sncf',[text,'Conditions'],suggestedDates=['2028-06-08'],travelDates=['2028-06-01','2028-06-07','2028-06-09'])
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-08']*2)
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))
        pages=self.inspect('sncf',[text],travelDates=['2028-06-08'])
        self.assertTrue(pages[0]['dateNeedsReview'])
        self.assertEqual(ticket_dates.labelled_date('Utilisable du 08/06/2028 au 08/06/2028','sncf'),('2028-06-08','pdf-validity',False))

    def test_hovertravel_column_date_is_not_issue_or_unlabelled_date(self):
        text='Flight Ticket\nDeparture\nArrival\nDate\nTotal Price\nEXAMPLE A\nEXAMPLE B\n08.06.2028\n09.15\n09.25\nIssued: 01.05.2028'
        self.assertEqual(ticket_dates.labelled_date(text,'hovertravel'),('2028-06-08','pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Flight Ticket\nIssued: 08.06.2028','hovertravel'),('','unknown',True))
        self.assertEqual(ticket_dates.labelled_date(text+'\n09.06.2028','hovertravel'),('','ambiguous',True))
        pages=self.inspect('hovertravel',[text,'Conditions of carriage'])
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-08']*2)
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))

    def test_wightlink_summary_merged_columns_and_boarding_passes_ignore_issue_expiry(self):
        cases=[('Outward\nArrival\n09.1508.06.2028\n10.0008.06.2028','2028-06-08'),('Outward EXAMPLE A - EXAMPLE B 08.06.2028 09.15\nValid to 30.06.2028 23.59','2028-06-08'),('EXAMPLE A - EXAMPLE B 08.06.2028 09.15Outward\nIssued 01.05.2028','2028-06-08'),('Return EXAMPLE B - EXAMPLE A 12.06.2028 10.00','2028-06-12')]
        for text,expected in cases:self.assertEqual(ticket_dates.labelled_date(text,'wightlink'),(expected,'pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Issued 08.06.2028','wightlink'),('','unknown',True))
        self.assertEqual(ticket_dates.labelled_date('Outward\nArrival\n09.1508.06.2028\n10.0009.06.2028','wightlink'),('','ambiguous',True))
        pages=self.inspect('wightlink',[cases[0][0],cases[1][0],cases[2][0],cases[3][0]])
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-08']*3+['2028-06-12'])
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))

    def test_pkp_uses_first_journey_in_document_order_and_carries_it_to_undated_pages(self):
        pages=self.inspect('pkp',['Departure / arrival date: 09.06.2028 10.06.2028\nIssued: 01.05.2028','Conditions','Departure / arrival date: 08.06.2028'])
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-09']*3)
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))
        self.assertEqual(pages[1]['dateSource'],'pdf-first-journey')

    def test_go_nordic_one_way_uses_first_departure_not_order_or_next_day_arrival(self):
        texts=['Order date: 01 May 2028 11:00','EXAMPLE A\n09 Jun 2028 16:30 - Departure\nEXAMPLE B\n10 Jun 2028 10:00 - Arrival','Passengers and check-in information']
        pages=self.inspect('gonordic',texts)
        self.assertEqual([p['travelDate'] for p in pages],['2028-06-09']*3)
        self.assertFalse(any(p['dateNeedsReview'] for p in pages))
        self.assertEqual(ticket_dates.labelled_date(texts[0],'gonordic'),('','unknown',True))

    def test_first_journey_never_leaks_across_documents_or_clears_real_todo_conflict(self):
        for provider in ('pkp','gonordic'):
            pages=self.inspect(provider,['Departure: 09.06.2028','Conditions'],suggestedDates=['2028-06-08'])
            self.assertEqual([p['travelDate'] for p in pages],['2028-06-09']*2)
            self.assertTrue(all(p['dateNeedsReview'] for p in pages))
            other=self.inspect(provider,['Issued: 08.06.2028','Conditions'],suggestedDates=['2028-06-08'])
            self.assertFalse(any(p['travelDate'] for p in other))
            self.assertTrue(all(p['dateNeedsReview'] for p in other))
        pages=self.inspect('hovertravel',['Departure: 09.06.2028','Conditions'],suggestedDates=['2028-06-08'])
        self.assertTrue(all(p['dateNeedsReview'] for p in pages))

if __name__=='__main__':unittest.main()
