"""Read labelled journey/check-in dates; never sort by issue, birth or mail dates."""
import re,time
from datetime import date
from pypdf import PdfReader

PROVIDERS=('ns','mav','db','obb','cd','dfds','trainline','raileurope','sbb','finnlines','fjordline','entur','ltg','renfe','snalltaget','sanity','ratehawk','voucher')
DATE=r'(?:20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2})'
MONTHS={name:n for n,names in enumerate(('januari january','februari february','maart march','april','mei may','juni june','juli july','augustus august','september','oktober october','november','december'),1) for name in names.split()}
MONTHS.update({name:n for n,name in enumerate(('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'),1)})
WRITTEN_DATE=r'\d{1,2}\s+(?:'+'|'.join(MONTHS)+r')\s+20\d{2}'

def voucher_iso(value):
    parsed=iso(value)
    if parsed:return parsed
    m=re.fullmatch(r'(\d{1,2})\s+([a-z]+)\s+(20\d{2})',str(value).strip(),re.I)
    if not m or m[2].lower() not in MONTHS:return ''
    return iso(f'{m[3]}-{MONTHS[m[2].lower()]:02}-{int(m[1]):02}')

def iso(value):
    m=re.fullmatch(r'(\d{1,4})[.\-/](\d{1,2})[.\-/](\d{1,4})',str(value or '').strip())
    if not m:return ''
    a,b,c=map(int,m.groups());y,month,day=(a,b,c) if a>=2000 else (c,b,a)
    if not 2000<=y<=2099:return ''
    try:return date(y,month,day).isoformat()
    except ValueError:return ''

