"""Private Drive storage for finished exports only; sources and snapshots stay local."""
import hashlib
import json
import re
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
import google_connection as google

API = 'https://www.googleapis.com/drive/v3/'
UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
FOLDER_NAME = 'Treinrondreis - Reisboekjes'
FOLDER_MIME = 'application/vnd.google-apps.folder'
FIELDS = 'id,mimeType,size,md5Checksum,sha256Checksum,trashed,appProperties,parents,webViewLink'
MAX_PDF = 512 * 1024 * 1024
CHUNK = 8 * 1024 * 1024
LOCK = threading.RLock()
DOWNLOAD = threading.BoundedSemaphore(1)
NETWORK = threading.local()


@contextmanager
def time_budget(seconds):
    previous = getattr(NETWORK, 'deadline', None)
    NETWORK.deadline = time.monotonic() + seconds
    try:
        yield
    finally:
        NETWORK.deadline = previous


def network_timeout():
    deadline = getattr(NETWORK, 'deadline', None)
    remaining = deadline - time.monotonic() if deadline else 35
    if remaining <= 0:
        raise ValueError('De Drive-overdracht duurt te lang. De lokale PDF blijft bewaard; probeer opnieuw.')
    return min(35, remaining)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = build_opener(NoRedirect())


def initialize(c):
    c.executescript('''
        CREATE TABLE IF NOT EXISTS export_storage_config (
            id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
            instance TEXT NOT NULL, account TEXT, folder TEXT);
        CREATE TABLE IF NOT EXISTS export_drive (
            id TEXT PRIMARY KEY, file_id TEXT NOT NULL, account TEXT NOT NULL,
            folder TEXT NOT NULL, size INTEGER NOT NULL, md5 TEXT NOT NULL,
            sha256 TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
    ''')
    c.execute('INSERT OR IGNORE INTO export_storage_config(id,instance) VALUES(1,?)', (uuid.uuid4().hex,))


def config(s):
    with s.db() as c:
        return dict(c.execute('SELECT * FROM export_storage_config WHERE id=1').fetchone())


def remote(s, ident):
    with s.db() as c:
        row = c.execute('SELECT * FROM export_drive WHERE id=?', (ident,)).fetchone()
        return dict(row) if row else None


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{32}', value):
        raise ValueError('Ongeldige drukversie.')
    return value


def local(s, ident):
    return s.DATA / 'exports' / (identifier(ident) + '.pdf')


def open_request(url, token, method='GET', data=None, headers=None):
    # No bearer credentials on redirects, caller-supplied hosts or URLs from documents.
    p = urlsplit(url)
    if p.scheme != 'https' or p.netloc != 'www.googleapis.com' or not p.path.startswith(('/drive/v3/', '/upload/drive/v3/')):
        raise ValueError('Ongeldig Google Drive-adres.')
    request = Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'User-Agent': 'Treinrondreis-Boekjesmaker/1', **(headers or {})})
    try:
        return OPENER.open(request, timeout=network_timeout())
    except HTTPError:
        raise
    except (URLError, TimeoutError, OSError):
        raise ValueError('Google Drive reageert niet. Probeer de overdracht opnieuw; de lokale PDF blijft bewaard.') from None


def request_json(url, token, method='GET', body=None, missing=False, conflict=False):
    try:
        with open_request(url, token, method, json.dumps(body).encode() if body is not None else None,
                          {'Content-Type': 'application/json'} if body is not None else {}) as response:
            raw = response.read(100001)
            if len(raw) > 100000:
                raise ValueError('Onverwacht antwoord van Google Drive.')
            return json.loads(raw)
    except HTTPError as error:
        if missing and error.code == 404:
            return None
        if conflict and error.code == 409:
            return None
        raise ValueError('Google Drive weigert deze actie. Controleer de Google-koppeling, toegang en beschikbare Drive-opslag.') from None
    except (json.JSONDecodeError, KeyError, TypeError):
        raise ValueError('De overdracht is niet bevestigd door Google Drive. De lokale PDF blijft bewaard.') from None


