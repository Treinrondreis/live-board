"""Local, deterministic journey proposals. Reads the library; never writes source data."""
import copy
import re
from features import norm, snapshot

ROLES = ('', 'cover', 'contents', 'foreword', 'destination', 'train', 'route', 'separator', 'ending', 'exclude')
LABELS = {'cover':'Voorpagina', 'contents':'Inhoudsopgave', 'foreword':'Voorwoord',
          'destination':'Bestemming', 'train':'Treininformatie', 'route':'Route',
          'separator':'Tickets & Vouchers', 'ending':'Afsluiting'}
PROVIDERS = ('ns', 'mav', 'db', 'obb', 'cd', 'dfds', 'trainline', 'raileurope', 'sbb', 'sanity', 'finnlines', 'fjordline', 'entur', 'ltg', 'renfe', 'snalltaget')

def settings(body):
    if 'autoBuild' not in body:return
    config=body['autoBuild']
    if not isinstance(config,dict):raise ValueError('Ongeldige instellingen voor automatisch bouwen.')
    if config.get('role','') not in ROLES:raise ValueError('Kies het gebruik van deze pagina bij automatisch bouwen.')
    for key,limit in [('destinations',500),('trains',500),('todo',500),('description',2000),('group',160)]:
        if not isinstance(config.get(key,''),str) or len(config.get(key,''))>limit:raise ValueError('Te lange herkenningstekst voor automatisch bouwen: '+key+'.')
    if 'default' in config and type(config['default']) is not bool:raise ValueError('Kies wel of geen standaard voor automatisch bouwen.')
    if any(key not in ('role','destinations','trains','todo','description','group','default') for key in config):raise ValueError('Onbekende instelling voor automatisch bouwen.')

def text(value,limit):
    if not isinstance(value,str) or len(value)>limit:raise ValueError('Ongeldige reisomschrijving.')
    return ' '.join(norm(value).split())

def phrases(value):return [text(v,2000) for v in value.split(';') if v.strip()]

def contains(haystack,needle):
    # Codes and names must be complete words: CORA must not match CORA2.
    return bool(needle and re.search(r'(?<!\w)'+re.escape(needle)+r'(?!\w)',haystack))

def inferred_role(body):
    configured=body.get('autoBuild',{}).get('role')
    if configured:return configured
    types={'Voorpagina':'cover','Inhoudsopgave':'contents','Voorwoord':'foreword','Tickets & Vouchers':'separator','Route':'route'}
    if body.get('pageType') in types:return types[body['pageType']]
    cats=body.get('categories') or [body.get('category','')]
    for category,role in [('Routes','route'),('Voorwoord','foreword'),('Bestemming','destination'),('Treinen','train'),('Trein','train')]:
        if category in cats:return role
    if body.get('destination'):return 'destination'
    return ''

def rank(body,title,context):
    config=body.get('autoBuild',{})
    todo=[]
    if body.get('todoMatchOverride'):todo.extend((needle,105) for needle in phrases(body.get('todoMatch','')))
    todo.extend((needle,100) for needle in phrases(config.get('todo','')))
    todo.extend((needle,100) for needle in phrases(body.get('todoMatch','')))
    for needle,points in todo:
        if any(contains(t,needle) for t in context['todos']):return points,'ToDo herkend: '+needle
        if contains(context['journey'],needle):return 85,'Reisomschrijving bevat: '+needle
    for key,label,points in [('destinations','Bestemming',70),('trains','Trein',65)]:
        candidates=phrases(config.get(key,''))
        if key=='destinations' and body.get('destination'):candidates+=phrases(body['destination'])
        for needle in candidates:
            if contains(context['all'],needle):return points,label+' herkend: '+needle
    description=config.get('description','')
    words=set(re.findall(r'[\w-]{4,}',text(description,2000))) - {'voor','deze','pagina','reis','reizen','naar','over','informatie','trein','hotel','alleen','wordt','with','from'}
    matches=sorted(w for w in words if contains(context['all'],w))
    if matches:return min(40,20+len(matches)*3),'Omschrijving past bij: '+', '.join(matches[:5])
    if config.get('default'):return 5,'Ingesteld als algemene standaard'
    return 0,'Geen duidelijke herkenning; eerste beschikbare keuze voorgesteld'

def context_for(payload):
    kind=payload.get('kind')
    if kind not in ('book','template'):raise ValueError('Kies een boekje of sjabloonvoorstel.')
    fmt=payload.get('format','A4')
    if fmt not in ('A4','A5'):raise ValueError('Kies A4 of A5.')
    journey=text(payload.get('journey',''),4000)
    booking=payload.get('booking') or {}
    if not isinstance(booking,dict):raise ValueError('Ongeldige boeking.')
    if kind=='book' and (not isinstance(booking.get('id'),str) or not re.fullmatch(r'[\w.-]{1,200}',booking['id'])):raise ValueError('Selecteer eerst de juiste Sanity-boeking.')
    rows=booking.get('todos',[])
    if not isinstance(rows,list) or len(rows)>500 or any(not isinstance(t,dict) for t in rows):raise ValueError('Ongeldige ToDo-lijst.')
    todos=[text(t.get('title',''),2000)+' '+text(t.get('description',''),4000) for t in rows]
    trip=text(booking.get('trip',''),2000)
    if not journey and not trip and not todos:raise ValueError('Beschrijf de reis of kies een boeking met reisinformatie.')
    return {'kind':kind,'format':fmt,'journey':journey,'todos':todos,'rows':rows,'all':' '.join([journey,trip,*todos])}