def labelled_date(text,provider,allowed=()):
    text=text[:100000]
    if provider in ('voucher','ratehawk'):labels=r'check[ -]?in|incheck(?:datum|en)?|arrival(?: date)?|aankomst(?:datum)?'
    else:labels=r'date of travel|fecha(?: de viaje)?|vertrek(?:datum)?|departure(?: date)?|abfahrt(?: am)?|d[eé]part(?: le)?|travel date|reisdatum|odjezd'
    printed_date=rf'(?:{DATE}|{WRITTEN_DATE})' if provider in ('voucher','ratehawk','trainline','raileurope','sbb','sanity') else DATE
    patterns=[rf'(?:{labels})\s*[:：]?\s*[^\d\n]{{0,30}}({printed_date})']
    if provider in ('trainline','renfe','sanity'):
        # UK PDFs join the date's words; only normalize alongside CRS route codes.
        text=re.sub(r'(\d{1,2})(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(20\d{2})(?=\s+[A-Z]{3}\s*[-–]\s*[A-Z]{3}\b)',r'\1 \2 \3',text,flags=re.I)
        patterns[:0]=[rf'(?m)^\s*Origen:\s*[^\n]{{1,100}}?\s+({DATE})\s+\d{{1,2}}:\d{{2}}',rf'(?m)^\s*({DATE})[ \t]*\r?\n[ \t]*Origen:[^\n]{{1,100}}\r?\n[ \t]*Destino:',rf'(?m)^\s*({WRITTEN_DATE})\s+[A-Z]{{3}}\s*[-–]\s*[A-Z]{{3}}\b']
    if provider=='finnlines' or provider=='sanity' and re.search(r'Finnlines',text,re.I):patterns[:0]=[rf'(?m)^[^\d\n]{{2,80}}[-–][^\d\n]{{2,80}}\s*({DATE})\s*\d{{1,2}}[:.]\d{{2}}\s*{DATE}\s*\d{{1,2}}[:.]\d{{2}}']
    if provider=='fjordline' or provider=='sanity' and re.search(r'Fjord\s*Line',text,re.I):
        # PDF extraction can insert the adjacent Payment Details heading before the sailing row.
        sailing_time=r'(?:[01]?\d|2[0-3])[.:][0-5]\d'
        patterns[:0]=[rf'Travel\s*details\s*(?:Name\s*of\s*passengers\s*)?({DATE})\b',rf'(?m)Travel[ \t]*details[ \t]*\r?\n[ \t]*Payment[ \t]*Details[ \t]*\r?\n[ \t]*({DATE})[ \t]+{sailing_time}[ \t]+{sailing_time}[ \t]*$']
    if provider=='ltg' or provider=='sanity' and re.search(r'LTG|E\.\s*bilietas',text,re.I):patterns.insert(0,rf'(?m)^[ \t]*(?:DATA[ \t]*\n[ \t]*)?DATE[ \t]+({DATE})[ \t]*$')
    if provider=='snalltaget' or provider=='sanity' and re.search(r'Sn[aä]llt[aå]get',text,re.I):patterns.insert(0,rf'Ticket,[ \t]*valid[ \t]+({DATE})')
    if provider=='ratehawk':patterns.insert(0,rf'(?:Inchecken|Check[ -]?in)[ \t]*\n(?:[^\d\n]{{1,120}}\n){{0,2}}[ \t]*({DATE})')
    if provider=='mav':patterns.insert(0,rf'(?:VONAT\s*/\s*TRAIN|TRAIN)\s*:\s*\d+\s*\(\s*({DATE})')
    if provider in ('trainline','raileurope','sbb','sanity'):patterns.append(rf'(?m)^\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mo|tu|we|th|fr|sa|su),?\s+({printed_date})')
    for pattern in patterns:
        values={(voucher_iso(m[1]) if provider in ('voucher','ratehawk','trainline','raileurope','sbb','sanity') else iso(m[1])) for m in re.finditer(pattern,text,re.I)}-{''}
        if values:return (next(iter(values)),'pdf',False) if len(values)==1 else ('','ambiguous',True)
    if provider not in ('voucher','ratehawk'):
        # Validity is an anchor, not a birthday or the date the ticket was issued.
        validity=list(re.finditer(rf'(?:g[eü]ltig(?:keit)?(?:\s*(?:ab|von))?|geldig(?:\s*(?:van|vanaf))?|valid(?:ity)?(?:\s*from)?|platnost(?:\s*od)?|first day of validity|[eé]rv[eé]nyes\s*/\s*valid)\s*[:：]?\s*({DATE})',text,re.I))
        values={iso(m[1]) for m in validity}-{''}
        # Nightjet tables often print departure as dd.mm, omitting its year.
        route=re.search(r'\b(\d{2}[.]\d{2})[.]?\s+\d{2}:\d{2}\s+[^\n]{2,100}(?:->|→)',text)
        if route:
            day,month=map(int,route[1].split('.'))
            candidates={d for d in allowed if iso(d) and int(d[5:7])==month and int(d[8:10])==day}
            if len(candidates)==1:return next(iter(candidates)),'pdf-timetable',False
            if len(values)==1:
                anchor=next(iter(values));year=int(anchor[:4])+(1 if anchor[5:7]=='12' and month==1 else 0)
                result=iso(f'{year}-{month:02}-{day:02}')
                if result:return result,'pdf-timetable',False
        if len(values)==1:
            value=next(iter(values))
            for m in validity:
                tail=text[m.end():].split('\n',1)[0][:100]
                for other in re.findall(DATE,tail):
                    end=iso(other)
                    if end and abs((date.fromisoformat(end)-date.fromisoformat(value)).days)>1:return value,'pdf-validity-range',True
            return value,'pdf-validity',False
        if len(values)>1:return '','ambiguous',True
    return '','unknown',True


def moment_dates(body,slot,candidate):
    dates={p.get('travelDate') for p in candidate.get('originalPages',candidate.get('pageSources',[])) if iso(p.get('travelDate'))}
    if slot.get('documentKind')!='voucher' and slot.get('ticketDateBasis','booking')=='booking':
        dates.update((body.get('sanityBooking') or {}).get('journeyDates',[]))
        for other in body.get('sections',[]):
            if other.get('documentKind') not in ('combinedTickets','nsTickets','mavTickets','dbTickets','obbTickets','cdTickets','dfdsTickets','trainlineTickets','raileuropeTickets','sbbTickets','finnlinesTickets','fjordlineTickets','enturTickets','ltgTickets','renfeTickets','snalltagetTickets','sanityTickets'):continue
            source=other.get('selected') or {}
            dates.update(p['travelDate'] for p in source.get('originalPages',source.get('pageSources',[])) if iso(p.get('travelDate')))
    return sorted(d for d in dates if iso(d))

