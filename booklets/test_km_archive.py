"""Fake Drive and synthetic bytes; never source photos or production credentials."""
import hashlib
import io
import json
import unittest
from unittest.mock import patch
import test_cloud
import test_export_storage
import km_archive

s=test_cloud.cloud.server
OWNER='a'*64
PHOTO='11111111-1111-4111-8111-111111111111'
RAW=b'synthetic-photo-bytes'
KEY=km_archive.identity(OWNER,PHOTO)
PATH='/internal/km-archive/photo/'+KEY
REAL_UPLOAD=km_archive.drive.upload


class PhotoArchiveTests(unittest.TestCase):
    def setUp(self):
        test_export_storage.ExportStorageTests.setUp(self)
        km_archive.TOKEN.clear()
        with s.db() as c:km_archive.initialize(c)
        self.stack.enter_context(patch.object(km_archive.drive,'upload',side_effect=self.upload))
        km_archive.setup(s)

    def upload(self,path,row,cfg,title,token,mime=None,properties=None,name=None):
        self.assertEqual(row['folder'],km_archive.config(s)['folder'])
        raw=path.read_bytes();self.fake.uploads+=1
        self.fake.files[row['file_id']]={'id':row['file_id'],'mimeType':mime,'size':str(len(raw)),
            'md5Checksum':hashlib.md5(raw).hexdigest(),'sha256Checksum':hashlib.sha256(raw).hexdigest(),
            'trashed':False,'parents':[row['folder']],'appProperties':properties}
        self.fake.media[row['file_id']]=raw

    def env(self,raw=RAW):
        return {'CONTENT_TYPE':'image/jpeg','CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw),
            'HTTP_X_KM_OWNER':OWNER,'HTTP_X_KM_PHOTO':PHOTO,'HTTP_X_KM_MD5':hashlib.md5(raw).hexdigest(),'HTTP_X_KM_SHA256':hashlib.sha256(raw).hexdigest()}

    def test_photo_upload_retry_download_and_private_sharing(self):
        result=km_archive.save(s,KEY,self.env());self.assertTrue(result['verified'])
        self.assertEqual(km_archive.download(s,KEY),(RAW,'image/jpeg'))
        km_archive.save(s,KEY,self.env());self.assertEqual(self.fake.uploads,1)
        self.assertEqual(list((s.DATA/'km-transfer').iterdir()),[])
        self.assertFalse(any('/permissions' in c[0] for c in self.fake.calls))

    def test_resumable_upload_uses_photo_mime_and_archive_parent(self):
        reserved={}
        def network(url,token,method='GET',body=None,headers=None):
            if method=='POST':
                reserved.update(json.loads(body))
                self.assertEqual(reserved['parents'],[km_archive.config(s)['folder']])
                self.assertEqual(reserved['mimeType'],'image/jpeg')
                self.assertEqual(headers['X-Upload-Content-Type'],'image/jpeg')
                return test_export_storage.Response(headers={'Location':'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'})
            self.assertEqual(method,'PUT');self.assertEqual(body,RAW)
            self.assertEqual(headers['Content-Type'],'image/jpeg')
            self.fake.files[reserved['id']]={**reserved,'trashed':False,'size':str(len(body)),
                'md5Checksum':hashlib.md5(body).hexdigest(),'sha256Checksum':hashlib.sha256(body).hexdigest()}
            return test_export_storage.Response()
        with patch.object(km_archive.drive,'upload',REAL_UPLOAD),patch.object(km_archive.drive,'open_request',side_effect=network):
            self.assertTrue(km_archive.save(s,KEY,self.env())['verified'])
        self.assertEqual(reserved['appProperties']['kmPhoto'],KEY)

    def test_wrong_hash_truncated_upload_video_and_owner_are_rejected(self):
        for key,value in [('HTTP_X_KM_SHA256','b'*64),('CONTENT_TYPE','video/mp4'),('HTTP_X_KM_OWNER','b'*64),('CONTENT_LENGTH',str(len(RAW)+1))]:
            env=self.env();env[key]=value
            self.assertRaises(ValueError,km_archive.save,s,KEY,env)
        self.assertEqual(self.fake.uploads,0)
        self.assertIsNone(km_archive.row(s,KEY))

    def test_corrupt_drive_copy_cannot_be_verified_or_downloaded(self):
        original=self.upload
        def corrupt(*args,**kwargs):
            original(*args,**kwargs)
            self.fake.files[args[1]['file_id']]['md5Checksum']='incorrect'
        with patch.object(km_archive.drive,'upload',side_effect=corrupt):self.assertRaises(ValueError,km_archive.save,s,KEY,self.env())
        self.assertEqual(km_archive.row(s,KEY)['verified'],0)
        self.assertRaises(ValueError,km_archive.download,s,KEY)
        row=km_archive.row(s,KEY);self.fake.files[row['file_id']]['md5Checksum']=hashlib.md5(RAW).hexdigest()
        km_archive.save(s,KEY,self.env());self.fake.media[row['file_id']]=b'changed'
        self.assertRaises(ValueError,km_archive.download,s,KEY)

    def test_trash_is_confirmed_and_stale_upload_cannot_restore_deleted_photo(self):
        km_archive.save(s,KEY,self.env());row=km_archive.row(s,KEY)
        km_archive.trash(s,KEY);self.assertTrue(self.fake.files[row['file_id']]['trashed'])
        self.assertRaises(ValueError,km_archive.save,s,KEY,self.env())
        self.assertRaises(ValueError,km_archive.download,s,KEY)
        self.assertEqual(km_archive.trash(s,KEY),{'ok':True})

    def test_internal_routes_require_gateway_secret_and_have_separate_bounded_slots(self):
        for method in ['GET','POST']:
            self.assertEqual(test_cloud.request(PATH,method,RAW,authorized=False)[0],401)
        km_archive.save(s,KEY,self.env())
        status,headers,raw=test_cloud.request(PATH)
        self.assertEqual(status,200);self.assertEqual(headers['Content-Type'],'image/jpeg');self.assertEqual(raw,RAW)
        km_archive.SLOTS.acquire();km_archive.SLOTS.acquire()
        try:self.assertEqual(test_cloud.request(PATH)[0],429)
        finally:km_archive.SLOTS.release();km_archive.SLOTS.release()


if __name__=='__main__':unittest.main()
