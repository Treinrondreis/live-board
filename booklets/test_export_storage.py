"""Synthetic PDFs and mocked Drive only; no production credentials or records."""
import hashlib
import io
import json
import uuid
import unittest
from contextlib import ExitStack
from unittest.mock import patch
from urllib.error import HTTPError
from email.message import Message
from types import SimpleNamespace
import test_cloud
import export_storage as storage
from reportlab.pdfgen import canvas

s = test_cloud.cloud.server
context = lambda: SimpleNamespace(**vars(s))


def sample_pdf():
    out = io.BytesIO()
    page = canvas.Canvas(out, pagesize=s.SIZES['A4'])
    page.drawString(70, 700, 'Synthetic travel booklet')
    page.showPage()
    page.save()
    return out.getvalue()


class Response(io.BytesIO):
    def __init__(self, raw=b'', status=200, headers=None):
        super().__init__(raw)
        self.status = status
        self.headers = headers or {}


class FakeDrive:
    def __init__(self):
        self.files = {}
        self.media = {}
        self.calls = []
        self.next_id = 0
        self.account = 'synthetic-account'
        self.uploads = 0
        self.upload_error = None
        self.bad_checksum = False

    def request(self, url, token, method='GET', body=None, missing=False, conflict=False):
        self.calls.append((url, method, body))
        if '/about?' in url:
            return {'user': {'permissionId': self.account}}
        if '/generateIds?' in url:
            self.next_id += 1
            return {'ids': ['synthetic-drive-id-' + str(self.next_id)]}
        if method == 'POST':
            if body['id'] in self.files:
                return None
            self.files[body['id']] = {**body, 'trashed': False}
            return {'id': body['id']}
        ident = url.split('/files/')[-1].split('?')[0]
        item = self.files.get(ident)
        if not item:
            if missing:
                return None
            raise ValueError('Synthetic Drive failure')
        if method == 'PATCH':
            item.update(body)
        return dict(item)

    def upload(self, path, row, cfg, title, token):
        self.uploads += 1
        raw = path.read_bytes()
        self.files[row['file_id']] = {
            'id': row['file_id'], 'mimeType': 'application/pdf', 'trashed': False,
            'size': str(len(raw)), 'md5Checksum': 'bad' if self.bad_checksum else hashlib.md5(raw).hexdigest(),
            'sha256Checksum': hashlib.sha256(raw).hexdigest(), 'parents': [cfg['folder']],
            'appProperties': {'bookletsExport': row['id'], 'bookletsInstance': cfg['instance']}}
        self.media[row['file_id']] = raw
        if self.upload_error:
            raise self.upload_error

    def open(self, url, *args, **kwargs):
        ident = url.split('/files/')[-1].split('?')[0]
        return Response(self.media[ident])


class ExportStorageTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.fake = FakeDrive()
        self.stack.enter_context(patch.object(storage.google, 'status', return_value={'canCreate': True}))
        self.stack.enter_context(patch.object(storage.google, 'token', return_value='synthetic-only'))
        self.stack.enter_context(patch.object(storage, 'request_json', side_effect=self.fake.request))
        self.stack.enter_context(patch.object(storage, 'upload', side_effect=self.fake.upload))
        self.stack.enter_context(patch.object(storage, 'open_request', side_effect=self.fake.open))
        self.original_data = s.DATA
        import tempfile
        from pathlib import Path
        self.data = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.object(s, 'DATA', Path(self.data)))
        for folder in ('exports', 'pdfs', 'previews'):
            (s.DATA / folder).mkdir()
        with s.db() as c:
            c.execute('CREATE TABLE exports(id TEXT PRIMARY KEY, book_id TEXT, title TEXT, created TEXT, snapshot TEXT, report TEXT)')
            c.execute('CREATE TABLE objects(id TEXT PRIMARY KEY,kind TEXT,title TEXT,revision INTEGER,body TEXT)')
            c.execute('CREATE TABLE assets(id TEXT PRIMARY KEY,title TEXT,pages INTEGER,meta TEXT,created TEXT)')
            s.export_history.initialize(c)
            storage.initialize(c)
        storage.configure(context(), True)

    def export(self, book='synthetic-book'):
        ident = uuid.uuid4().hex
        with s.db() as c:
            c.execute('INSERT INTO exports VALUES(?,?,?,?,?,?)', (ident, book, 'Synthetic booklet', s.now(), '{}', '{"pages":1}'))
        storage.local(s, ident).write_bytes(sample_pdf())
        return ident

    def test_verified_transfer_reclaims_only_export_and_is_idempotent(self):
        ident = self.export()
        source = s.DATA / 'pdfs' / (uuid.uuid4().hex + '.pdf')
        source.write_bytes(b'synthetic source stays')
        expected = storage.local(s, ident).read_bytes()
        storage.archive(s, ident)
        row = storage.remote(s, ident)
        self.assertEqual(row['verified'], 1)
        self.assertFalse(storage.local(s, ident).exists())
        self.assertEqual(source.read_bytes(), b'synthetic source stays')
        storage.archive(s, ident)
        self.assertEqual(self.fake.uploads, 1)
        with storage.pdf(s, ident) as path:
            temporary = path
            self.assertEqual(path.read_bytes(), expected)
        self.assertFalse(temporary.exists())
        self.assertFalse(any('/permissions' in call[0] for call in self.fake.calls))

    def test_timeout_after_completed_upload_retries_exact_id_without_duplicate(self):
        ident = self.export()
        self.fake.upload_error = ValueError('Synthetic timeout')
        result = storage.finish(s, ident)
        row = storage.remote(s, ident)
        self.assertEqual(result['storage'], 'local')
        self.assertIn('storageWarning', result)
        self.assertTrue(storage.local(s, ident).exists())
        storage.archive(s, ident)
        self.assertEqual(storage.remote(s, ident)['file_id'], row['file_id'])
        self.assertEqual(self.fake.uploads, 1)
        self.assertFalse(storage.local(s, ident).exists())

    def test_mismatch_or_changed_local_copy_is_never_evicted(self):
        ident = self.export()
        self.fake.bad_checksum = True
        self.assertRaisesRegex(ValueError, 'niet overeen', storage.archive, s, ident)
        self.assertTrue(storage.local(s, ident).exists())
        self.assertEqual(storage.remote(s, ident)['verified'], 0)
        self.fake.bad_checksum = False
        row = storage.remote(s, ident)
        self.fake.files[row['file_id']]['md5Checksum'] = row['md5']
        storage.local(s, ident).write_bytes(b'changed synthetic PDF')
        self.assertRaisesRegex(ValueError, 'blijft daarom', storage.archive, s, ident)
        self.assertTrue(storage.local(s, ident).exists())

    def test_same_account_required_and_no_arbitrary_pdf_source_can_be_archived(self):
        ident = self.export()
        self.fake.account = 'another-synthetic-account'
        self.assertRaisesRegex(ValueError, 'oorspronkelijke', storage.archive, s, ident)
        self.assertTrue(storage.local(s, ident).exists())
        self.assertRaises(ValueError, storage.archive, s, '../../pdfs/source')
        missing = uuid.uuid4().hex
        storage.local(s, missing).write_bytes(b'orphan')
        self.assertRaisesRegex(ValueError, 'niet gevonden', storage.archive, s, missing)

    def test_corrupt_download_is_rejected_and_temporary_file_is_removed(self):
        ident = self.export()
        storage.archive(s, ident)
        row = storage.remote(s, ident)
        for raw in (b'wrong', b'x' * (row['size'] + 1)):
            self.fake.media[row['file_id']] = raw
            with self.assertRaises(ValueError):
                with storage.pdf(s, ident):
                    self.fail('Unverified bytes must never be served')
            self.assertEqual(list((s.DATA / 'export-cache').iterdir()), [])

    def test_private_stream_head_digital_preview_and_disconnect_failure(self):
        ident = self.export()
        original = storage.local(s, ident).read_bytes()
        storage.archive(s, ident)
        url = '/files/export/' + ident
        with patch.object(storage, 'connection', side_effect=AssertionError('unauthenticated network')):
            self.assertEqual(test_cloud.request(url, authorized=False)[0], 401)
            self.assertEqual(test_cloud.request('/api/export-archive', 'POST', json.dumps({'id':ident}).encode(), authorized=False)[0], 401)
        status, headers, body = test_cloud.request(url + '?download=1')
        self.assertEqual(status, 200, body)
        self.assertEqual(body, original)
        self.assertIn('attachment', headers['Content-Disposition'])
        self.assertEqual(list((s.DATA / 'export-cache').iterdir()), [])
        self.assertEqual(test_cloud.request(url, 'HEAD')[0], 200)
        self.assertEqual(test_cloud.request('/api/digital/' + ident)[0], 200)
        status, _, body = test_cloud.request('/files/export-preview/' + ident + '/0')
        self.assertEqual(status, 200, body[:100])
        self.assertTrue(body.startswith(b'\x89PNG'))
        with patch.object(storage.google, 'status', return_value={'canCreate': False}):
            self.assertEqual(test_cloud.request(url)[0], 400)
        self.assertEqual(storage.remote(s, ident)['verified'], 1)

    def test_archiving_works_at_full_quota_and_counts_existing_exports(self):
        import os
        ident = self.export()
        with patch.dict(os.environ, {'BOOKLETS_STORAGE_LIMIT': '1'}):
            status, _, raw = test_cloud.request('/api/export-archive', 'POST', json.dumps({'id': ident}).encode())
        self.assertEqual(status, 200, raw)
        result = storage.status(s)
        self.assertEqual(result['stored'], 1)
        self.assertEqual(result['remaining'], [])
        self.assertEqual(result['localBytes'], 0)
        storage.configure(s, False)
        new = self.export()
        self.assertEqual(storage.finish(s, new), {'storage': 'local'})
        self.assertTrue(storage.local(s, new).is_file())

    def test_new_export_is_registered_before_transfer_and_keeps_snapshot_and_link(self):
        status, _, raw = test_cloud.request('/api/upload', 'POST', sample_pdf())
        self.assertEqual(status, 200, raw)
        asset = json.loads(raw)
        body = {'format':'A4','sections':[{'asset':asset['id'],'pages':1,'fields':[],'title':'Synthetic page'}]}
        result = s.make_export({'id':uuid.uuid4().hex,'title':'Synthetic booklet','body':body}, {'allowUneven':True})
        self.assertEqual(result['storage'], 'drive')
        self.assertFalse(storage.local(s, result['id']).exists())
        with s.db() as c:
            row = c.execute('SELECT * FROM exports WHERE id=?', (result['id'],)).fetchone()
        self.assertEqual(json.loads(row['snapshot'])['body']['format'], 'A4')
        self.assertEqual(test_cloud.request(result['url'])[0], 200)
        state = json.loads(test_cloud.request('/api/state')[2])
        self.assertEqual(state['exports'][0]['driveStored'], 1)
        self.assertNotIn('file_id', state['exports'][0])
        self.assertTrue((s.DATA/'pdfs'/(asset['id']+'.pdf')).exists())

    def test_trash_restore_and_purge_preserve_history_until_drive_confirms(self):
        old, new = self.export(), self.export()
        storage.archive(s, old)
        row = storage.remote(s, old)
        action = lambda ident, name: test_cloud.request('/api/export-status', 'POST', json.dumps({'bookId':'synthetic-book','id':ident,'action':name}).encode())
        self.assertEqual(action(new, 'trash')[0], 400)
        self.assertEqual(action(old, 'trash')[0], 200)
        self.assertFalse(self.fake.files[row['file_id']]['trashed'])
        self.assertEqual(test_cloud.request('/files/export/' + old)[0], 404)
        self.assertEqual(action(old, 'restore')[0], 200)
        self.assertEqual(test_cloud.request('/files/export/' + old)[0], 200)
        self.assertEqual(action(old, 'trash')[0], 200)
        with patch.object(storage, 'trash', side_effect=ValueError('Synthetic permission failure')):
            self.assertEqual(action(old, 'purge')[0], 400)
        self.assertIsNotNone(storage.remote(s, old))
        self.assertEqual(action(old, 'purge')[0], 200)
        self.assertIsNone(storage.remote(s, old))
        self.assertTrue(self.fake.files[row['file_id']]['trashed'])
        self.assertTrue(storage.local(s, new).exists())


