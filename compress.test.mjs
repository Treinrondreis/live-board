import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import {enableCompression} from './compress.mjs';

async function serve(handler, fn) {
  const server = http.createServer((req, res) => { enableCompression(req, res, {enabled: true}); handler(req, res); });
  await new Promise(r => server.listen(0, r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
async function get(url, gzip = true, method = 'GET') {
  return new Promise((resolve, reject) => {
    http.get(url, {method, headers: gzip ? {'Accept-Encoding': 'gzip, br'} : {}}, res => {
      const parts = []; res.on('data', c => parts.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(parts)}));
    }).on('error', reject);
  });
}
const big = JSON.stringify({trains: Array.from({length: 300}, (_, i) => ({number: i, station: 'Utrecht Centraal', delay: 0}))});

test('grote JSON wordt gecomprimeerd en is correct terug te lezen', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(big), 'Vary': 'Origin'}); res.end(big);
}, async url => {
  const r = await get(url);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.match(r.headers.vary, /Origin/);
  assert.match(r.headers.vary, /Accept-Encoding/);
  assert.equal(zlib.gunzipSync(r.body).toString(), big);
  assert.ok(r.body.length < Buffer.byteLength(big) / 3);
}));

test('zonder gzip-ondersteuning ongewijzigd', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'}); res.end(big);
}, async url => {
  const r = await get(url, false);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.toString(), big);
}));

test('setHeader + statusCode + chaining werken', () => serve((req, res) => {
  res.statusCode = 201; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.writeHead(201).end(big);
}, async url => {
  const r = await get(url);
  assert.equal(r.status, 201);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(r.body).toString(), big);
}));

test('kleine antwoorden, afbeeldingen en streams blijven ongecomprimeerd', async () => {
  await serve((req, res) => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"ok":true}'); }, async url => {
    const r = await get(url); assert.equal(r.headers['content-encoding'], undefined); assert.equal(r.body.toString(), '{"ok":true}');
  });
  await serve((req, res) => { res.writeHead(200, {'Content-Type': 'image/png'}); res.end(Buffer.alloc(5000, 1)); }, async url => {
    const r = await get(url); assert.equal(r.headers['content-encoding'], undefined); assert.equal(r.body.length, 5000);
  });
  await serve((req, res) => { res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.write('data: a\n\n'); res.end(big); }, async url => {
    const r = await get(url); assert.equal(r.headers['content-encoding'], undefined); assert.equal(r.body.toString(), 'data: a\n\n' + big);
  });
});

test('al gecomprimeerd, 304 en HEAD blijven ongemoeid', async () => {
  const pre = zlib.gzipSync(big);
  await serve((req, res) => { res.writeHead(200, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}); res.end(pre); }, async url => {
    const r = await get(url); assert.equal(zlib.gunzipSync(r.body).toString(), big);
  });
  await serve((req, res) => { res.writeHead(304); res.end(); }, async url => {
    const r = await get(url); assert.equal(r.status, 304);
  });
  await serve((req, res) => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(); }, async url => {
    const r = await get(url, true, 'HEAD'); assert.equal(r.headers['content-encoding'], undefined);
  });
});

test('fout na writeHead: tweede writeHead wint', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.writeHead(500, {'Content-Type': 'application/json'}); res.end(big);
}, async url => {
  const r = await get(url);
  assert.equal(r.status, 500);
  assert.equal(zlib.gunzipSync(r.body).toString(), big);
}));

test('fout bij versturen (ongeldige header) laat de server niet crashen', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html', 'X-Name': 'café €'}); res.end(big);
}, async url => {
  const r = await get(url);
  assert.equal(r.status, 500);
}));

test('tweede end tijdens comprimeren wordt genegeerd', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'}); res.end(big);
  res.writeHead(500, {'Content-Type': 'application/json'}); res.end('{"error":true}');
}, async url => {
  const r = await get(url);
  assert.equal(r.status, 200);
  assert.equal(zlib.gunzipSync(r.body).toString(), big);
}));

test('Uint8Array-body blijft correct', () => serve((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'}); res.end(new Uint8Array(Buffer.from(big)));
}, async url => {
  const r = await get(url);
  assert.equal(zlib.gunzipSync(r.body).toString(), big);
}));
