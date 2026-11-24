#!/usr/bin/env node
/*
 * Kleiner Server für die Live-Freigabe der Lagekarte (keine Abhängigkeiten, nur Node.js).
 *
 *   node lage-server.js                             sucht kritis-lage-offline.html neben dem Skript, Port 8080, zufällige PIN
 *   node tools/lage-server.js --port 9000 --pin 4711
 *   node tools/lage-server.js --file src/public/kritis-lage.html
 *   node tools/lage-server.js --no-pin              ohne PIN (nur in einem abgeschotteten Netz)
 *
 * Ablauf: Auf diesem Rechner http://localhost:PORT öffnen. Dort wird die Karte bearbeitet und jeder
 * Stand an den Server übergeben. Andere Geräte im selben Netz öffnen den Link aus dem QR-Code
 * (Schaltfläche "Teilen") und sehen den Stand live, nur lesend. Es geht nichts ins Internet.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = parseInt(arg('port', '8080'), 10);
// Datei der Karte suchen: --file, dann neben dem Skript, dann im aktuellen Ordner, dann im Repository (src/public)
const NAMES = ['kritis-lage-offline.html', 'kritis-lage.html'];
const FILE = (() => {
  const given = arg('file', null);
  if (given) { const f = path.resolve(given); if (fs.existsSync(f)) return f; console.error('Datei nicht gefunden: ' + f); process.exit(1); }
  const dirs = [__dirname, process.cwd(), path.join(__dirname, '..', 'src', 'public'), path.join(process.cwd(), 'src', 'public')];
  for (const d of dirs) for (const n of NAMES) { const f = path.join(d, n); if (fs.existsSync(f)) return f; }
  console.error('Die Datei der Lagekarte (kritis-lage-offline.html) wurde nicht gefunden.');
  console.error('Legen Sie sie neben dieses Skript oder geben Sie den Pfad an, zum Beispiel:');
  console.error('  node lage-server.js --file C:\\Lage\\kritis-lage-offline.html');
  process.exit(1);
})();
const ROOT = path.dirname(FILE);
const PIN = process.argv.includes('--no-pin') ? '' : String(arg('pin', String(crypto.randomInt(1000, 10000))));
const STORE = path.join(__dirname, 'lage-live.json');   // zuletzt übergebener Stand, liegt neben dem Skript
const MAX_BODY = 40 * 1024 * 1024;

let live = { rev: 0, time: null, state: null };
try { const j = JSON.parse(fs.readFileSync(STORE, 'utf8')); if (j && j.state) live = j; } catch (e) { /* kein gespeicherter Stand */ }
const clients = new Set();

const lanUrls = () => {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => { if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + PORT); }));
  return out;
};
// Nur Anfragen vom Rechner selbst (Loopback) dürfen Stände einliefern. Alle anderen brauchen die PIN und dürfen nur lesen.
const isLocal = req => { const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, ''); return a === '127.0.0.1' || a === '::1'; };
const pinOk = (req, url) => isLocal(req) || !PIN || url.searchParams.get('k') === PIN;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const notify = () => clients.forEach(c => c.write('data: ' + JSON.stringify({ rev: live.rev }) + '\n\n'));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') return send(res, 200, { server: true, master: isLocal(req), pin: isLocal(req) ? PIN : undefined, pinRequired: !!PIN, urls: lanUrls(), viewers: clients.size, rev: live.rev });
  if (url.pathname === '/api/state' && req.method === 'GET') {
    if (!pinOk(req, url)) return send(res, 403, { error: 'PIN falsch' });
    return send(res, 200, live);
  }
  if (url.pathname === '/api/state' && req.method === 'POST') {
    if (!isLocal(req)) return send(res, 403, { error: 'nur vom Server-Rechner' });
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else parts.push(c); });
    req.on('end', () => {
      try {
        const j = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (!j || typeof j.state !== 'object') throw new Error('kein Stand');
        live = { rev: live.rev + 1, time: new Date().toISOString(), state: j.state };
        fs.writeFile(STORE, JSON.stringify(live), () => {}); notify(); send(res, 200, { rev: live.rev });
      } catch (e) { send(res, 400, { error: String(e.message) }); }
    });
    return;
  }
  if (url.pathname === '/api/events') {
    if (!pinOk(req, url)) return send(res, 403, { error: 'PIN falsch' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\ndata: ' + JSON.stringify({ rev: live.rev }) + '\n\n');
    if (!isLocal(req)) clients.add(res);
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }
  // statische Dateien nur aus dem Ordner der Karte
  let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/' + path.basename(FILE);
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep) || rel.split('/').some(s => s.startsWith('.'))) return send(res, 404, 'nicht gefunden', 'text/plain; charset=utf-8');
  fs.readFile(full, (err, data) => err ? send(res, 404, 'nicht gefunden', 'text/plain; charset=utf-8') : send(res, 200, data, TYPES[path.extname(full)] || 'application/octet-stream'));
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Lagekarte, Live-Freigabe');
  console.log('  Karte bearbeiten (auf diesem Rechner): http://localhost:' + PORT + '/');
  lanUrls().forEach(u => console.log('  Ansicht für andere Geräte:             ' + u + '/?ansicht=1' + (PIN ? '&k=' + PIN : '')));
  console.log('  PIN: ' + (PIN || 'keine') + '   Datei: ' + FILE);
  console.log('  Beenden mit Strg+C. Die Windows-Firewall fragt beim ersten Start nach Zugriff im privaten Netz.');
});
