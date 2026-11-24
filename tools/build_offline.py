#!/usr/bin/env python3
"""Baut aus src/public/kritis-lage.html eine eigenständige Einzeldatei ohne Abhängigkeit von Internet-Bibliotheken.

Aufruf:  python3 tools/build_offline.py [--cache ordner] [--out src/public/kritis-lage-einzeldatei.html]
Eingebettet werden Bibliotheken (von cdnjs), Schriften, Taktische Zeichen und der Zeichengenerator. Beim Bauen wird Internet gebraucht, beim Benutzen nicht.
Kartenkacheln, Ortssuche und die Abfrage der KRITIS-Objekte brauchen weiterhin eine Internetverbindung.
"""
import argparse, base64, json, os, re, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('--src', default='src/public/kritis-lage.html')
ap.add_argument('--cache', default='/tmp/kritis-cache')
ap.add_argument('--out', default='src/public/kritis-lage-einzeldatei.html')
ap.add_argument('--zensus', default='all', help='Bundeslaender fuer die eingebetteten Bevoelkerungspakete: all, none oder Kuerzel mit Komma, z. B. NW,BY')
a = ap.parse_args()
os.makedirs(a.cache, exist_ok=True)

def fetch(url):
    f = os.path.join(a.cache, re.sub(r'[^A-Za-z0-9._-]', '_', url))
    if not os.path.exists(f):
        req = urllib.request.Request(url, headers={'User-Agent': 'lagekarte-build'})
        open(f, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    return open(f, 'rb').read()

html = open(a.src, encoding='utf-8').read()

# ---- CSS inline ----
img = {n: 'data:image/png;base64,' + base64.b64encode(fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/' + n)).decode() for n in ('layers.png', 'layers-2x.png')}
def inline_css(m):
    css = fetch(m.group(1)).decode('utf-8')
    for n, uri in img.items(): css = css.replace('url(images/' + n + ')', 'url(' + uri + ')')
    css = re.sub(r'url\(["\']?images/[^)]*\)', 'none', css)
    return '<style>' + css + '</style>'
html = re.sub(r'<link rel="stylesheet" href="(https://cdnjs[^"]+)"[^>]*>', inline_css, html)

# ---- Schriften inline ----
def inline_font(m):
    f = os.path.join(os.path.dirname(os.path.abspath(a.src)), m.group(1))
    return 'url(data:font/woff2;base64,' + base64.b64encode(open(f, 'rb').read()).decode() + ')'
html = re.sub(r'url\((fonts/[^)]+\.woff2)\)', inline_font, html)

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
# Zusatzzeichen (Jonas Köritz) und DV-102-Generator (Philipp Jardas) einbetten
tzdir = os.path.join(os.path.dirname(symdir), 'symbols-tz')
if os.path.isdir(tzdir):
    tzjs = open(os.path.join(tzdir, 'symbols-tz.js'), encoding='utf-8').read().replace('</script', '<\\/script')
    tzuris = {}
    for dp, dn, fn in os.walk(tzdir):
        for f in fn:
            if f.endswith('.svg'):
                rel = os.path.relpath(os.path.join(dp, f), tzdir).replace(os.sep, '/')[:-4]
                tzuris['tz/' + rel] = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(dp, f), 'rb').read()).decode()
    html = html.replace('<script src="images/symbols-tz/symbols-tz.js"></script>', '<script>' + tzjs + '\nObject.assign(window.SYMBOL_URIS,' + json.dumps(tzuris) + ');</script>')
libdir = os.path.join(os.path.dirname(symdir), '..', 'lib')
def inline_local(m):
    f = os.path.join(os.path.dirname(os.path.abspath(a.src)), m.group(1))
    return '<script>' + open(f, encoding='utf-8').read().replace('</script', '<\\/script') + '</script>'
html = re.sub(r'<script src="(lib/[^"]+)"></script>', inline_local, html)

# ---- Bilder fuer Gefahrstoffe und Personenzeichen (ghs, personen) als Data-URIs ----
imgdir = os.path.join(os.path.dirname(os.path.abspath(a.src)), 'images')
uris = {}
for sub in ('ghs', 'personen'):
    d = os.path.join(imgdir, sub)
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.endswith('.svg'): uris[sub + '/' + f[:-4]] = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(d, f), 'rb').read()).decode()
html = html.replace('<!--IMG_URIS-->', '<script>window.IMG_URIS=' + json.dumps(uris) + ';</script>')

# ---- Bevoelkerungspakete (Zensus 2022) ----
zdir = os.path.join(os.path.dirname(os.path.abspath(a.src)), 'zensus')
if a.zensus != 'none' and os.path.exists(os.path.join(zdir, 'zensus-index.js')):
    idxjs = open(os.path.join(zdir, 'zensus-index.js'), encoding='utf-8').read()
    codes = sorted(f[7:9] for f in os.listdir(zdir) if re.fullmatch(r'zensus-[A-Z]{2}\.js', f))
    if a.zensus != 'all': codes = [c for c in codes if c in a.zensus.split(',')]
    pk = ''.join(open(os.path.join(zdir, 'zensus-%s.js' % c), encoding='utf-8').read() for c in codes)
    html = re.sub(r'<script src="zensus/zensus-index.js"[^>]*></script>', lambda m: '<script>' + idxjs.replace('</script', '<\\/script') + pk + '</script>', html)
    print('Bevoelkerungspakete eingebettet:', ', '.join(codes))
else:
    print('Hinweis: keine Bevoelkerungspakete eingebettet')

assert 'cdnjs.cloudflare.com' not in html.replace('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images', ''), 'externe Verweise übrig'
open(a.out, 'w', encoding='utf-8').write(html)
print(a.out, round(len(html) / 1e6, 2), 'MB')
