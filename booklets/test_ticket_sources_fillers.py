import io,json,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud,booking_documents,features,trip_fillers,ticket_dates,preflight
s=test_cloud.cloud.server
ctx=lambda:SimpleNamespace(**vars(s))

class TicketSourcesFillerTests(unittest.TestCase):
    def page(self,title,pages=1):
        out=io.BytesIO();c=canvas.Canvas(out,pagesize=s.SIZES['A4'])
        for n in range(pages):c.drawString(60,740,title);c.showPage()
        c.save();a=booking_documents.store(ctx(),out.getvalue(),title)
        return {'title':title,'asset':a['asset'],'pages':pages,'fields':[]}

    def body(self):
        return {'format':'A4','duplex':False,'sections':[self.page('Cover'),self.page('Vienna'),self.page('Extra Vienna'),self.page('Hotel'),self.page('Return')],'sanityBooking':{'departure':'2026-10-12','returnDate':'2026-10-13'}}

    def test_in_place_filler_is_removed_only_on_request_and_actual_export_has_four_pages(self):
        b=self.body();b['sections'][2].update(tripFiller=True,fillerRequiredDays=0,fillerPriority=50)
        plan=features.plan(b,[]);self.assertTrue(plan['canFill']);self.assertEqual(plan['droppedFillers'],['Extra Vienna']);self.assertEqual(plan['fillers'],[])
        result=s.make_export({'id':'filler-test','title':'Test','body':b},{'fill':True})
        reader=PdfReader(s.DATA/'exports'/(result['id']+'.pdf'));self.assertEqual(len(reader.pages),4)
        self.assertEqual([p.extract_text().strip() for p in reader.pages],['Cover','Vienna','Hotel','Return'])
        self.assertEqual(result['report']['fillersSkipped'],['Extra Vienna']);self.assertEqual(len(b['sections']),5)
        normal=s.make_export({'id':'keep-test','title':'Test','body':b},{'allowUneven':True})
        self.assertEqual(normal['report']['pages'],5)

    def test_inclusive_duration_and_unknown_duration_preserve_required_page(self):
        b=self.body();b['sections'][2].update(tripFiller=True,fillerRequiredDays=2)
        self.assertEqual(trip_fillers.trip_days(b),2);self.assertFalse(features.plan(b,[])['canFill'])
        b['sections'][2]['fillerRequiredDays']=3;self.assertTrue(features.plan(b,[])['canFill'])
        b.pop('sanityBooking');p=features.plan(b,[]);self.assertFalse(p['canFill']);self.assertIn('Reisduur onbekend',p['fillerWarnings'][0])
        b['values']={'vertrekdatum':'31-12-2026','terugkomstdatum':'01-01-2027'};self.assertEqual(trip_fillers.trip_days(b),2)

    def test_priority_recto_blanks_and_contents_are_counted_not_guessed(self):
        b=self.body();b['sections'][1].update(tripFiller=True,fillerPriority=1);b['sections'][2].update(tripFiller=True,fillerPriority=99)
        self.assertEqual(features.plan(b,[])['droppedFillers'],['Extra Vienna'])
        b['duplex']=True;b['sections'][3]['recto']=True
        p=features.plan(b,[])
        if p['canFill']:self.assertEqual(features.count_pages(b,p['adjustedSections'])%4,0)
        b['contents']=True;p=features.plan(b,[])
        if p['canFill']:self.assertEqual(features.count_pages(b,p['adjustedSections'])%4,0)

    def test_refresh_retains_slot_rules_and_skipped_filler_fields_do_not_block_preflight(self):
        b=self.body();sec=b['sections'][2];sec.update(block='extra',tripFiller=True,fillerRequiredDays=0,fillerPriority=77)
        objects=[{'id':'extra','kind':'block','revision':2,'title':'New extra','body':{**sec,'fields':[{'key':'Missing','type':'text','page':0,'x':10,'y':10,'w':80,'h':10,'size':11,'template':'{{missing}}','required':True}]}}]
        refreshed=features.refresh_blocks(b,objects);self.assertEqual(refreshed['sections'][2]['fillerPriority'],77)
        with s.db() as c:c.execute('INSERT INTO objects VALUES(?,?,?,?,?)',('extra','block','New extra',2,json.dumps(objects[0]['body'])))
        try:
            self.assertTrue(preflight.check(ctx(),b,objects,False)['errors']);self.assertEqual(preflight.check(ctx(),b,objects,True)['errors'],[])
        finally:
            with s.db() as c:c.execute('DELETE FROM objects WHERE id=?',('extra',))

    def test_source_and_filler_settings_validation(self):
        base={'choice':'document','documentKind':'combinedTickets','ticketSources':['ns','db'],'ticketSourceMode':'all'}
        s.validate_body('template',{'format':'A4','sections':[base]})
        for sources in ([],['ns','ns'],['unknown'],[{}]):
            with self.assertRaises(ValueError):s.validate_body('template',{'format':'A4','sections':[{**base,'ticketSources':sources}]})
        for extra in ({'tripFiller':True},{'fillerRequiredDays':-1},{'fillerPriority':100}):
            with self.assertRaises(ValueError):s.validate_body('template',{'format':'A4','sections':[{**base,**extra}]})
        with self.assertRaises(ValueError):trip_fillers.settings({**self.page('Two',2),'tripFiller':True})

    def test_ordering_hints_use_explicit_headings_and_departure_not_issue_time(self):
        details=ticket_dates.journey_details('SEAT RESERVATION\nDeparture: 12.10.2026 09:40\nIssue time: 12:00')
        self.assertEqual(details,{'documentRole':'reservation','departureTime':'09:40'})
        self.assertEqual(ticket_dates.journey_details('TICKET\nVONAT/TRAIN: 61(12.10.2026 11:40)')['departureTime'],'11:40')
        self.assertEqual(ticket_dates.journey_details('Please make a reservation\nIssue time: 12:00'),{'documentRole':'unknown','departureTime':''})

if __name__=='__main__':unittest.main()
