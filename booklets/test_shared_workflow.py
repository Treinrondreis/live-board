"""Synthetic shared catalogue, cancellation and screen-PDF regressions."""
import io,json,threading,unittest,uuid
from types import SimpleNamespace
from reportlab.pdfgen import canvas
import test_cloud,book_activity,booking_documents,export_checks,ticket_dates

s=test_cloud.cloud.server


class SharedWorkflowTests(unittest.TestCase):
    def save(self,ident=None,revision=None):
        payload={'kind':'book','title':'Synthetic shared book','body':{'format':'A4','sections':[],'values':{}}}
        if ident:payload.update(id=ident,revision=revision)
        status,_,raw=test_cloud.request('/api/save','POST',json.dumps(payload).encode())
        self.assertEqual(status,200,raw)
        return json.loads(raw)

    def test_shared_books_are_immediately_visible_and_creation_order_survives_updates(self):
        first=self.save();second=self.save()
        catalogue=lambda:json.loads(test_cloud.request('/api/state')[2])['objects']
        before={o['id']:o for o in catalogue()}
        self.assertLess(before[first['id']]['createdAt'],before[second['id']]['createdAt'])
        self.save(first['id'],first['revision'])
        after={o['id']:o for o in catalogue()}
        self.assertEqual(before[first['id']]['createdAt'],after[first['id']]['createdAt'])
        self.assertGreater(after[first['id']]['updatedAt'],before[first['id']]['updatedAt'])
        self.assertEqual(after[first['id']]['createdOrder'],before[first['id']]['createdOrder'])

    def test_legacy_books_keep_their_original_order_after_first_update(self):
        ident=uuid.uuid4().hex
        with s.db() as c:
            c.execute('INSERT INTO objects VALUES(?,?,?,?,?)',(ident,'book','Legacy synthetic',1,'{"format":"A4","sections":[]}'))
            book_activity.initialize(c)
            order=next(o['createdOrder'] for o in book_activity.catalogue(c) if o['id']==ident)
        self.save(ident,1)
        with s.db() as c:row=next(o for o in book_activity.catalogue(c) if o['id']==ident)
        self.assertEqual(row['createdAt'],'');self.assertEqual(row['createdOrder'],order)

    def test_preflight_can_be_cancelled_while_heavy_slot_is_busy_and_retried(self):
        ident=uuid.uuid4().hex
        with export_checks.begin(ident):
            test_cloud.cloud.BUSY.acquire()
            try:
                status,_,_=test_cloud.request('/api/export-cancel','POST',json.dumps({'checkId':ident}).encode())
                self.assertEqual(status,200)
            finally:test_cloud.cloud.BUSY.release()
            self.assertRaisesRegex(ValueError,'gestopt',export_checks.check)
        with export_checks.begin(uuid.uuid4().hex):export_checks.check()
        self.assertEqual(test_cloud.request('/api/export-cancel','POST',b'{"checkId":"invalid"}')[0],400)
        self.assertEqual(test_cloud.request('/api/export-cancel','POST',json.dumps({'checkId':ident}).encode(),False)[0],401)

    def test_cancellation_arriving_before_preflight_starts_is_respected(self):
        ident=uuid.uuid4().hex
        export_checks.cancel(ident)
        with self.assertRaisesRegex(ValueError,'gestopt'):
            with export_checks.begin(ident):self.fail('Cancelled check started')
        self.assertNotIn(ident,export_checks.ACTIVE)

    def page(self,title):
        out=io.BytesIO();pdf=canvas.Canvas(out,pagesize=s.SIZES['A4']);pdf.drawString(70,700,title);pdf.showPage();pdf.save()
        result=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),title)
        return {'title':title,'asset':result['asset'],'pages':1,'fields':[]}

    def test_screen_pdf_keeps_selected_pages_without_recto_blanks_or_print_warnings(self):
        body={'format':'A4','outputMode':'screen','duplex':True,'sections':[self.page('Cover'),self.page('Information'),self.page('End')]}
        body['sections'][1].update(recto=True,tripFiller=True)
        self.assertEqual(s.plan(body,[])['needed'],0)
        result=s.make_export({'id':uuid.uuid4().hex,'title':'Synthetic screen booklet','body':body},{'fill':True})
        report=result['report'];self.assertEqual(report['pages'],3);self.assertEqual(report['blanks'],0)
        self.assertEqual(report['fillersSkipped'],[]);self.assertEqual(report['outputMode'],'screen')
        self.assertFalse(any('deelbaar' in w or 'PDF/X' in w for w in report['warnings']))
        self.assertTrue(body['duplex'])

    def test_ticket_moments_span_carriers_but_vouchers_and_source_mode_remain_local(self):
        candidate={'pageSources':[{'travelDate':'2026-10-18'}]}
        body={'sanityBooking':{'journeyDates':['2026-10-12','2026-10-18']},'sections':[]}
        self.assertEqual(ticket_dates.moment_dates(body,{'documentKind':'nsTickets'},candidate),['2026-10-12','2026-10-18'])
        for slot in [{'documentKind':'voucher'},{'documentKind':'nsTickets','ticketDateBasis':'source'}]:
            self.assertEqual(ticket_dates.moment_dates(body,slot,candidate),['2026-10-18'])
        body['outputMode']='unrecognized'
        self.assertRaises(ValueError,s.validate_body,'book',body)

    def test_saving_ns_return_accepts_booking_moment_two_with_one_source_date(self):
        selected=self.page('Synthetic return ticket')
        selected['oneOff']=True
        selected['pageSources']=[{'asset':selected['asset'],'page':0,'travelDate':'2026-10-18'}]
        selected['originalPages']=selected['pageSources'][:]
        slot={'choice':'document','documentKind':'nsTickets','ticketMoment':2,'options':[],'selected':selected}
        body={'format':'A4','sanityBooking':{'id':'synthetic-booking','journeyDates':['2026-10-12','2026-10-18']},'sections':[slot]}
        s.validate_body('book',body)
        slot['ticketDateBasis']='source'
        self.assertRaisesRegex(ValueError,'reismoment',s.validate_body,'book',body)


if __name__=='__main__':unittest.main()