class UploadProtocolTests(unittest.TestCase):
    def test_chunk_upload_uses_range_acknowledgement_and_rejects_redirect_hosts(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as data:
            path = Path(data) / 'synthetic.pdf'
            path.write_bytes(b'synthetic-pdf')
            row = {'id':'a'*32, 'file_id':'synthetic-drive-id', 'folder':'synthetic-folder', 'size':len(path.read_bytes())}
            headers = Message()
            headers['Range'] = 'bytes=0-3'
            incomplete = HTTPError(storage.UPLOAD, 308, 'Incomplete', headers, io.BytesIO())
            responses = [Response(headers={'Location':storage.UPLOAD+'?upload_id=synthetic'}), incomplete, Response()]
            calls = []
            def opened(url, token, method='GET', data=None, headers=None):
                calls.append((url,method,data,headers))
                result = responses.pop(0)
                if isinstance(result, Exception):raise result
                return result
            with patch.object(storage, 'open_request', side_effect=opened):
                storage.upload(path, row, {'instance':'synthetic-instance'}, 'Synthetic', 'synthetic-token')
            self.assertEqual(calls[2][2], b'hetic-pdf')
            self.assertEqual(calls[2][3]['Content-Range'], 'bytes 4-12/13')
            with patch.object(storage, 'OPENER') as opener:
                self.assertRaises(ValueError, storage.open_request, 'https://example.invalid/private', 'synthetic')
                opener.open.assert_not_called()
            with patch.object(storage, 'open_request', return_value=Response(headers={'Location':'https://example.invalid/upload'})):
                self.assertRaisesRegex(ValueError, 'uploadsessie', storage.upload, path, row, {'instance':'synthetic'}, 'Synthetic', 'synthetic')


if __name__ == '__main__':
    unittest.main()
