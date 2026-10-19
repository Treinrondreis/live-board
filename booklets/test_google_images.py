import io
import unittest
from unittest.mock import patch
from urllib.request import Request
from PIL import Image
from pypdf import PdfReader
import google_connection as google
import google_layout


class GoogleImageTests(unittest.TestCase):
    def test_docs_image_endpoint_and_existing_google_images_are_supported(self):
        for url in ('https://docs.google.com/docs-images-rt/fixture-image=s2048?key=fixture-key',
                    'https://lh3.googleusercontent.com/fixture-image',
                    'https://docs.google.com:443/docs-images-rt/fixture-image'):
            with self.subTest(url=url),patch.object(google,'build_opener') as build:
                build.return_value.open.return_value=io.BytesIO(b'fixture-image')
                self.assertEqual(google.fetch_image(url),b'fixture-image')
                req=build.return_value.open.call_args.args[0]
                self.assertEqual(req.full_url,url)
                self.assertNotIn('Authorization',req.headers)

    def test_unsupported_hosts_paths_and_credentials_fail_before_network_access(self):
        urls=('http://docs.google.com/docs-images-rt/fixture',
              'https://docs.google.com.evil.example/docs-images-rt/fixture',
              'https://docs.google.com/document/d/fixture/edit',
              'https://docs.google.com/redirect?url=https://example.invalid',
              'https://docs.google.com/docs-images-rt/',
              'https://docs.google.com/docs-images-rt/../redirect',
              'https://docs.google.com:444/docs-images-rt/fixture',
              'https://docs.google.com:invalid/docs-images-rt/fixture',
              'https://user:fixture-secret@docs.google.com/docs-images-rt/fixture',
              'https://lh3.googleusercontent.com.evil.example/fixture',
              'https://127.0.0.1/fixture',
              'https://docs.google.com/docs-images-rt/fixture#fragment')
        with patch.object(google,'build_opener') as build:
            for url in urls:
                with self.subTest(url=url),self.assertRaises(ValueError) as error:google.fetch_image(url)
                self.assertNotIn('fixture-secret',str(error.exception))
            build.assert_not_called()

    def test_redirect_targets_are_validated_before_following(self):
        handler=google.GoogleImageRedirect()
        request=Request('https://docs.google.com/docs-images-rt/fixture')
        allowed=handler.redirect_request(request,None,302,'Found',{},'https://lh3.googleusercontent.com/fixture')
        self.assertEqual(allowed.full_url,'https://lh3.googleusercontent.com/fixture')
        for target in ('https://example.invalid/image','http://127.0.0.1/image','https://docs.google.com/redirect'):
            with self.subTest(target=target),self.assertRaises(ValueError):handler.redirect_request(request,None,302,'Found',{},target)

    def test_image_size_limit_is_retained(self):
        class TooLarge:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,limit):return b'x'*limit
        with patch.object(google,'build_opener') as build:
            build.return_value.open.return_value=TooLarge()
            with self.assertRaisesRegex(ValueError,'te groot'):google.fetch_image('https://docs.google.com/docs-images-rt/fixture')

    def test_positioned_docs_images_normalize_and_render_as_a4_route(self):
        picture=io.BytesIO();Image.new('RGB',(120,80),'#228899').save(picture,'PNG')
        obj={'embeddedObject':{'imageProperties':{'contentUri':'https://docs.google.com/docs-images-rt/fixture-map=s2048?key=fixture-key'}}}
        doc={'title':'Fictieve route','tabs':[{'tabProperties':{'title':'Route'},'documentTab':{
            'body':{'content':[{'paragraph':{'elements':[{'textRun':{'content':'Een fictieve routebeschrijving.\n'}}],'positionedObjectIds':['map']}}]},
            'positionedObjects':{'map':{'positionedObjectProperties':obj}}}}]}
        with patch.object(google,'build_opener') as build:
            build.return_value.open.return_value=io.BytesIO(picture.getvalue())
            model,images=google_layout.normalize(doc,google.fetch_image)
        self.assertEqual(len(images),1)
        self.assertEqual([b['type'] for b in model['blocks']],['text','image'])
        raw=google_layout.render(model,images,'A4','route');pdf=PdfReader(io.BytesIO(raw))
        self.assertIn('Een fictieve routebeschrijving.',pdf.pages[0].extract_text())
        self.assertAlmostEqual(float(pdf.pages[0].mediabox.width),595.276,places=2)
        self.assertTrue(pdf.pages[0].images)


if __name__=='__main__':unittest.main()
