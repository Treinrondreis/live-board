import json
import sqlite3
import unittest
from types import SimpleNamespace
import export_names as names


class ExportNames(unittest.TestCase):
    def test_binding_and_date(self):
        body = {'sanityBooking': {'number': '1234A', 'name': 'Test Reiziger', 'departure': '2027-03-08'}}
        self.assertEqual(names.name({'body': body}), '1234A - Test Reiziger - 08-03-2027.pdf')

    def test_personal_fields_and_incomplete_legacy_snapshot(self):
        body = {'values': {'boekingsnummer': '1234A', 'klantvoornaam': 'Test', 'klantachternaam': 'Reiziger', 'vertrekdatum': '08-03-2027'}}
        self.assertEqual(names.name({'body': body}), '1234A - Test Reiziger - 08-03-2027.pdf')
        self.assertEqual(names.name({}, 'Oud boekje'), 'Oud boekje.pdf')
        self.assertEqual(names.name({'body': {'values': {'vertrekdatum': 'geen datum'}}}, 'Oud'), 'Oud.pdf')

    def test_filename_is_safe_and_unicode_header_is_encoded(self):
        connection = sqlite3.connect(':memory:'); connection.row_factory = sqlite3.Row
        connection.execute('CREATE TABLE exports(id,title,snapshot)')
        connection.execute('INSERT INTO exports VALUES(?,?,?)', ('fixture', 'Oud', json.dumps({'body': {'sanityBooking': {'number': '1234A', 'name': 'Test Één/\\"\r\nReiziger', 'departure': '2027-03-08'}}})))
        header = names.disposition(SimpleNamespace(db=lambda: connection), 'fixture', 'attachment')
        self.assertNotIn('\r', header); self.assertNotIn('\n', header)
        self.assertIn('filename*=UTF-8', header); self.assertIn('%C3%89', header)
        self.assertIn('08-03-2027.pdf', header)


if __name__ == '__main__':
    unittest.main()
