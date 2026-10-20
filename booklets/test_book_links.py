import unittest,sqlite3,json
from book_links import linked
class BookLinks(unittest.TestCase):
 def test_only_exact_booking_without_deleted_books_or_contents(self):
  c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row;c.execute('CREATE TABLE objects(id TEXT,kind TEXT,title TEXT,body TEXT)')
  for i,booking,removed in [('a','fixture-booking',False),('b','other-booking',False),('c','fixture-booking',True)]:c.execute('INSERT INTO objects VALUES(?,?,?,?)',(i,'book','Fictief boekje',json.dumps({'sanityBooking':{'id':booking},'deletedAt':'deleted' if removed else '', 'private':'never return'})))
  self.assertEqual(linked(c,'fixture-booking'),{'books':[{'id':'a','title':'Fictief boekje'}],'more':False})
  with self.assertRaises(ValueError):linked(c,'__proto__')
if __name__=='__main__':unittest.main()
