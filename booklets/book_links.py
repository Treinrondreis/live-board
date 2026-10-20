"""Read-only minimal links for one exact Sanity booking; no book contents."""
import re

def linked(c, booking_id):
    if not isinstance(booking_id,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',booking_id) or booking_id in ('__proto__','constructor','prototype'):
        raise ValueError('Ongeldige boeking.')
    rows=c.execute("SELECT id,title FROM objects WHERE kind='book' AND json_extract(body,'$.sanityBooking.id')=? AND COALESCE(json_extract(body,'$.deletedAt'),'')='' ORDER BY rowid DESC LIMIT 51",(booking_id,)).fetchall()
    return {'books':[{'id':r['id'],'title':r['title']} for r in rows[:50]],'more':len(rows)>50}
