"""Names derived from immutable export snapshots, never current booking state."""
import datetime
import json
import re
import unicodedata
from urllib.parse import quote


def clean(value):
    value = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', ' ', str(value or ''))
    return re.sub(r'\s+', ' ', value).strip(' .')[:160]


def name(snapshot, title='', ident=''):
    body = snapshot.get('body', {})
    booking, values = body.get('sanityBooking', {}), body.get('values', {})
    number = clean(booking.get('number') or values.get('boekingsnummer'))
    customer = clean(booking.get('name') or ' '.join(str(values.get(k) or '') for k in ('klantvoornaam', 'klantachternaam')))
    departure = str(booking.get('departure') or values.get('vertrekdatum') or '')[:10]
    for pattern in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            departure = datetime.datetime.strptime(departure, pattern).strftime('%d-%m-%Y')
            break
        except ValueError:
            pass
    else:
        departure = ''
    parts = [part for part in (number, customer, departure) if part]
    return (' - '.join(parts)[:220] if parts else clean(title) or 'boekje-' + ident[:8]) + '.pdf'


def from_row(row):
    try:
        snapshot = json.loads(row['snapshot'])
    except (ValueError, TypeError):
        snapshot = {}
    return name(snapshot if isinstance(snapshot, dict) else {}, row['title'], row['id'])


def disposition(s, ident, mode):
    with s.db() as c:
        row = c.execute('SELECT id,title,snapshot FROM exports WHERE id=?', (ident,)).fetchone()
    filename = from_row(row) if row else 'boekje-' + ident[:8] + '.pdf'
    fallback = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode() or 'boekje.pdf'
    return f'{mode}; filename="{fallback}"; filename*=UTF-8\'\'{quote(filename, safe="")}'
