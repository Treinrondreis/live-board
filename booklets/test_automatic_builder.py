import copy,json,unittest
import automatic_builder as a

def block(ident,title,role='',**body):
    return {'id':ident,'kind':'block','title':title,'revision':1,'body':{'format':'A4','asset':ident,'pages':1,'fields':[],'autoBuild':{'role':role},**body}}

class AutomaticBuilderTests(unittest.TestCase):
    def propose(self,objects,**payload):return a.propose(objects,{'kind':'template','journey':'Wenen Nightjet RITAD Premier Inn Wien',**payload})
    def chosen(self,p,role):return [s for s in p['body']['sections'] if s.get('autoProposal',{}).get('role')==role]

    def test_existing_types_and_strong_full_todo_match_beat_default(self):
        rows=[block('general','Algemeen','cover',autoBuild={'role':'cover','default':True}),block('vienna','Wenen','',pageType='Voorpagina',autoBuild={'todo':'RITAD'})]
        p=self.propose(rows,kind='book',journey='',booking={'id':'booking','trip':'Reis','todos':[{'title':'NJ | RITAD extra'}]})
        s=self.chosen(p,'cover')[0];self.assertEqual(s['selected']['block'],'vienna');self.assertFalse(s['autoProposal']['uncertain'])
        self.assertEqual(len(s['options']),2)

    def test_codes_not_substrings_and_phrase_not_split_across_todos(self):
        context=a.context_for({'kind':'template','journey':'CORA2','booking':{'todos':[{'title':'Premier Inn'},{'title':'Wien'}]}})
        self.assertEqual(a.rank({'autoBuild':{'todo':'CORA; Premier Inn Wien'}},'',context)[0],0)
        self.assertEqual(a.rank({'autoBuild':{'todo':'CORA2'}},'',context)[0],85)

    def test_train_and_route_groups_and_no_unrelated_destination(self):
        rows=[block('nightjet','Nightjet','train',autoBuild={'role':'train','trains':'Nightjet','group':'Nightjet'}),block('ice','ICE','train',autoBuild={'role':'train','trains':'ICE','group':'ICE'}),block('paris','Parijs','destination',destination='Parijs'),block('route','Station naar hotel','route',destination='Wenen',todoMatch='Premier Inn Wien')]
        p=self.propose(rows);self.assertEqual([s['selected']['block'] for s in self.chosen(p,'train')],['nightjet']);self.assertEqual(self.chosen(p,'destination'),[]);self.assertEqual(self.chosen(p,'route')[0]['selected']['block'],'route')

    def test_tie_and_weak_fallback_are_visible_deterministic_proposals(self):
        rows=[block('b','Zebra','cover',autoBuild={'role':'cover','destinations':'Wenen'}),block('a','Alpha','cover',autoBuild={'role':'cover','destinations':'Wenen'}),block('f','Voorwoord','foreword')]
        p=self.propose(rows);s=self.chosen(p,'cover')[0];self.assertEqual(s['selected']['block'],'a');self.assertTrue(s['autoProposal']['uncertain']);self.assertTrue(self.chosen(p,'foreword')[0]['autoProposal']['uncertain'])
        self.assertEqual(p,self.propose(list(reversed(rows))))

    def test_shared_choices_retain_group_default_and_current_options(self):
        rows=[block('a','ICE','train'),block('b','Nightjet','train')]
        rows.append({'id':'shared','kind':'choice','title':'Treinreis','revision':4,'body':{'format':'A4','autoBuild':{'role':'train','trains':'Nightjet'},'slot':{'choice':'manual','options':[{'block':'a','asset':'old','todoMatch':'ICE','todoMatchOverride':True},{'block':'b','todoMatch':'RITAD','todoMatchOverride':True}],'selected':{'block':'b'}}}})
        p=self.propose(rows,kind='book',booking={'id':'booking','todos':[{'title':'RITAD'}]});s=self.chosen(p,'train')[0];self.assertEqual(s['selected']['block'],'b');self.assertEqual(s['choiceSource'],'shared');self.assertEqual(s['choiceRevision'],4);self.assertEqual(s['selected']['asset'],'b');self.assertFalse(s['autoProposal']['uncertain'])

    def test_group_match_cannot_overrule_the_matching_alternative(self):
        rows=[block('a','General default','train',autoBuild={'role':'train','todo':'OTHER'}),block('b','Nightjet','train',autoBuild={'role':'train','todo':'RITAD'})]
        rows.append({'id':'shared','kind':'choice','title':'Train group','revision':1,'body':{'format':'A4','autoBuild':{'role':'train','todo':'RITAD'},'slot':{'choice':'manual','options':[{'block':'a'},{'block':'b'}],'selected':{'block':'a'}}}})
        p=self.propose(rows,kind='book',booking={'id':'booking','todos':[{'title':'RITAD'}]});self.assertEqual(self.chosen(p,'train')[0]['selected']['block'],'b')
        slot=self.chosen(p,'train')[0]
        p=a.reselect(rows,{'format':'A4','booking':{'id':'next','todos':[{'title':'RITAD'}]},'sections':[slot]})
        self.assertEqual(p['choices'][0]['block'],'b')

    def test_inactive_wrong_format_and_explicit_exclusion_never_used(self):
        p=self.propose([block('a','Archived','cover',archived=True),block('b','A5','cover',format='A5'),block('c','Deleted','cover',deletedAt='today'),block('d','Excluded','exclude')])
        self.assertEqual(self.chosen(p,'cover'),[]);self.assertTrue(p['body']['contents']);self.assertIn('Voorpagina',p['missing'])

    def test_customer_data_never_in_template_and_library_is_unchanged(self):
        rows=[block('cover','Cover','cover',values={'klantachternaam':'Do not copy'})];before=copy.deepcopy(rows)
        p=self.propose(rows,booking={'id':'customer','name':'Private Name','values':{'klantachternaam':'Private Name'},'trip':'Reis Wenen','todos':[{'title':'RITAD'}]})
        self.assertNotIn('Private Name',json.dumps(p));self.assertNotIn('sanityBooking',p['body']);self.assertEqual(p['body']['values'],{});self.assertEqual(rows,before)

    def test_documents_use_all_sources_without_invented_moments(self):
        p=self.propose([]);slots=[s for s in p['body']['sections'] if s['choice']=='document'];self.assertEqual([s['documentKind'] for s in slots],['letter','schedule','combinedTickets','voucher'])
        ticket=slots[2];self.assertEqual(ticket['ticketSources'],list(a.PROVIDERS));self.assertFalse(ticket['pageNumbers']);self.assertEqual(ticket['ticketMoment'],0);self.assertIsNone(ticket['selected']);self.assertEqual(slots[3]['voucherMoment'],0)

    def test_generated_template_reselects_only_allowed_pages_for_new_booking(self):
        rows=[block('vienna','Wenen','cover',autoBuild={'role':'cover','destinations':'Wenen'}),block('paris','Parijs','cover',autoBuild={'role':'cover','destinations':'Parijs'}),block('outside','Not allowed','cover',autoBuild={'role':'cover','todo':'RITAD'})]
        slots=self.propose(rows)['body']['sections'];cover=next(s for s in slots if s.get('autoProposal',{}).get('role')=='cover');cover['options']=[o for o in cover['options'] if o['block']!='outside']
        p={'format':'A4','booking':{'id':'new-booking','trip':'Parijs','todos':[{'title':'RITAD'}]},'sections':[cover]}
        result=a.reselect(rows,p);self.assertEqual(result['choices'][0]['block'],'paris')
        cover['choiceUserSelected']=True;self.assertEqual(a.reselect(rows,p)['choices'],[])
        cover.pop('choiceUserSelected');rows[1]['body']['archived']=True;self.assertEqual(a.reselect(rows,p)['choices'][0]['block'],'vienna');self.assertTrue(a.reselect(rows,p)['choices'][0]['autoProposal']['uncertain'])

    def test_input_limits_and_settings(self):
        for payload in ({'kind':'x'}, {'format':'A3'}, {'journey':'x'*4001}, {'kind':'book','booking':{}}, {'booking':{'todos':42}}):
            with self.assertRaises(ValueError):self.propose([],**payload)
        for value in (None,{'role':'unknown'},{'description':'x'*2001},{'default':1},{'secret':'x'}):
            with self.assertRaises(ValueError):a.settings({'autoBuild':value})
        a.settings({'autoBuild':{'role':'cover','description':'Wenen','default':True}})

    def test_authenticated_endpoint_validates_real_assets_and_never_saves_proposal(self):
        import test_cloud,booking_documents,io
        from types import SimpleNamespace
        from reportlab.pdfgen import canvas
        s=test_cloud.cloud.server;out=io.BytesIO();c=canvas.Canvas(out,pagesize=s.SIZES['A4']);c.showPage();c.save()
        pdf=booking_documents.store(SimpleNamespace(**vars(s)),out.getvalue(),'Automatic proof')
        item=block('automatic-proof','Voorpagina Wenen','cover',asset=pdf['asset'])
        with s.db() as db:db.execute('INSERT INTO objects VALUES(?,?,?,?,?)',(item['id'],item['kind'],item['title'],1,json.dumps(item['body'])))
        try:
            payload=json.dumps({'kind':'template','journey':'Wenen'}).encode()
            self.assertEqual(test_cloud.request('/api/automatic-build','POST',payload,authorized=False)[0],401)
            status,_,raw=test_cloud.request('/api/automatic-build','POST',payload);self.assertEqual(status,200,raw)
            result=json.loads(raw);s.validate_body('template',result['body']);self.assertEqual(result['catalogRevisions']['automatic-proof'],1)
            with s.db() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM objects WHERE kind='template' AND title='Wenen'").fetchone()[0],0)
        finally:
            with s.db() as db:db.execute('DELETE FROM objects WHERE id=?',(item['id'],))

if __name__=='__main__':unittest.main()