def connection(s, expected=None):
    if not google.status(s.DATA)['canCreate']:
        raise ValueError('Geef via Google koppelen toestemming om boekjes en routes op te slaan.')
    token = google.token(s.DATA)
    account = request_json(API + 'about?fields=user(permissionId)', token).get('user', {}).get('permissionId')
    if not isinstance(account, str) or not account:
        raise ValueError('Het gekoppelde Drive-account kon niet worden gecontroleerd.')
    if expected and account != expected:
        raise ValueError('Koppel het oorspronkelijke Google-account opnieuw om deze boekjes-PDF te gebruiken.')
    return token, account


def generated_id(token):
    value = request_json(API + 'files/generateIds?count=1&space=drive&type=files', token).get('ids', [None])[0]
    if not isinstance(value, str) or not re.fullmatch('[A-Za-z0-9_-]{10,200}', value):
        raise ValueError('Google Drive gaf geen geldig bestandsnummer.')
    return value


def metadata(token, file_id, missing=False):
    return request_json(API + 'files/' + file_id + '?' + urlencode({'fields': FIELDS}), token, missing=missing)


def ensure_folder(s, token, account):
    cfg = config(s)
    if cfg['account'] and cfg['account'] != account:
        raise ValueError('Gebruik het Google-account waarmee de reisboekjesmap is gemaakt.')
    if not cfg['folder']:
        cfg.update(account=account, folder=generated_id(token))
        # Reserve the ID before any external write, also for a timeout/restart.
        with s.db() as c:
            c.execute('UPDATE export_storage_config SET account=?,folder=? WHERE id=1', (account, cfg['folder']))
    item = metadata(token, cfg['folder'], missing=True)
    if item is None:
        request_json(API + 'files?fields=id', token, 'POST', {
            'id': cfg['folder'], 'name': FOLDER_NAME, 'mimeType': FOLDER_MIME,
            'appProperties': {'bookletsFolder': cfg['instance']}}, conflict=True)
        item = metadata(token, cfg['folder'])
    if item.get('trashed') or item.get('mimeType') != FOLDER_MIME or item.get('appProperties', {}).get('bookletsFolder') != cfg['instance']:
        raise ValueError('De reisboekjesmap is gewijzigd of staat in de Drive-prullenbak. Herstel de oorspronkelijke map.')
    return cfg


def fingerprints(path):
    md5 = hashlib.md5(usedforsecurity=False)
    sha = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b''):
            size += len(chunk)
            md5.update(chunk)
            sha.update(chunk)
    return size, md5.hexdigest(), sha.hexdigest()


def verify(item, row, instance, allow_trashed=False):
    if (not item or (item.get('trashed') and not allow_trashed) or item.get('id') != row['file_id']
            or item.get('mimeType') != 'application/pdf' or str(item.get('size')) != str(row['size'])
            or item.get('md5Checksum') != row['md5']
            or (item.get('sha256Checksum') and item['sha256Checksum'] != row['sha256'])
            or item.get('appProperties', {}).get('bookletsExport') != row['id']
            or item.get('appProperties', {}).get('bookletsInstance') != instance):
        raise ValueError('De PDF in Drive komt niet overeen met de opgeslagen drukversie. De lokale PDF blijft bewaard; controleer het Drive-bestand.')


