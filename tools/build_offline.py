#!/usr/bin/env python3
"""Baut aus src/public/kritis-lage.html eine einzelne Datei ohne Internetabhängigkeit.

Aufruf:  python3 tools/build_offline.py --data koeln.json [--cache ordner] [--out src/public/kritis-lage-offline.html]
Die Daten stammen aus tools/extract_osm.py. Beim Bauen wird Internet gebraucht (Bibliotheken von cdnjs), beim Benutzen nicht.
"""
import argparse, base64, json, os, re, urllib.request
from shapely.geometry import Polygon, Point

ap = argparse.ArgumentParser()
ap.add_argument('--src', default='src/public/kritis-lage.html')
ap.add_argument('--data', required=True)
ap.add_argument('--cache', default='/tmp/kritis-cache')
ap.add_argument('--out', default='src/public/kritis-lage-offline.html')
a = ap.parse_args()
os.makedirs(a.cache, exist_ok=True)

def fetch(url):
    f = os.path.join(a.cache, re.sub(r'[^A-Za-z0-9._-]', '_', url))
    if not os.path.exists(f):
        req = urllib.request.Request(url, headers={'User-Agent': 'lagekarte-build'})
        open(f, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    return open(f, 'rb').read()

def dec(s):
    out = []; i = la = lo = 0
    while i < len(s):
        for k in (0, 1):
            r = sh = 0
            while True:
                b = ord(s[i]) - 63; i += 1; r |= (b & 31) << sh; sh += 5
                if b < 32: break
            d = ~(r >> 1) if r & 1 else r >> 1
            if k == 0: la += d
            else: lo += d
        out.append((lo / 1e5, la / 1e5))
    return out

html = open(a.src, encoding='utf-8').read()

# ---- Daten: Verwaltungsgebiete auf Köln beschränken ----
D = json.load(open(a.data, encoding='utf-8'))
koeln = [x for x in D['admin'] if x['level'] == 6 and x['name'] == 'Köln'][0]
kp = max((Polygon(dec(r)) for r in koeln['rings']), key=lambda p: p.area).buffer(0)
keep = []
for x in D['admin']:
    if x['level'] == 6 and x['name'] != 'Köln': continue
    pts = [Polygon(dec(r)) for r in x['rings'] if len(r) > 3]
    if not pts: continue
    big = max(pts, key=lambda p: p.area).buffer(0)
    if x['level'] == 6 or kp.contains(big.representative_point()): keep.append(x)
D['admin'] = keep
minx, miny, maxx, maxy = kp.bounds
D['meta']['bbox'] = [round(miny - 0.05, 4), round(minx - 0.05, 4), round(maxy + 0.05, 4), round(maxx + 0.05, 4)]
D['meta']['source'] = 'OpenStreetMap-Mitwirkende (ODbL), Auszug Köln'
print('admin kept', len(keep), 'bbox', D['meta']['bbox'])

# ---- CSS inline ----
img = {n: 'data:image/png;base64,' + base64.b64encode(fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/' + n)).decode() for n in ('layers.png', 'layers-2x.png')}
def inline_css(m):
    css = fetch(m.group(1)).decode('utf-8')
    for n, uri in img.items(): css = css.replace('url(images/' + n + ')', 'url(' + uri + ')')
    css = re.sub(r'url\(["\']?images/[^)]*\)', 'none', css)
    return '<style>' + css + '</style>'
html = re.sub(r'<link rel="stylesheet" href="(https://cdnjs[^"]+)"[^>]*>', inline_css, html)

# ---- JS inline ----
def inline_js(m):
    js = fetch(m.group(1)).decode('utf-8').replace('</script', '<\\/script')
    return '<script>' + js + '</script>'
html = re.sub(r'<script src="(https://cdnjs[^"]+)"[^>]*></script>', inline_js, html)

# ---- Symbole ----
symdir = os.path.join(os.path.dirname(os.path.abspath(a.src)), 'images', 'symbols')
symjs = open(os.path.join(symdir, 'symbols.js'), encoding='utf-8-sig').read()
uris = {}
for f in sorted(os.listdir(symdir)):
    if not f.endswith('.svg'): continue
    t = open(os.path.join(symdir, f), encoding='utf-8', errors='replace').read()
    t = re.sub(r'<\?xml.*?\?>|<!--.*?-->|<!DOCTYPE[^>]*>', '', t, flags=re.S); t = re.sub(r'\s+', ' ', t).strip()
    uris[f[:-4]] = 'data:image/svg+xml;base64,' + base64.b64encode(t.encode()).decode()
html = re.sub(r'<!-- Taktische Zeichen.*?-->\s*<script src="images/symbols/symbols.js"[^>]*></script>',
              lambda m: '<script>' + symjs.replace('</script', '<\\/script') + '\nwindow.SYMBOL_URIS=' + json.dumps(uris) + ';</script>', html, flags=re.S)

# ---- Daten einbetten (vor dem Hauptskript) ----
blob = json.dumps(D, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
marker = '<script>\n(function () {'
assert html.count(marker) == 1
html = html.replace(marker, '<script>window.OFFLINE_DATA=' + blob + ';</script>\n' + marker)

assert 'cdnjs.cloudflare.com' not in html.replace('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images', ''), 'externe Verweise übrig'
open(a.out, 'w', encoding='utf-8').write(html)
print(a.out, round(len(html) / 1e6, 2), 'MB')
