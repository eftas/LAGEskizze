#!/usr/bin/env python3
"""Baut aus src/public/simulation.html die eigenstaendige Datei simulation-einzeldatei.html (Leaflet und Zeichen eingebettet).
Aufruf: python3 tools/build_simulation.py [--cache ordner]"""
import argparse, base64, json, os, re, urllib.request
ap = argparse.ArgumentParser()
ap.add_argument('--src', default='src/public/simulation.html')
ap.add_argument('--out', default='src/public/simulation-einzeldatei.html')
ap.add_argument('--cache', default='/tmp/kritis-cache')
a = ap.parse_args(); os.makedirs(a.cache, exist_ok=True)
img = os.path.join(os.path.dirname(os.path.abspath(a.src)), 'images')
def fetch(url):
    f = os.path.join(a.cache, re.sub(r'[^A-Za-z0-9._-]', '_', url))
    if not os.path.exists(f):
        open(f, 'wb').write(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'lagekarte-build'}), timeout=60).read())
    return open(f, 'rb').read()
def uri(path): return 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(img, path), 'rb').read()).decode()
assets = {}
for n in ['FW_LF20', 'FW_HLF20', 'FW_DLK', 'FW_ELW1', 'FW_GW-G', 'FW_RW']: assets[n] = uri('symbols/' + n + '.svg')
for k, f in {'T_EL': 'Führungsstellen/EL', 'T_Stab': 'Führungsstellen/Führungsstab', 'T_EAL': 'Führungsstellen/EAL', 'T_LSt': 'Einrichtungen/Leitstelle'}.items(): assets[k] = uri('symbols-tz/' + f + '.svg')
for n in ['betroffene', 'sk1', 'sk2', 'sk3', 'tot', 'vermisst', 'gerettet']: assets['P_' + n] = uri('personen/' + n + '.svg')
for n in ['GHS02', 'GHS07', 'GHS08']: assets[n] = uri('ghs/' + n + '.svg')
html = open(a.src, encoding='utf-8').read()
html = html.replace('/*ASSETS*/', 'window.ASSETS=' + json.dumps(assets) + ';')
lay = {n: 'data:image/png;base64,' + base64.b64encode(fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/' + n)).decode() for n in ('layers.png', 'layers-2x.png')}
def css(m):
    c = fetch(m.group(1)).decode('utf-8')
    for n, u in lay.items(): c = c.replace('url(images/' + n + ')', 'url(' + u + ')')
    return '<style>' + c + '</style>'
html = re.sub(r'<link rel="stylesheet" href="(https://cdnjs[^"]+)"[^>]*>', css, html)
html = re.sub(r'<script src="(https://cdnjs[^"]+)"[^>]*></script>', lambda m: '<script>' + fetch(m.group(1)).decode('utf-8').replace('</script', '<\\/script') + '</script>', html)
assert 'cdnjs.cloudflare.com' not in html.replace('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images', '')
open(a.out, 'w', encoding='utf-8').write(html); print(a.out, round(len(html) / 1e6, 2), 'MB')