def upload(path, row, cfg, title, token):
    # Bounded chunks; a retry always uses the reserved file ID, never overwrites.
    url = UPLOAD + '?' + urlencode({'uploadType': 'resumable', 'fields': 'id'})
    body = {'id': row['file_id'], 'name': title[:160] + ' - ' + row['id'][:8] + '.pdf',
            'mimeType': 'application/pdf', 'parents': [row['folder']],
            'appProperties': {'bookletsExport': row['id'], 'bookletsInstance': cfg['instance']}}
    try:
        with open_request(url, token, 'POST', json.dumps(body).encode(), {
                'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf',
                'X-Upload-Content-Length': str(row['size'])}) as response:
            session = response.headers.get('Location', '')
        p = urlsplit(session)
        if p.scheme != 'https' or p.netloc != 'www.googleapis.com' or p.path != '/upload/drive/v3/files' or not p.query:
            raise ValueError('Google Drive gaf geen geldige uploadsessie.')
        deadline = time.monotonic() + 100
        offset = 0
        with path.open('rb') as stream:
            while offset < row['size']:
                if time.monotonic() > deadline:
                    raise ValueError('De overdracht duurt te lang. De lokale PDF blijft bewaard; probeer opnieuw.')
                stream.seek(offset)
                chunk = stream.read(min(CHUNK, row['size'] - offset))
                if not chunk:
                    raise ValueError('De lokale PDF is tijdens de overdracht gewijzigd.')
                try:
                    with open_request(session, token, 'PUT', chunk, {
                            'Content-Type': 'application/pdf', 'Content-Length': str(len(chunk)),
                            'Content-Range': f'bytes {offset}-{offset+len(chunk)-1}/{row["size"]}'}) as response:
                        if response.status not in (200, 201):
                            raise ValueError('De overdracht is niet bevestigd door Google Drive.')
                        return
                except HTTPError as error:
                    if error.code != 308:
                        raise
                    received = re.fullmatch(r'bytes=0-(\d+)', error.headers.get('Range', ''))
                    next_offset = int(received[1]) + 1 if received else 0
                    if not offset < next_offset <= offset + len(chunk):
                        raise ValueError('De overdracht is niet bevestigd door Google Drive.')
                    offset = next_offset
    except HTTPError:
        # A complete timed-out upload or a 409 is reconciled using its exact ID.
        return


def archive(s, ident, seconds=110):
    ident = identifier(ident)
    with LOCK, s.LOCK, google.LOCK, time_budget(seconds):
        with s.db() as c:
            export = c.execute('SELECT * FROM exports WHERE id=?', (ident,)).fetchone()
        if not export:
            raise ValueError('Drukversie niet gevonden.')
        cfg = config(s)
        if not cfg['enabled']:
            raise ValueError('Schakel eerst Drive-opslag voor gemaakte PDF’s in.')
        row = remote(s, ident)
        token, account = connection(s, row['account'] if row else cfg['account'])
        cfg = ensure_folder(s, token, account)
        path = local(s, ident)
        if row is None:
            if not path.is_file():
                raise ValueError('De oorspronkelijke export-PDF ontbreekt.')
            size, md5, sha = fingerprints(path)
            if not 0 < size <= MAX_PDF:
                raise ValueError('Drive-overdracht ondersteunt PDF’s tot 512 MB. De lokale PDF blijft bewaard.')
            row = dict(id=ident, file_id=generated_id(token), account=account, folder=cfg['folder'],
                       size=size, md5=md5, sha256=sha, verified=0)
            with s.db() as c:
                c.execute('INSERT INTO export_drive VALUES(:id,:file_id,:account,:folder,:size,:md5,:sha256,:verified)', row)
        item = metadata(token, row['file_id'], missing=True)
        if item is None:
            if row['verified']:
                raise ValueError('De eerder opgeslagen PDF is niet meer bereikbaar in Drive. Herstel het Drive-bestand.')
            if not path.is_file() or fingerprints(path) != (row['size'], row['md5'], row['sha256']):
                raise ValueError('De lokale PDF ontbreekt of is gewijzigd. Er is niets verwijderd.')
            upload(path, row, cfg, export['title'], token)
            item = metadata(token, row['file_id'])
        verify(item, row, cfg['instance'])
        with s.db() as c:
            c.execute('UPDATE export_drive SET verified=1 WHERE id=?', (ident,))
        # Commit the verified mapping before reclaiming disk space. A crash can
        # leave two copies, never a missing mapping for the only remaining PDF.
        if path.is_file():
            if fingerprints(path) != (row['size'], row['md5'], row['sha256']):
                raise ValueError('De lokale PDF is gewijzigd en blijft daarom bewaard.')
            path.unlink()
        return {'ok': True, 'storage': 'drive'}


def finish(s, ident, seconds=110):
    if not config(s)['enabled']:
        return {'storage': 'local'}
    try:
        if seconds < 10:
            raise ValueError('Retry the transfer separately after a slow PDF generation.')
        return archive(s, ident, seconds)
    except Exception:
        # Generation succeeded independently of the external service. Never ask
        # the user to regenerate a PDF whose export ID has already been saved.
        return {'storage': 'local', 'storageWarning': 'De PDF is gemaakt en veilig op de server bewaard. Opslaan in Drive lukte nog niet. Probeer bij deze drukversie opnieuw.'}


