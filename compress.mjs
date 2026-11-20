// Gzip-compressie voor serverantwoorden (JSON, HTML, JS, CSS, SVG, tekst).
//
// Werkt op elk antwoord dat in één keer met res.end(body) wordt verstuurd.
// Antwoorden die in delen worden gestreamd (res.write, bijv. event-streams of
// downloads) blijven ongewijzigd. Uitzetten: Railway-variabele COMPRESSION=off.
import zlib from 'node:zlib';

const COMPRESSIBLE = /^(application\/(json|javascript|xml|manifest\+json)|text\/(html|css|javascript|plain|xml|csv)|image\/svg\+xml)/i;
const MIN_BYTES = 1024;

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === name) return headers[i + 1];
    return undefined;
  }
  for (const k of Object.keys(headers)) if (k.toLowerCase() === name) return headers[k];
  return undefined;
}
function withoutHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return headers;
  if (Array.isArray(headers)) {
    const out = [];
    for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() !== name) out.push(headers[i], headers[i + 1]);
    return out;
  }
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== name));
}

export function enableCompression(req, res, {enabled = process.env.COMPRESSION !== 'off'} = {}) {
  if (!enabled || req.method === 'HEAD' || !/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return;
  const writeHead = res.writeHead, write = res.write, end = res.end;
  let pending = null, streaming = false, ending = false;

  const flush = () => {
    if (res.headersSent) return;
    // end/write normally generate implicit headers through writeHead. Our wrapper
    // defers writeHead, so send those headers explicitly before handing off.
    const args = pending || [res.statusCode];
    pending = null;
    writeHead.apply(res, args);
  };

  res.writeHead = function (status, ...rest) { if (!ending) pending = [status, ...rest]; return res; };
  res.write = function (...args) { streaming = true; flush(); return write.apply(res, args); };
  res.end = function (chunk, encoding, callback) {
    if (ending) return res; // tweede end tijdens comprimeren negeren
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined; encoding = undefined; }
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    const plain = () => { flush(); return end.call(res, chunk, encoding, callback); };
    if (streaming) return plain();
    const status = pending ? pending[0] : res.statusCode;
    const headerArg = pending ? pending.find((v, i) => i > 0 && v && typeof v === 'object') : undefined;
    const type = String(headerValue(headerArg, 'content-type') ?? res.getHeader('content-type') ?? '');
    const encoded = headerValue(headerArg, 'content-encoding') ?? res.getHeader('content-encoding');
    if (chunk == null || encoded || status === 204 || status === 304 || status < 200 || !COMPRESSIBLE.test(type)) return plain();
    const body = Buffer.isBuffer(chunk) ? chunk : ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : Buffer.from(typeof chunk === 'string' ? chunk : String(chunk), encoding || 'utf8');
    if (body.length < MIN_BYTES) return plain();
    ending = true;
    zlib.gzip(body, {level: 4}, (err, gz) => {
      // Dit draait buiten de try/catch van de request-handler: fouten hier mogen de server niet laten crashen.
      try {
        if (err) { ending = false; return plain(); }
      if (pending) pending = pending.map((v, i) => (i > 0 && v && typeof v === 'object') ? withoutHeader(withoutHeader(v, 'content-length'), 'vary') : v);
      res.removeHeader('content-length');
      res.setHeader('Content-Encoding', 'gzip');
      const vary = String(headerValue(headerArg, 'vary') ?? res.getHeader('vary') ?? '');
      if (!/accept-encoding/i.test(vary)) res.setHeader('Vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding');
        flush();
        end.call(res, gz, callback);
      } catch (e) {
        console.error('[compressie] Antwoord kon niet worden verstuurd:', e.message);
        if (!res.headersSent) { pending = null; try { writeHead.call(res, 500, {'Content-Type': 'text/plain; charset=utf-8'}); end.call(res, 'Serverfout'); return; } catch {} }
        res.destroy(e);
      }
    });
    return res;
  };
}