def inspect(s,payload):
    provider=payload.get('provider','ns')
    if provider not in PROVIDERS:raise ValueError('Onbekende vervoerder voor datumcontrole.')
    omit_gate_pass=payload.get('omitGatePass',False)
    if type(omit_gate_pass) is not bool:raise ValueError('Ongeldige keuze voor het weglaten van poortjespagina’s.')
    ident=payload.get('asset');asset=s.asset(ident)
    if not 1<=asset['pages']<=100:raise ValueError('Controleer één tot honderd documentpagina’s.')
    suggested=payload.get('suggestedDates',[]);allowed=payload.get('travelDates',[]);continuations=payload.get('continuationDates',[])
    if not isinstance(suggested,list) or not isinstance(allowed,list) or not isinstance(continuations,list) or len(suggested)>100 or len(allowed)>500 or len(continuations)>100 or any(not isinstance(d,str) or not iso(d) for d in [*suggested,*allowed,*continuations]):raise ValueError('Ongeldige reisdatums.')
    reader=PdfReader(s.DATA/'pdfs'/f'{ident}.pdf');pages=[];deadline=time.monotonic()+20
    for n,page in enumerate(reader.pages):
        if time.monotonic()>deadline:raise ValueError('Datumcontrole duurt te lang. Upload minder pagina’s tegelijk.')
        text=page.extract_text() or ''
        if provider in ('renfe','sanity') and re.search(r'COPIA PARA CLIENTE',text,re.I) and re.search(r'Cargo por ventas con tarjeta',text,re.I):continue
        if provider=='ns' and omit_gate_pass and is_gate_pass(text):continue
        if provider in ('sanity','entur') and re.search(r'not valid as (?:a )?ticket|electronic sales receipt|kvittering.*ikke.*billett',text,re.I):raise ValueError('Dit document is een betalingsbewijs en geen ticket. Kies de echte ticket-PDF.')
        value,source,review=labelled_date(text,provider,allowed)
        if provider not in ('dfds','trainline','raileurope','sbb','sanity','finnlines','fjordline','entur','ltg','renfe','snalltaget','ratehawk') and not value and source!='ambiguous' and len(set(suggested))==1:value=suggested[0];source='sanity-todo';review=False
        if value and suggested and value not in suggested and not (provider=='ns' and source in ('pdf','pdf-timetable','pdf-validity') and value in continuations):review=True;source='pdf-conflict'
        pages.append({'asset':ident,'page':n,'travelDate':value,'dateSource':source,'dateNeedsReview':review,**journey_details(text),**ticket_details(text)})
    # Continuation pages can share a date, but this suggestion still needs checking.
    dates={p['travelDate'] for p in pages if p['travelDate']}
    if len(dates)==1:
        for p in pages:
            if not p['travelDate'] and p['dateSource']=='unknown':p.update(travelDate=next(iter(dates)),dateSource='pdf-continuation',dateNeedsReview=True)
    return {'pages':pages}


def is_gate_pass(text):
    """Require the explicit non-ticket notice and independent gate-pass wording."""
    # Embedded PDF fonts can insert whitespace inside words such as vervoerbew ijs.
    normalized=''.join(text.casefold().split())
    return ('ditisgeenvervoerbewijs' in normalized
            and ('hetstationbetredenofverlaten' in normalized or 'passageticket' in normalized)
            and journey_details(text)['documentRole']=='unknown')