def catalog(objects,context):
    blocks={o['id']:o for o in objects if o['kind']=='block' and not o['body'].get('archived') and not o['body'].get('deletedAt') and o['body'].get('format')==context['format']}
    groups=[];owned=set()
    for o in sorted(objects,key=lambda o:(norm(o['title']),o['id'])):
        b=o['body']
        if o['kind']!='choice' or b.get('archived') or b.get('deletedAt') or b.get('format')!=context['format']:continue
        slot=b.get('slot',{})
        if slot.get('choice')=='route':
            options=[snapshot(x) for x in blocks.values() if inferred_role(x['body'])=='route' and norm(x['body'].get('country',''))==norm(slot.get('country','')) and (not slot.get('destination') or norm(x['body'].get('destination',''))==norm(slot['destination']))]
        else:
            options=[]
            for stored in slot.get('options',[]):
                block=blocks.get(stored.get('block'))
                if not block or inferred_role(block['body'])=='exclude':continue
                option=snapshot(block)
                if stored.get('todoMatchOverride'):option.update(todoMatch=stored.get('todoMatch',''),todoMatchOverride=True)
                options.append(option)
        roles={inferred_role(blocks[x['block']]['body']) for x in options}
        role=b.get('autoBuild',{}).get('role') or ('route' if slot.get('choice')=='route' else next(iter(roles)) if len(roles)==1 else '')
        if not options or role not in LABELS:continue
        group_body={**b,'destination':slot.get('destination','')}
        groups.append({'title':o['title'],'role':role,'options':options,'body':group_body,'source':o,'default':slot.get('selected',{}).get('block') if slot.get('selected') else None})
        owned.update(x['block'] for x in options)
    generated={}
    for o in sorted(blocks.values(),key=lambda o:(norm(o['title']),o['id'])):
        if o['id'] in owned:continue
        b=o['body'];role=inferred_role(b)
        if role not in LABELS:continue
        config=b.get('autoBuild',{})
        group=config.get('group') or (b.get('destination') if role in ('destination','route') else '') or (config.get('trains','').split(';')[0] if role=='train' else '')
        if role in ('cover','contents','foreword','separator','ending'):group=''
        # Unrelated destination/train pages should never be bundled together.
        if not group and role in ('destination','route','train'):group=o['title']
        key=(role,norm(group))
        if key not in generated:generated[key]={'title':group or LABELS[role],'role':role,'body':{},'options':[]}
        generated[key]['options'].append(snapshot(o))
    return groups+list(generated.values()),blocks

def ranked_group(group,blocks,context):
    group_score,group_reason=rank(group['body'],group['title'],context)
    # A group match says to include the group, not which of its alternatives fits.
    if len(group['options'])>1:group_score=min(55,group_score)
    options=[]
    for option in group['options']:
        body={**blocks[option['block']]['body']}
        if option.get('todoMatchOverride'):
            body['todoMatch']=option.get('todoMatch','')
            body['todoMatchOverride']=True
        points,reason=rank(body,option['title'],context)
        if points<group_score:points,reason=group_score,group_reason
        default=group.get('default')==option['block']
        options.append((points,default,norm(option['title']),option['block'],reason,option))
    options.sort(key=lambda x:(-x[0],-x[1],x[2],x[3]))
    options=options[:100]
    best=options[0];tie=len(options)>1 and best[:2]==options[1][:2]
    uncertain=best[0]<60 or tie
    slot={'choice':'manual','title':group['title'],'options':[copy.deepcopy(x[5]) for x in options], 'selected':copy.deepcopy(best[5]),'values':{},'recto':False,
          'autoProposal':{'uncertain':uncertain,'reason':best[4]+(' · Meerdere keuzes passen even goed' if tie else ''),'role':group['role']}}
    if group.get('source'):slot.update(choiceSource=group['source']['id'],choiceRevision=group['source']['revision'])
    return best[0],slot

def document(kind,title,fmt,moment=0):
    ticket=kind=='combinedTickets'
    slot={'choice':'document','documentKind':kind,'title':title,'tocTitle':title,'options':[],'selected':None,'pageNumbers':not ticket,
          'numberX':89,'numberY':95 if fmt=='A4' else 90,'sortByDate':ticket or kind=='voucher','preferOriginalPdf':False}
    if ticket:slot.update(ticketSources=list(PROVIDERS),ticketSourceMode='all',ticketMoment=moment)
    if kind=='voucher':slot['voucherMoment']=moment
    return slot

