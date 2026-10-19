import io,json,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
import test_cloud,ticket_dates
s=test_cloud.cloud.server

class TicketDateTests(unittest.TestCase):
    def test_ticket_display_details_only_use_explicit_labels(self):
        self.assertEqual(ticket_dates.ticket_details('Ticket\nFrom: Utrecht Centraal\nTo: Wien Hbf\nPassengers: 2\nTicket number: TEST12345'), {'originStation':'Utrecht Centraal','destinationStation':'Wien Hbf','passengerCount':2,'ticketNumber':'TEST12345'})
        self.assertEqual(ticket_dates.ticket_details('Leiden Centraal → Utrecht Centraal\n1 volwassene'), {'originStation':'Leiden Centraal','destinationStation':'Utrecht Centraal','passengerCount':1})
        self.assertEqual(ticket_dates.ticket_details('Price 2 EUR\nIssued: 12.03.2027\nBooking ABCDEFG'), {})
        self.assertEqual(ticket_dates.ticket_details('* * DELFT -> AMERSFOORT CENTRAAL* * 22* * ****** -> *****VIA [1184]*****'), {'originStation':'DELFT','destinationStation':'AMERSFOORT CENTRAAL'})
        self.assertNotIn('passengerCount',ticket_dates.ticket_details('Passengers: 1\nPassengers: 2'))
        self.assertNotIn('originStation',ticket_dates.ticket_details('Leiden → Utrecht\nAssen → Utrecht'))

    def test_ticket_metadata_is_saved_but_rejects_invalid_counts_and_oversized_labels(self):
        a,_=self.upload(['Ticket'])
        def body(extra):return {'format':'A4','sections':[{'oneOff':True,'title':'Test','asset':a['id'],'pages':1,'fields':[],'pageSources':[{'asset':a['id'],'page':0,**extra}]}]}
        valid=body({'originStation':'Delft','destinationStation':'Utrecht','passengerCount':2})
        s.validate_body('book',valid)
        self.assertEqual(valid['sections'][0]['pageSources'][0]['passengerCount'],2)
        for extra in ({'passengerCount':True},{'passengerCount':0},{'passengerCount':100},{'originStation':'x'*101},{'ticketNumber':{}}):
            with self.assertRaises(ValueError):s.validate_body('book',body(extra))

    def test_cora_gate_page_is_omitted_without_changing_tickets_or_original_pdf(self):
        gate='Het station betreden of verlaten\nDit is geen vervoerbewijs.\nDit passageticket is bedoeld voor het openen van poortjes.'
        a,raw=self.upload(['Ticket\nDeparture: 08.03.2027',gate,'Seat reservation\nDeparture: 08.03.2027'])
        ctx=SimpleNamespace(**vars(s))
        result=ticket_dates.inspect(ctx,{'asset':a['id'],'provider':'ns','omitGatePass':True})
        self.assertEqual([p['page'] for p in result['pages']],[0,2])
        self.assertEqual((s.DATA/'pdfs'/f"{a['id']}.pdf").read_bytes(),raw)
        for payload in ({'provider':'ns'},{'provider':'db','omitGatePass':True}):
            self.assertEqual(len(ticket_dates.inspect(ctx,{'asset':a['id'],**payload})['pages']),3)
        with self.assertRaises(ValueError):ticket_dates.inspect(ctx,{'asset':a['id'],'omitGatePass':'yes'})

    def test_gate_detection_requires_both_markers_and_never_drops_a_ticket_or_reservation_heading(self):
        self.assertTrue(ticket_dates.is_gate_pass('Het station betreden of verlaten\nDit is geen\nvervoerbewijs.'))
        self.assertTrue(ticket_dates.is_gate_pass('Het station betre den of verlaten\nDit  is geen vervoerbew ijs.'))
        self.assertFalse(ticket_dates.is_gate_pass('Dit is geen vervoerbewijs.'))
        self.assertFalse(ticket_dates.is_gate_pass('Het station betreden of verlaten'))
        for heading in ('Ticket','Seat reservation'):
            self.assertFalse(ticket_dates.is_gate_pass(heading+'\nHet station betreden of verlaten\nDit is geen vervoerbewijs.'))

    def test_voucher_written_check_in_dates_ignore_check_out_and_incheck_times(self):
        text='Hotelvoucher\nAankomst: 8 maart 2027\nVertrek: 10 maart 2027\nInchecken: Vanaf 15.00 uur tot middernacht'
        self.assertEqual(ticket_dates.labelled_date(text,'voucher'),('2027-03-08','pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Arrival: 8 March 2027\nDeparture: 10 March 2027','voucher'),('2027-03-08','pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Aankomst: 31 februari 2027','voucher'),('','unknown',True))
        self.assertEqual(ticket_dates.labelled_date('Documentdatum: 8 maart 2027\nVertrek: 10 maart 2027','voucher'),('','unknown',True))
        self.assertEqual(ticket_dates.iso('8 maart 2027'),'')

    def test_mav_train_date_wins_over_validity_issue_and_birth_date(self):
        text='Date of birth: 16.12.1959\nIssue date: 16.09.2026\nERVENYES/VALID: 10.10.2026 - 11.10.2026\nVONAT/TRAIN: 61(10.10.2026 11:40)'
        self.assertEqual(ticket_dates.labelled_date(text,'mav'),('2026-10-10','pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Issue date: 16.09.2026\nDate of birth: 10.10.2026','db'),('','unknown',True))
    def test_dates_calendar_ambiguity_validity_and_year_rollover(self):
        self.assertEqual(ticket_dates.iso('31.02.2026'),'')
        self.assertEqual(ticket_dates.labelled_date('Departure: 10.10.2026\nDeparture: 16.10.2026','ns'),('','ambiguous',True))
        self.assertEqual(ticket_dates.labelled_date('First day of validity: 09.10.2026','cd'),('2026-10-09','pdf-validity',False))
        self.assertEqual(ticket_dates.labelled_date('Gültig ab: 31.12.2026\n01.01. 20:10 Wien Hbf -> Amsterdam','ns'),('2027-01-01','pdf-timetable',False))
        self.assertEqual(ticket_dates.labelled_date('Check-in: 10-10-2026\nCheck-out: 13-10-2026','voucher'),('2026-10-10','pdf',False))
        self.assertEqual(ticket_dates.labelled_date('Geldig van: 07.10.2026 - 16.10.2026','ns'),('2026-10-07','pdf-validity-range',True))
        self.assertEqual(ticket_dates.labelled_date('Geldig van: 07.10.2026 - 08.10.2026','ns'),('2026-10-07','pdf-validity',False))
    def upload(self,texts):
        stream=io.BytesIO();cv=canvas.Canvas(stream,pagesize=s.SIZES['A4'])
        for text in texts:
            for n,line in enumerate(text.split('\n')):cv.drawString(30,800-n*20,line)
            cv.showPage()
        cv.save();raw=stream.getvalue();status,_,r=test_cloud.request('/api/upload','POST',raw);self.assertEqual(status,200)
        return json.loads(r),raw
    def test_inspection_is_private_preserves_pdf_and_flags_todo_conflicts(self):
        self.assertEqual(test_cloud.request('/api/tickets/inspect','POST',authorized=False)[0],401)
        a,raw=self.upload(['Departure: 10.10.2026','Terms and conditions'])
        payload={'asset':a['id'],'provider':'db','suggestedDates':['2026-10-11']}
        status,_,r=test_cloud.request('/api/tickets/inspect','POST',json.dumps(payload).encode());self.assertEqual(status,200)
        pages=json.loads(r)['pages'];self.assertEqual(pages[0]['dateSource'],'pdf-conflict');self.assertTrue(pages[0]['dateNeedsReview']);self.assertEqual(pages[1]['travelDate'],'2026-10-11')
        result=ticket_dates.inspect(SimpleNamespace(**vars(s)),{'asset':a['id'],'provider':'db'})
        self.assertEqual(result['pages'][1]['dateSource'],'pdf-continuation');self.assertTrue(result['pages'][1]['dateNeedsReview'])
        self.assertEqual((s.DATA/'pdfs'/f"{a['id']}.pdf").read_bytes(),raw)
        for dates in [['2026-02-31'],[None],'2026-10-10']:
            with self.assertRaises(ValueError):ticket_dates.inspect(SimpleNamespace(**vars(s)),{**payload,'suggestedDates':dates})
    def test_sanity_todo_fallback_does_not_override_ambiguous_pdf(self):
        a,_=self.upload(['No printed departure date','Departure: 10.10.2026\nDeparture: 16.10.2026'])
        r=ticket_dates.inspect(SimpleNamespace(**vars(s)),{'asset':a['id'],'provider':'ns','suggestedDates':['2026-10-10']})
        self.assertEqual(r['pages'][0]['dateSource'],'sanity-todo');self.assertFalse(r['pages'][0]['dateNeedsReview'])
        self.assertEqual(r['pages'][1]['travelDate'],'');self.assertTrue(r['pages'][1]['dateNeedsReview'])
    def test_shared_reference_with_two_departure_dates_does_not_flag_matching_pdf_dates(self):
        a,_=self.upload(['Departure: 11.11.2026','Departure: 14.11.2026','Departure: 15.11.2026'])
        r=ticket_dates.inspect(SimpleNamespace(**vars(s)),{'asset':a['id'],'provider':'ns','suggestedDates':['2026-11-11','2026-11-14']})
        self.assertEqual([p['travelDate'] for p in r['pages']],['2026-11-11','2026-11-14','2026-11-15'])
        self.assertEqual([p['dateNeedsReview'] for p in r['pages']],[False,False,True])
        self.assertEqual(r['pages'][2]['dateSource'],'pdf-conflict')

    def test_ns_onward_ticket_on_arrival_day_keeps_its_own_printed_date(self):
        a,_=self.upload(['Geldig: 20.02.2027 - 20.02.2027','Geldig: 23.02.2027\n23.02 18:20 Alpha -> Beta 24.02 09:30','Geldig: 24.02.2027 - 24.02.2027','No readable departure date','Departure: 25.02.2027'])
        payload={'asset':a['id'],'provider':'ns','suggestedDates':['2027-02-20','2027-02-23'],'continuationDates':['2027-02-21','2027-02-24'],'travelDates':['2027-02-20','2027-02-23']}
        pages=ticket_dates.inspect(SimpleNamespace(**vars(s)),payload)['pages']
        self.assertEqual([p['travelDate'] for p in pages[:3]],['2027-02-20','2027-02-23','2027-02-24'])
        self.assertFalse(any(p['dateNeedsReview'] for p in pages[:3]))
        self.assertEqual(pages[3]['travelDate'],'')
        self.assertTrue(pages[3]['dateNeedsReview'])
        self.assertEqual(pages[4]['dateSource'],'pdf-conflict')
        for invalid in (None,'2027-02-24',['not-a-date']):
            with self.assertRaisesRegex(ValueError,'reisdatums'):ticket_dates.inspect(SimpleNamespace(**vars(s)),{**payload,'continuationDates':invalid})
    def test_saved_selection_checks_source_bounds_moment_and_review_before_export(self):
        a,_=self.upload(['Departure: 10.10.2026','Departure: 16.10.2026'])
        import ticket_import
        selected=ticket_import.compose(SimpleNamespace(**vars(s)),{'format':'A4','pages':[{'asset':a['id'],'page':1}]})
        selected.update(fields=[],pageSources=[{'asset':a['id'],'page':1,'travelDate':'2026-10-16','dateNeedsReview':False}],originalPages=[{'asset':a['id'],'page':n,'travelDate':d} for n,d in enumerate(['2026-10-10','2026-10-16'])])
        slot={'choice':'document','documentKind':'nsTickets','ticketMoment':2,'selected':selected}
        body={'format':'A4','sections':[slot]};s.validate_body('book',body)
        slot['ticketMoment']=1
        with self.assertRaisesRegex(ValueError,'reismoment'):s.validate_body('book',body)
        slot['ticketMoment']=2;selected['pageSources'][0]['page']=2
        with self.assertRaisesRegex(ValueError,'documentpagina'):s.validate_body('book',body)
        selected['pageSources'][0]['page']=1;selected['pageSources'][0]['dateNeedsReview']=True
        s.validate_body('book',body);self.assertTrue(selected['reviewRequired'])
        with self.assertRaisesRegex(ValueError,'Controleer eerst'):s.make_export({'id':'test','body':body},{'skipChoices':True,'allowUneven':True,'dryRun':True})
        for extra in ({'ticketMoment':True},{'ticketMoment':100},{'ticketMoment':-1},{'sortByDate':'yes'}):
            with self.assertRaises(ValueError):s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'mavTickets',**extra}]})

    def test_manual_placement_keeps_warning_and_source_validation_without_requiring_dates(self):
        a,_=self.upload(['Ticket without a readable date','Unused source page'])
        import ticket_import
        selected=ticket_import.compose(SimpleNamespace(**vars(s)),{'format':'A4','pages':[{'asset':a['id'],'page':0}]})
        selected.update(fields=[],manualDatePlacement=True,pageSources=[{'asset':a['id'],'page':0,'dateNeedsReview':True}],originalPages=[{'asset':a['id'],'page':n,'dateNeedsReview':True} for n in range(2)])
        body={'format':'A4','sections':[{'choice':'document','documentKind':'nsTickets','ticketMoment':2,'selected':selected}]}
        s.validate_body('book',body)
        self.assertFalse(selected.get('reviewRequired',False))
        self.assertIn('handmatig geplaatst',selected['warnings'][0])
        selected['warnings']=[]
        s.validate_body('book',body)
        self.assertEqual(len(selected['warnings']),1)
        self.assertNotIn('travelDate',selected['pageSources'][0])
        selected['title']='Handmatig gekozen tickets'
        report=s.make_export({'id':'test','body':body},{'skipChoices':True,'allowUneven':True,'dryRun':True})['report']
        self.assertTrue(any('handmatig geplaatst' in w for w in report['warnings']))
        selected['pageSources'][0]['page']=99
        with self.assertRaisesRegex(ValueError,'documentpagina'):s.validate_body('book',body)
        selected['pageSources'][0]['page']=0
        selected['manualDatePlacement']='yes'
        with self.assertRaisesRegex(ValueError,'handmatige'):s.validate_body('book',body)
        selected['manualDatePlacement']=False
        s.validate_body('book',body)
        self.assertTrue(selected['reviewRequired'])
