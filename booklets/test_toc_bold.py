import io,unittest
import pdfplumber
from reportlab.pdfgen import canvas
from types import SimpleNamespace
import test_cloud,book_layout,features,booking_documents
s=test_cloud.cloud.server

class TocBoldTests(unittest.TestCase):
    def sections(self):
        return [{'title':'Belangrijke informatie','tocBold':True},{'title':'Reisschema'},{'title':'Verborgen hoofdstuk','tocHidden':True,'tocBold':True}]

    def assert_fonts(self,raw):
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            words=pdf.pages[0].extract_words(extra_attrs=['fontname'])
            for text,bold in [('Belangrijke',True),('informatie',True),('3',True),('Reisschema',False),('7',False)]:
                word=next(w for w in words if w['text']==text)
                self.assertEqual('Bold' in word['fontname'],bold,text)
            self.assertNotIn('Verborgen',pdf.pages[0].extract_text())

    def test_title_and_number_use_bold_in_both_contents_modes_and_fonts(self):
        sections=self.sections();starts={0:2,1:6,2:9}
        for font in ('Booklet','Montserrat'):
            rows=book_layout.contents_field_layout(sections,starts,450,10.5,'#1A1A1A',font)
            out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4'])
            book_layout.draw_contents_field(cv,rows,70,740,450,10.5,font,'#1A1A1A');cv.save()
            self.assert_fonts(out.getvalue())
        from pypdf import PdfWriter
        for fmt in ('A4','A5'):
            writer=PdfWriter();writer.add_page(book_layout.render_contents(book_layout.contents_plan(sections)[0],starts,0,s.SIZES[fmt]));out=io.BytesIO();writer.write(out)
            self.assert_fonts(out.getvalue())

    def test_library_defaults_and_local_false_override_survive_refresh_and_choice_changes(self):
        obj={'id':'guide','kind':'block','revision':2,'title':'Wenen','body':{'asset':'a','pages':2,'tocBold':True}}
        body={'sections':[{'block':'guide'},{'block':'guide','tocBold':False,'tocBoldOverride':True},{'choice':'manual','tocBold':False,'tocBoldOverride':True,'options':[{'block':'guide'}],'selected':{'block':'guide'}},{'choice':'document','tocBold':True,'selected':{'title':'Brief','pages':1}}]}
        refreshed=features.refresh_blocks(body,[obj]);sections=features.resolved(refreshed)
        self.assertEqual([bool(sec.get('tocBold')) for sec in sections],[True,False,False,True])
        self.assertTrue(refreshed['sections'][2]['selected']['tocBold'],'library snapshot stays independent of slot preference')
        self.assertNotIn('tocBold',body['sections'][0],'refresh does not mutate stored book')

    def test_production_export_uses_document_preference_and_rejects_non_boolean_values(self):
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=s.SIZES['A4']);cv.showPage();cv.save()
        asset=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'TOC test')
        section={'asset':asset['asset'],'pages':1,'fields':[],'title':'Reisschema'}
        toc={**section,'title':'Inhoudsopgave','tocHidden':True,'fields':[{'key':'Inhoudsopgave','type':'contents','page':0,'x':12,'y':20,'w':76,'h':65,'size':10.5,'font':'Open Sans','color':'#1A1A1A'}]}
        body={'format':'A4','duplex':False,'sections':[toc,{'choice':'document','documentKind':'letter','tocBold':True,'selected':{**section,'title':'Belangrijke informatie'}},section]}
        result=s.make_export({'id':'toc-test','title':'TOC test','body':body},{'allowUneven':True})
        with pdfplumber.open(s.DATA/'exports'/f"{result['id']}.pdf") as pdf:
            words=pdf.pages[0].extract_words(extra_attrs=['fontname'])
            self.assertIn('Bold',next(w for w in words if w['text']=='Belangrijke')['fontname'])
            self.assertNotIn('Bold',next(w for w in words if w['text']=='Reisschema')['fontname'])
        for value in ('true',1,None):
            body['sections'][1]['tocBold']=value
            self.assertRaisesRegex(ValueError,'vetgedrukte',s.validate_body,'book',body)

if __name__=='__main__':unittest.main()