def journey_documents(context):
    # The PDFs determine the actual moments. Do not invent a date from a hotel/ToDo.
    # All pages initially stay together; the existing document tray can split them.
    return [document('combinedTickets','Treintickets',context['format']),document('voucher','Vouchers',context['format'])]

def propose(objects,payload):
    context=context_for(payload);groups,blocks=catalog(objects,context)
    by_role={role:[] for role in LABELS}
    for group in groups:
        points,slot=ranked_group(group,blocks,context)
        by_role[group['role']].append((points,slot))
    sections=[];warnings=[];missing=[];used=set()
    def add_role(role,required=False,multiple=False):
        candidates=sorted(by_role[role],key=lambda x:(-x[0],norm(x[1]['title'])))
        if multiple:candidates=[x for x in candidates if x[0]>=20]
        if not candidates:
            if required:missing.append(LABELS[role]);warnings.append('Geen geschikte '+LABELS[role].lower()+' in de bibliotheek. Voeg deze later toe.')
            return
        if not multiple:
            if len(candidates)>1 and candidates[0][0]==candidates[1][0]:
                candidates[0][1]['autoProposal'].update(uncertain=True,reason=candidates[0][1]['autoProposal']['reason']+' · Meerdere keuzegroepen passen even goed')
            candidates=candidates[:1]
        for _,slot in candidates:
            ident=slot['selected']['block']
            if ident in used:continue
            used.add(ident);sections.append(slot)
    add_role('cover',True);add_role('contents',True);add_role('foreword',True)
    sections.extend([document('letter','Brief',context['format']),document('schedule','Reisschema',context['format'])])
    add_role('train',multiple=True);add_role('route',multiple=True);add_role('destination',multiple=True)
    add_role('separator',True);sections.extend(journey_documents(context));add_role('ending')
    if len(sections)>100:raise ValueError('Te veel passende pagina’s. Verfijn de herkenningsinstellingen.')
    body={'format':context['format'],'sections':sections,'values':{},'duplex':True,'binding':'wire-o','status':'Concept'}
    if 'Inhoudsopgave' in missing:body['contents']=True
    warnings.append('Tickets en vouchers staan eerst per documentsoort bij elkaar en worden binnen die soort op datum gesorteerd. Verdeel heenreis, hotel en terugreis na het ophalen via de documentenbak; de echte PDF-datums bepalen de reismomenten.')
    warnings.append('Controleer na het ophalen of alle tickets, reserveringen en gecontroleerde vouchers aanwezig zijn. Ontbrekende documenten blijven zichtbaar en kunnen bewust worden overgeslagen.')
    title=payload.get('title') or payload.get('journey') or (payload.get('booking') or {}).get('trip') or 'Reisvoorstel'
    if not isinstance(title,str):raise ValueError('Ongeldige naam voor het voorstel.')
    return {'kind':context['kind'],'title':title.strip()[:160],'body':body,'warnings':warnings,'missing':missing,
            'uncertain':sum(bool(s.get('autoProposal',{}).get('uncertain')) for s in sections)}

def reselect(objects,payload):
    """Reusing a generated template ranks only its allowed alternatives."""
    context=context_for({**payload,'kind':'book'});rows=payload.get('sections',[])
    if not isinstance(rows,list) or len(rows)>100:raise ValueError('Maximaal 100 hoofdstukken bij de herkenning.')
    _,blocks=catalog(objects,context);sources={o['id']:o for o in objects if o['kind']=='choice'}
    results=[]
    for index,slot in enumerate(rows):
        if not isinstance(slot,dict):raise ValueError('Ongeldig hoofdstuk.')
        if slot.get('choice') not in ('manual','route') or not slot.get('autoProposal') or slot.get('choiceUserSelected'):continue
        stored=slot.get('options',[])
        if not isinstance(stored,list) or len(stored)>100 or any(not isinstance(o,dict) for o in stored):raise ValueError('Maximaal 100 toegestane alternatieven.')
        options=[]
        for option in stored:
            if option.get('block') not in blocks:continue
            if inferred_role(blocks[option['block']]['body'])=='exclude':continue
            options.append(copy.deepcopy(option))
        if not options:
            results.append({'index':index,'block':None,'autoProposal':{'uncertain':True,'reason':'Geen actieve toegestane pagina beschikbaar; kies een andere pagina'}});continue
        source=sources.get(slot.get('choiceSource'))
        role=slot.get('autoProposal',{}).get('role','')
        group={'title':slot.get('title','Keuzepagina'),'role':role,'body':source['body'] if source else {},'options':options}
        if source:
            selected=source['body'].get('slot',{}).get('selected')
            group['default']=selected.get('block') if selected else None
            matches={o.get('block'):o for o in source['body'].get('slot',{}).get('options',[])}
            for option in options:
                if option['block'] in matches:option.update(todoMatch=matches[option['block']].get('todoMatch',''),todoMatchOverride=True)
        _,ranked=ranked_group(group,blocks,context)
        results.append({'index':index,'block':ranked['selected']['block'],'autoProposal':ranked['autoProposal']})
    return {'choices':results}
