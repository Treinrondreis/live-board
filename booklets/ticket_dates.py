"""Read labelled journey/check-in dates; never sort by issue, birth or mail dates."""
import re,time
from datetime import date
from pypdf import PdfReader

PROVIDERS=('ns','mav','db','obb','cd','voucher')
DATE=r'(?:20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2})'
MONTHS={name:n for n,names in enumerate(('januari january','februari february','maart march','april','mei may','juni june','juli july','augustus august','september','oktober october','november','december'),1) for name in names.split()}
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
    if provider=='voucher':labels=r'check[ -]?in|incheck(?:datum|en)?|arrival(?: date)?|aankomst(?:datum)?'
    else:labels=r'vertrek(?:datum)?|departure(?: date)?|abfahrt(?: am)?|d[eé]part(?: le)?|travel date|reisdatum|odjezd'
    printed_date=rf'(?:{DATE}|{WRITTEN_DATE})' if provider=='voucher' else DATE
    patterns=[rf'(?:{labels})\s*[:：]?\s*[^\d\n]{{0,30}}({printed_date})']
    if provider=='mav':patterns.insert(0,rf'(?:VONAT\s*/\s*TRAIN|TRAIN)\s*:\s*\d+\s*\(\s*({DATE})')
    for pattern in patterns:
        values={(voucher_iso(m[1]) if provider=='voucher' else iso(m[1])) for m in re.finditer(pattern,text,re.I)}-{''}
        if values:return (next(iter(values)),'pdf',False) if len(values)==1 else ('','ambiguous',True)
    if provider!='voucher':
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
            if other.get('documentKind') not in ('combinedTickets','nsTickets','mavTickets','dbTickets','obbTickets','cdTickets'):continue
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
        if provider=='ns' and omit_gate_pass and is_gate_pass(text):continue
        value,source,review=labelled_date(text,provider,allowed)
        if not value and source!='ambiguous' and len(set(suggested))==1:value=suggested[0];source='sanity-todo';review=False
        if value and suggested and value not in suggested and not (provider=='ns' and source in ('pdf','pdf-timetable','pdf-validity') and value in continuations):review=True;source='pdf-conflict'
        pages.append({'asset':ident,'page':n,'travelDate':value,'dateSource':source,'dateNeedsReview':review,**journey_details(text)})
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
    ticket=r'(?:e[ -]?ticket|online[ -]?ticket|fahrkarte|j[ií]zdenka|menetjegy|ticket)'
    heading=lambda pattern:bool(re.search(r'^\s*'+pattern+r'\s*[:\-]?\s*$',text,re.I|re.M))
    role='reservation' if heading(reservation) else 'ticket' if heading(ticket) else 'unknown'
    times=set(re.findall(r'(?:departure(?: time)?|abfahrt|vertrektijd|odjezd)\s*[:：]?\s*(?:'+DATE+r'\s+)?([0-2]\d:[0-5]\d)',text,re.I))
    mav=re.search(r'(?:VONAT\s*/\s*TRAIN|TRAIN)\s*:\s*\d+\s*\(\s*'+DATE+r'\s+([0-2]\d:[0-5]\d)',text,re.I)
    if mav:times.add(mav[1])
    times={t for t in times if int(t[:2])<24}
    return {'documentRole':role,'departureTime':next(iter(times)) if len(times)==1 else ''}
