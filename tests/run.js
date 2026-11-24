#!/usr/bin/env node
/* Ende-zu-Ende-Tests der LAGEkarte (Playwright, headless Chromium).
   Aufruf: npm test   (nutzt src/public/kritis-lage-einzeldatei.html, ohne Netz außer den Kartenkacheln) */
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const FILE = 'file://' + path.resolve(__dirname, '..', 'src', 'public', 'kritis-lage-einzeldatei.html');
const SUBSTANZEN = ['benzol', 'aceton', 'ethanol', 'benzin', 'diesel', 'hcl', 'h2so4', 'propan', 'ammoniak', 'chlor', 'methanol', 'natronlauge', 'hno3', 'h2o2', 'co'];
let ok = 0, fail = 0; const errs = [];
async function t(name, fn) { try { await fn(); ok++; console.log('ok    ' + name); } catch (e) { fail++; console.log('FEHLER ' + name + '\n       ' + String(e.message).split('\n')[0]); } }
async function seite(b, q, w, h) {
  const p = await (await b.newContext({ viewport: { width: w || 1440, height: h || 900 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE + (q || '')); await p.waitForFunction(() => window.__lage); await p.waitForTimeout(600); return p;
}
(async () => {
  const b = await chromium.launch();
  await t('Start ohne Skriptfehler, Name und Rolle', async () => {
    const p = await seite(b, '?rolle=S2'); assert.strictEqual(await p.textContent('h1'), 'LAGEkarte'); assert.ok((await p.textContent('#roleChip')).includes('S2')); await p.close();
  });
  await t('Burger-Menü öffnet und schließt, Lagevortrag und Dunkelmodus liegen in der Kopfzeile', async () => {
    const p = await seite(b, '?rolle=S2'); assert.ok(await p.locator('#btnVortrag').isVisible()); assert.ok(await p.locator('#btnTheme').isVisible());
    await p.click('#btnMore'); await p.waitForTimeout(500); assert.ok(await p.locator('#btnUnits').isVisible());
    await p.keyboard.press('Escape'); await p.waitForTimeout(500); assert.ok(!(await p.locator('#btnUnits').isVisible())); await p.close();
  });
  await t('Lagevortrag starten und beenden', async () => {
    const p = await seite(b, '?rolle=S2'); await p.click('#btnVortrag'); await p.waitForTimeout(700);
    assert.ok(await p.evaluate(() => document.body.classList.contains('vortrag')));
    await p.click('#vtBurger'); await p.waitForTimeout(500); await p.click('.vtm.end'); await p.waitForTimeout(700);
    assert.ok(!(await p.evaluate(() => document.body.classList.contains('vortrag')))); await p.close();
  });
  await t('Gefahrstoffe: alle ' + SUBSTANZEN.length + ' anlegen, keine Fehlertexte (NaN, undefined)', async () => {
    for (const sid of SUBSTANZEN) {
      const p = await seite(b); await p.evaluate(() => { window.__lage.state.wind = { dir: 157, speed: 3, cond: 'bedeckt', stab: '', terrain: 'stadt', time: new Date().toISOString() }; window.__lage.map.setView([50.929, 6.938], 14, { animate: false }); });
      await p.click('[data-tab="chem"]'); await p.selectOption('#chemSel', sid); await p.click('#chemPlace'); await p.mouse.click(900, 450); await p.waitForTimeout(900);
      assert.strictEqual(await p.locator('.cm-inc').count(), 1, sid + ': kein Vorfall');
      const bad = await p.evaluate(() => (document.body.innerText.match(/NaN|Infinity|undefined|\bnull\b/g) || [])); assert.deepStrictEqual(bad, [], sid + ': ' + bad.join()); await p.close();
    }
  });
  await t('ERG Tabelle 3 (Chlor, Ammoniak): Windklassen, Tag/Nacht, Behälter, Grenzen', async () => {
    const p = await seite(b);
    const r = await p.evaluate(() => { const L = window.__lage, c = L.chemSub('chlor'), n = L.chemSub('ammoniak'), w = sp => { L.state.wind = { dir: 1, speed: sp, time: '' }; };
      const co = L.chemSub('co'); const f = (s, inc, sp) => { w(sp); const e = L.chemErg(s, inc); return [e.isolate, e.spill, e.plus]; };
      return { c1: f(c, { large: true, night: false, cont: 'strasse' }, 2.7), c2: f(c, { large: true, night: false, cont: 'strasse' }, 2.78), c3: f(c, { large: true, night: false, cont: 'strasse' }, 5.56),
        c4: f(c, { large: true, night: true, cont: 'kesselwagen' }, 1), c5: f(c, { large: false, night: true }, 3), n1: f(n, { large: true, night: true, cont: 'kesselwagen' }, 1), n2: f(n, { large: true, night: false, cont: 'flaschen' }, 4), n3: f(n, { large: true, night: false, cont: 'flaschen' }, null), k1: f(co, { large: true, night: false }, 3), k2: f(co, { large: true, night: true }, 3), k3: f(co, { large: false, night: true }, 3) }; });
    assert.deepStrictEqual(r.c1, [600, 5600, false]); assert.deepStrictEqual(r.c2, [600, 3300, false]); assert.deepStrictEqual(r.c3, [600, 2500, false]);
    assert.deepStrictEqual(r.c4, [1000, 11000, true]); assert.deepStrictEqual(r.c5, [60, 1500, false]); assert.deepStrictEqual(r.n1, [300, 4100, false]); assert.deepStrictEqual(r.n2, [30, 200, false]); assert.deepStrictEqual(r.n3, [30, 300, false]); assert.deepStrictEqual(r.k1, [200, 1200, false]); assert.deepStrictEqual(r.k2, [200, 3900, false]); assert.deepStrictEqual(r.k3, [30, 200, false]); await p.close();
  });
  await t('Rechtsklick-Menü je Funktion: S5 ohne Bearbeitung, S3 nur Einheit', async () => {
    const m = async rolle => { const p = await seite(b, '?rolle=' + rolle, 1300, 800); await p.mouse.click(700, 400, { button: 'right' }); await p.waitForTimeout(500); const l = await p.evaluate(() => [...document.querySelectorAll('.ctx-item')].map(x => x.textContent.trim())); await p.close(); return l; };
    const s5 = await m('S5'), s3 = await m('S3'), s2 = await m('S2');
    assert.ok(!s5.some(x => /Gefahrstoff|Einheit|Problem|Objekt/.test(x))); assert.ok(s3.some(x => /Einheit hier/.test(x)) && !s3.some(x => /Gefahrstoff/.test(x))); assert.ok(s2.some(x => /Gefahrstoff/.test(x)));
  });
  await t('Tastenkürzel: G, T, Fragezeichen', async () => {
    const p = await seite(b, '?rolle=S2'); await p.keyboard.press('g'); await p.waitForTimeout(200);
    assert.strictEqual(await p.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.tab), 'chem');
    await p.keyboard.press('t'); await p.waitForTimeout(200); assert.strictEqual(await p.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.tab), 'tagebuch');
    await p.keyboard.press('Shift+?'); await p.waitForTimeout(500); assert.ok((await p.locator('.dlg kbd').count()) > 10); await p.close();
  });
  await t('Einweisung läuft durch und merkt sich das Ende', async () => {
    const p = await seite(b, '?rolle=S2&tour=1'); await p.waitForTimeout(2200); assert.strictEqual(await p.locator('.tour-card').count(), 1);
    for (let i = 0; i < 10; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100); }
    assert.strictEqual(await p.locator('.tour-card').count(), 0); assert.strictEqual(await p.evaluate(() => localStorage.getItem('kritis-tour')), '1'); await p.close();
  });
  await t('Fristen: überfälliges Problem erscheint im Kopf', async () => {
    const p = await seite(b, '?rolle=S2');
    await p.evaluate(() => { window.__lage.state.problems.unshift({ id: 'x1', title: 'Test', text: '', prio: 1, status: 'offen', owner: '', time: new Date().toISOString(), due: new Date(Date.now() - 60000).toISOString() }); });
    await p.waitForTimeout(1500); assert.ok(/überfällig/.test(await p.textContent('#fristChip'))); await p.close();
  });
  await t('Rückgängig und Wiederholen', async () => {
    const p = await seite(b, '?rolle=S2'); const n0 = await p.evaluate(() => window.__lage.state.journal.length);
    await p.evaluate(() => { const L = window.__lage; L.state.problems.push({ id: 'u1', title: 'U', text: '', prio: 2, status: 'offen', owner: '', time: new Date().toISOString() }); L.commit('Test'); });
    const a = await p.evaluate(() => { window.__lage.undo(); return window.__lage.state.problems.some(x => x.id === 'u1'); }); assert.strictEqual(a, false);
    const c = await p.evaluate(() => { window.__lage.redo(); return window.__lage.state.problems.some(x => x.id === 'u1'); }); assert.strictEqual(c, true); await p.close();
  });
  await t('Evakuierung planen: Objekt in der Zone, Stand und Kontakt werden gespeichert', async () => {
    const p = await seite(b, '?rolle=S2'); await p.evaluate(() => { const L = window.__lage; L.state.wind = { dir: 157, speed: 3, cond: 'bedeckt', stab: '', terrain: 'stadt', time: new Date().toISOString() }; L.map.setView([50.929, 6.938], 15, { animate: false }); });
    await p.click('[data-tab="chem"]'); await p.selectOption('#chemSel', 'chlor'); await p.click('#chemPlace'); await p.mouse.click(900, 450); await p.waitForTimeout(900);
    await p.evaluate(() => { const L = window.__lage, i = L.state.chem[0]; L.state.pois.m1 = { id: 'm1', lat: i.lat + 0.0006, lng: i.lng + 0.0002, layer: 'pflege', name: 'Seniorenheim Test', manual: true }; L.state.layerOn.pflege = true; L.runtime.vis.add('m1'); L.renderChem(); });
    await p.waitForTimeout(2500); await p.selectOption('.cm-evac select', 'info'); await p.fill('.cm-evac input', 'Frau Test'); await p.press('.cm-evac input', 'Tab'); await p.waitForTimeout(300);
    assert.deepStrictEqual(await p.evaluate(() => window.__lage.state.chem[0].evac.m1), { st: 'info', ct: 'Frau Test' }); await p.close();
  });
  await t('Wetterlage aus Uhrzeit und Bewölkung vorschlagen', async () => {
    const p = await seite(b, '?rolle=S2'); await p.click('[data-tab="keule"]'); await p.click('#wAuto button:has-text("Bedeckt")'); await p.waitForTimeout(300);
    assert.strictEqual(await p.evaluate(() => window.__lage.state.wind.cond), 'bedeckt'); await p.click('#wAuto button:has-text("Klar")'); await p.waitForTimeout(300);
    assert.ok(/^(tag-stark|tag-mittel|nacht-klar)$/.test(await p.evaluate(() => window.__lage.state.wind.cond))); await p.close();
  });
  await t('Meldungs-Vordruck füllt Zahlen aus der Lage vor', async () => {
    const p = await seite(b, '?rolle=S2'); await p.click('[data-tab="meldungen"]'); await p.selectOption('#mTpl', 'lage'); await p.waitForTimeout(300);
    const txt = await p.inputValue('#mText'); assert.ok(/LAGEMELDUNG, Stand/.test(txt) && /SK I 0/.test(txt) && /Kräfte: 0 Einheiten/.test(txt)); assert.strictEqual(await p.inputValue('#mDir'), 'aus');
    await p.selectOption('#mTpl', 'nachf'); assert.strictEqual(await p.inputValue('#mKind'), 'Anfrage'); await p.close();
  });
  await t('Touch: langes Drücken öffnet das Kartenmenü', async () => {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true }), p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(FILE + '?rolle=S2'); await p.waitForFunction(() => window.__lage); await p.waitForTimeout(600);
    const cdp = await ctx.newCDPSession(p); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 600, y: 400 }] }); await p.waitForTimeout(900);
    assert.ok((await p.locator('.ctx-item').count()) > 3); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await ctx.close();
  });
  await t('Karten-Zwischenspeicher: Kachel wird gespeichert und ohne Netz angezeigt', async () => {
    const ctx = await b.newContext({ viewport: { width: 900, height: 600 } }), p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'); let online = true;
    await ctx.route(/arcgisonline\.com/, r => online ? r.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }) : r.abort());
    await p.goto(FILE + '?rolle=S2'); await p.waitForFunction(() => window.__lage); await p.waitForTimeout(2500);
    const n1 = await p.evaluate(() => window.__lage.TileCache.count()); assert.ok(n1 > 0, 'keine Kacheln gespeichert'); online = false;
    await p.reload(); await p.waitForFunction(() => window.__lage); await p.waitForTimeout(2500);
    const ok = await p.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter(i => i.naturalWidth > 0).length); assert.ok(ok > 0, 'keine Kachel ohne Netz sichtbar'); await ctx.close();
  });
  await b.close();
  console.log('\n' + ok + ' bestanden, ' + fail + ' fehlgeschlagen'); if (errs.length) { console.log('Skriptfehler im Browser:', [...new Set(errs)]); fail++; }
  process.exit(fail ? 1 : 0);
})();
