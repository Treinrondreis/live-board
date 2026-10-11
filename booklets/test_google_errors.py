import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import google_connection


class GoogleErrorTests(unittest.TestCase):
    def failure(self,url,code,body):
        raw=body if isinstance(body,bytes) else json.dumps(body).encode()
        error=HTTPError(url,code,'Forbidden',{},io.BytesIO(raw))
        with patch.object(google_connection,'urlopen',side_effect=error):
            with self.assertRaises(ValueError) as raised:
                google_connection.request(url,token='secret-token')
        self.assertNotIn('secret-token',str(raised.exception))
        self.assertNotIn('private-provider-message',str(raised.exception))
        return str(raised.exception)

    def test_disabled_api_names_the_actual_service_without_reauthorization(self):
        for url,service in [('https://www.googleapis.com/drive/v3/files','Google Drive'),('https://docs.googleapis.com/v1/documents/test','Google Docs')]:
            for detail in [{'errors':[{'reason':'accessNotConfigured'}]},{'details':[{'reason':'SERVICE_DISABLED'}]}]:
                message=self.failure(url,403,{'error':{'message':'private-provider-message',**detail}})
                self.assertIn(service+' API is niet ingeschakeld',message)
                self.assertIn('niet opnieuw',message)

    def test_file_access_errors_do_not_claim_api_is_disabled(self):
        for code in (403,404):
            message=self.failure('https://www.googleapis.com/drive/v3/files/test',code,{'error':{'errors':[{'reason':'forbidden'}]}})
            self.assertIn('Google Drive',message)
            self.assertNotIn('API',message)
            self.assertNotIn('Google Docs',message)

    def test_disabled_api_identifies_only_the_validated_project_number(self):
        for consumer in ('projects/123456789012','projects/secret-token'):
            message=self.failure('https://www.googleapis.com/drive/v3/files',403,{'error':{'details':[{'reason':'SERVICE_DISABLED','metadata':{'consumer':consumer,'extra':'private-provider-message'}}]}})
            if consumer.endswith('123456789012'):self.assertIn('Google Cloud-project 123456789012',message)
            else:self.assertNotIn('projects/',message)

    def test_malformed_provider_responses_preserve_a_useful_access_message(self):
        for body in (b'not json',b'[]',b'{"error":{"errors":null}}'):
            self.assertIn('Google Drive',self.failure('https://www.googleapis.com/drive/v3/files',403,body))
        self.assertIn('Geen toegang tot dit Google-document',self.failure('https://docs.googleapis.com/v1/documents/test',403,b'{}'))


if __name__=='__main__':unittest.main()
