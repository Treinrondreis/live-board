"""Keep optional destination pages in their original position; never change originals."""
from datetime import datetime

KEYS=('tripFiller','fillerRequiredDays','fillerPriority')

def settings(slot):
    if 'tripFiller' in slot and type(slot['tripFiller']) is not bool:raise ValueError('Kies wel of geen vulpagina op deze plek.')
    for key,limit in [('fillerRequiredDays',366),('fillerPriority',99)]:
        if key in slot and (type(slot[key]) is not int or not 0<=slot[key]<=limit):raise ValueError('Ongeldige reisduur of voorkeur voor de vulpagina.')
    if slot.get('tripFiller') and slot.get('choice')=='document':raise ValueError('Tickets en klantdocumenten zijn geen vulpagina’s.')
    if slot.get('tripFiller'):
        options=slot.get('options',[]) if slot.get('choice') else [slot]
        if slot.get('selected'):options=[*options,slot['selected']]
        if any(p.get('pages')!=1 or p.get('googleDoc') or p.get('sanityText') for p in options):raise ValueError('Gebruik één vaste PDF-pagina per vulpagina; variabele tekstbronnen kunnen van lengte veranderen.')

def trip_days(body):
    booking=body.get('sanityBooking') or {};values=body.get('values') or {}
    def parse(value):
        value=str(value or '').strip()
        for fmt in ('%Y-%m-%d','%d-%m-%Y','%d/%m/%Y','%d.%m.%Y'):
            try:return datetime.strptime(value[:10],fmt).date()
            except ValueError:pass
        return None
    start=parse(values.get('vertrekdatum')) or parse(booking.get('departure'))
    end=parse(values.get('terugkomstdatum')) or parse(booking.get('returnDate'))
    return (end-start).days+1 if start and end and end>=start else None

def choose(body,sections,count_pages):
    days=trip_days(body);optional=[];warnings=[]
    for n,sec in enumerate(sections):
        if not sec.get('tripFiller'):continue
        threshold=sec.get('fillerRequiredDays',0)
        if threshold and days is None:
            warnings.append('Reisduur onbekend: vulpagina “'+sec['title']+'” blijft opgenomen. Controleer vertrek- en einddatum.')
        elif not threshold or days<threshold:optional.append(n)
    # Retain several candidates per actual page-count remainder. Recount after each
    # removal to include recto blanks and automatic contents pagination, rather than
    # assuming that removing one source page always removes one export page.
    def score(removed):return (len(removed),sum(100-sections[n].get('fillerPriority',50) for n in removed),tuple(removed))
    candidates=[()]
    for n in optional:
        buckets={}
        for removed in [*candidates,*(tuple([*r,n]) for r in candidates)]:
            selected=[s for i,s in enumerate(sections) if i not in removed]
            if not selected:continue
            key=(count_pages(body,selected)%4,any(f.get('type')=='contents' for s in selected for f in s.get('fields',[])))
            buckets.setdefault(key,[]).append(removed)
        candidates=[r for bucket in buckets.values() for r in sorted(set(bucket),key=score)[:8]]
    matching=[r for r in candidates if count_pages(body,[s for i,s in enumerate(sections) if i not in r])%4==0]
    removed=min(matching,key=score) if matching else ()
    return {'sections':[s for i,s in enumerate(sections) if i not in removed],
            'dropped':[sections[n]['title'] for n in removed],
            'droppedIndices':[sections[n].get('_tripFillerIndex') for n in removed],
            'warnings':warnings,'days':days}