def status(s):
    cfg = config(s)
    with s.db() as c:
        rows = [dict(r) for r in c.execute('SELECT e.id,COALESCE(d.verified,0) AS verified FROM exports e LEFT JOIN export_drive d ON d.id=e.id')]
    sizes = {}
    for row in rows:
        try:sizes[row['id']] = local(s, row['id']).stat().st_size
        except FileNotFoundError:pass
    return {'enabled': bool(cfg['enabled']), 'folderName': FOLDER_NAME, 'canCreate': google.status(s.DATA)['canCreate'],
            'remaining': list(sizes), 'localBytes': sum(sizes.values()),
            'stored': sum(bool(r['verified']) for r in rows)}


def configure(s, enabled):
    if not isinstance(enabled, bool):
        raise ValueError('Kies of gemaakte PDF’s in Drive moeten worden opgeslagen.')
    with LOCK, s.LOCK, google.LOCK, time_budget(100):
        if enabled:
            token, account = connection(s, config(s)['account'])
            ensure_folder(s, token, account)
        with s.db() as c:
            c.execute('UPDATE export_storage_config SET enabled=? WHERE id=1', (int(enabled),))
    return status(s)


@contextmanager
def pdf(s, ident):
    """A verified temporary PDF for authenticated downloads and Poppler previews."""
    path = local(s, ident)
    if path.is_file():
        yield path
        return
    row = remote(s, ident)
    if not row or not row['verified']:
        raise ValueError('De druk-PDF ontbreekt.')
    if not DOWNLOAD.acquire(blocking=False):
        raise ValueError('Er wordt al een PDF uit Drive opgehaald. Probeer het zo nog eens.')
    temp = None
    try:
        s.ensure_capacity(row['size'])
        with google.LOCK, time_budget(85):
            token, _ = connection(s, row['account'])
            verify(metadata(token, row['file_id']), row, config(s)['instance'])
            cache = s.DATA / 'export-cache'
            cache.mkdir(exist_ok=True)
            with tempfile.NamedTemporaryFile(prefix='export-', suffix='.tmp', dir=cache, delete=False) as stream:
                from pathlib import Path
                temp = Path(stream.name)
                sha = hashlib.sha256()
                count = 0
                try:
                    with open_request(API + 'files/' + row['file_id'] + '?alt=media', token) as response:
                        while True:
                            network_timeout()
                            chunk = response.read(min(CHUNK, row['size'] - count + 1))
                            if not chunk:
                                break
                            count += len(chunk)
                            if count > row['size']:
                                raise ValueError('De Drive-PDF heeft een onverwachte grootte.')
                            sha.update(chunk)
                            stream.write(chunk)
                except HTTPError:
                    raise ValueError('De druk-PDF kon niet uit Drive worden opgehaald. Controleer de Google-koppeling.') from None
            if count != row['size'] or sha.hexdigest() != row['sha256']:
                raise ValueError('De opgehaalde Drive-PDF wijkt af van de opgeslagen drukversie.')
        yield temp
    finally:
        if temp:
            temp.unlink(missing_ok=True)
        DOWNLOAD.release()


def trash(s, ident):
    """Only on explicit purge of an older, already-soft-deleted export."""
    row = remote(s, ident)
    if not row:
        return
    with google.LOCK:
        token, _ = connection(s, row['account'])
        item = metadata(token, row['file_id'], missing=True)
        if item is None:
            raise ValueError('De Drive-PDF is niet bereikbaar. Herstel de toegang voordat u de drukversie verwijdert.')
        verify(item, row, config(s)['instance'], allow_trashed=True)
        if not item.get('trashed'):
            request_json(API + 'files/' + row['file_id'] + '?fields=id,trashed', token, 'PATCH', {'trashed': True})
        if not metadata(token, row['file_id']).get('trashed'):
            raise ValueError('Verwijderen in Drive is niet bevestigd. De drukversie blijft in Boekjesmaker bewaard.')
