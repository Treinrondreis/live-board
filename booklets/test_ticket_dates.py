import io,json,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
import test_cloud,ticket_dates
s=test_cloud.cloud.server

class TicketDateTests(unittest.TestCase):
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