def journey_details(text):
    """Only explicit standalone headings and departure labels are ordering hints."""
    reservation=r'(?:seat reservation|reservation only|reservation ticket|sitzplatzreservierung|reservierung|helyjegy|helybiztos[ií]t[aá]s|m[ií]stenka)'
    ticket=r'(?:e[ -]?ticket|online[ -]?ticket|fahrkarte|vervoerbewijs|j[ií]zdenka|menetjegy|ticket)'
    heading=lambda pattern:bool(re.search(r'^\s*'+pattern+r'\s*[:\-]?\s*$',text,re.I|re.M))
    role='reservation' if heading(reservation) else 'ticket' if heading(ticket) else 'unknown'
    times=set(re.findall(r'(?:departure(?: time)?|abfahrt|vertrektijd|odjezd)\s*[:：]?\s*(?:'+DATE+r'\s+)?([0-2]\d:[0-5]\d)',text,re.I))
    mav=re.search(r'(?:VONAT\s*/\s*TRAIN|TRAIN)\s*:\s*\d+\s*\(\s*'+DATE+r'\s+([0-2]\d:[0-5]\d)',text,re.I)
    if mav:times.add(mav[1])
    times={t for t in times if int(t[:2])<24}
    return {'documentRole':role,'departureTime':next(iter(times)) if len(times)==1 else ''}


def ticket_details(text):
    """Conservative display hints, never a statement of ticket validity or coverage."""
    text=text[:100000];details={}
    def station(value):
        value=' '.join(value.split()).strip(' :')
        return value if 2<=len(value)<=100 and re.search(r'[A-Za-zÀ-ž]',value) and not re.search(r'https?:|€|\d{2}[./]\d{2}|^(?:from|to|van|naar|von|nach|date|datum|departure|arrival)$',value,re.I) else ''
    routes=set()
    arrow_text=text.replace('*',' ')
    for m in re.finditer(r"^\s*([A-Za-zÀ-ž][^>\n]{1,80}?)\s*(?:->|→)\s*([A-Za-zÀ-ž][A-Za-zÀ-ž .()'’/-]*?)(?=\s*(?:\d|$|->|→))",arrow_text,re.M):
        origin,destination=station(m[1]),station(m[2])
        if origin and destination:routes.add((origin,destination))
    def labelled(labels):
        values={station(m[1]) for m in re.finditer(r'^\s*(?:'+labels+r')\s*(?::[ \t]*|\n)([^\n]{2,100})$',text,re.I|re.M)}-{''}
        return next(iter(values)) if len(values)==1 else ''
    origin=labelled(r'from|van|von|departure station|abfahrtsbahnhof')
    destination=labelled(r'to|naar|nach|arrival station|zielbahnhof')
    if origin and destination:routes.add((origin,destination))
    if len(routes)==1:details['originStation'],details['destinationStation']=next(iter(routes))
    counts={int(m[1]) for m in re.finditer(r'(?:aantal reizigers|number of passengers|reisende|personen|passengers)\s*[:：]\s*(\d{1,2})(?!\d)',text,re.I)}
    counts.update(int(m[1]) for m in re.finditer(r'\b(\d{1,2})\s+(?:personen|persons?|passengers|reizigers)\b',text,re.I))
    if not counts:
        adults={int(m[1]) for m in re.finditer(r'\b(\d{1,2})\s+(?:volwassen(?:e|en)|adults?|erwachsene(?:r)?)\b',text,re.I)}
        children={int(m[1]) for m in re.finditer(r'\b(\d{1,2})\s+(?:kinderen|kind|children|child|kinder)\b',text,re.I)}
        if len(adults)==1 and len(children)<=1:counts={next(iter(adults))+next(iter(children),0)}
    if len(counts)==1 and 1<=next(iter(counts))<=99:details['passengerCount']=next(iter(counts))
    numbers={m[1].upper() for m in re.finditer(r'(?:ticketnummer|ticket number|fahrkartennummer|ticket[- ]?nr[.]?)\s*[:：]\s*([A-Z0-9][A-Z0-9/-]{4,29})\b',text,re.I)}
    if len(numbers)==1:details['ticketNumber']=next(iter(numbers))
    return details
