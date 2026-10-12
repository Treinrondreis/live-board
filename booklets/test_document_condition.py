import io,unittest
from types import SimpleNamespace
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud,features,preflight,booking_documents
s=test_cloud.cloud.server

class DocumentConditionTests(unittest.TestCase):
    def body(self,matches=False):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.showPage();cv.save()
        a=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Condition test')
        page={'title':'Nightjet','asset':a['asset'],'pages':1,'fields':[]}
        optional={'choice':'document','documentKind':'nsTickets','title':'Aansluiting','todoCondition':'CORA2','ticketMoment':3,'selected':None,'todoConditionState':{'bookingId':'customer','text':'CORA2','matches':matches}}
        return {'format':'A4','duplex':False,'sanityBooking':{'id':'customer'},'sections':[page,optional]}

    def test_skip_does_not_create_missing_pages_or_contents_entries(self):
        b=self.body();b['sections'][1]['selected']={**b['sections'][0],'title':'Aansluiting','reviewRequired':True}
        self.assertEqual(len(features.resolved(b)),1)
        self.assertEqual(features.plan(b,[])['missing'],[])
        result=preflight.check(SimpleNamespace(**vars(s)),b,[])
        self.assertEqual(result['errors'],[]);self.assertEqual(result['pages'],1)
        export=s.make_export({'id':'condition-test','title':'Test','body':b},{'allowUneven':True})
        self.assertEqual(len(PdfReader(s.DATA/'exports'/f"{export['id']}.pdf").pages),1)

    def test_matching_condition_requires_document_and_unknown_checks_block_export(self):
        b=self.body(True)
        self.assertTrue(preflight.check(SimpleNamespace(**vars(s)),b,[])['errors'])
        self.assertRaisesRegex(ValueError,'ontbrekende',s.make_export,{'id':'test','title':'Test','body':b},{'allowUneven':True})
        for change in ('text','bookingId','missing'):
            b=self.body();state=b['sections'][1]['todoConditionState']
            if change=='missing':b['sections'][1].pop('todoConditionState')
            else:state[change]='different'
            self.assertIsNone(features.document_condition(b['sections'][1],b))
            self.assertRaisesRegex(ValueError,'ToDo-voorwaarden',s.make_export,{'id':'test','title':'Test','body':b},{'allowUneven':True})

    def test_templates_keep_phrase_but_never_customer_check_and_validate_input(self):
        for extra in ({'todoCondition':True},{'todoCondition':'x'*301},{'todoConditionState':{'matches':False}}, {'todoConditionState':{'bookingId':'customer','text':'CORA2','matches':False}}):
            with self.subTest(extra=extra),self.assertRaises(ValueError):s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'nsTickets',**extra}]})
        s.validate_body('template',{'format':'A4','sections':[{'choice':'document','documentKind':'nsTickets','todoCondition':'CORA2','ticketMoment':3}]})

if __name__=='__main__':unittest.main()
