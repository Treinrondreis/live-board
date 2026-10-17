"""Stable creation order and update times for the shared booklet catalogue."""
from datetime import datetime, timezone


def initialize(c):
    c.execute('CREATE TABLE IF NOT EXISTS object_activity(id TEXT PRIMARY KEY,created TEXT NOT NULL,updated TEXT NOT NULL,original_order INTEGER NOT NULL)')
    c.execute("INSERT OR IGNORE INTO object_activity SELECT id,'','',rowid FROM objects")


def touch(c, ident):
    stamp=datetime.now(timezone.utc).isoformat(timespec='microseconds')
    order=c.execute('SELECT rowid FROM objects WHERE id=?',(ident,)).fetchone()[0]
    c.execute('INSERT INTO object_activity VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated',(ident,stamp,stamp,order))


def catalogue(c):
    import json
    return [{**dict(r),'body':json.loads(r['body'])} for r in c.execute('''
        SELECT o.*,COALESCE(t.original_order,o.rowid) AS createdOrder,COALESCE(t.created,'') AS createdAt,COALESCE(t.updated,'') AS updatedAt,
        COALESCE((SELECT rowid FROM assets WHERE assets.id=json_extract(o.body,'$.asset')),0) AS uploadOrder
        FROM objects o LEFT JOIN object_activity t ON t.id=o.id ORDER BY o.title
    ''')]
