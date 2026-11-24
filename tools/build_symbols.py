#!/usr/bin/env python3
"""Erzeugt aus den Vorlagen des Repositories jonas-koeritz/Taktische-Zeichen die SVG-Dateien und den Katalog.

Aufruf:  python3 tools/build_symbols.py /pfad/zu/Taktische-Zeichen [src/public/images/symbols-tz]
Benötigt: pip install jinja2  (der Ersatz für j2cli, das neuere Python-Versionen nicht mehr starten)
Ausgabe: SVG-Dateien (verkleinert), symbols-tz.js mit dem Katalog.
Lizenz der Vorlagen: CC BY 4.0, Urheber Jonas Köritz. Siehe LICENSES-symbole.md.
"""
import json, os, re, sys
import jinja2

src = os.path.abspath(sys.argv[1]); out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'src/public/images/symbols-tz')
os.chdir(src)
theme = json.load(open('themes/default.json', encoding='utf-8'))
env = jinja2.Environment(loader=jinja2.FileSystemLoader(['.', 'symbols']), keep_trailing_newline=True)
cats = {}; syms = []
for dp, dn, fn in sorted(os.walk('symbols')):
    dn.sort()
    for f in sorted(fn):
        if not f.endswith('.j2'): continue
        path = os.path.join(dp, f); rel = os.path.relpath(path, 'symbols')[:-3]; folder = os.path.dirname(rel) or 'Sonstiges'
        svg = env.get_template(path.replace(os.sep, '/')).render(**theme)
        svg = re.sub(r'<!DOCTYPE[^>]*>|<!--.*?-->', '', svg, flags=re.S); svg = re.sub(r'<style[^>]*>.*?</style>', '', svg, flags=re.S)
        svg = re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()
        target = os.path.join(out, rel + '.svg'); os.makedirs(os.path.dirname(target), exist_ok=True)
        open(target, 'w', encoding='utf-8').write(svg)
        cid = cats.setdefault(folder, 100 + len(cats) + 1)
        syms.append({'name': 'tz/' + rel.replace(os.sep, '/'), 'title': os.path.basename(rel).replace('_', ' '), 'keywords': folder.replace('_', ' '), 'category': cid})
catalog = {'categories': [{'name': k.replace('_', ' '), 'keyword': k, 'id': v} for k, v in cats.items()], 'symbols': syms}
js = '// erzeugt von tools/build_symbols.py, Quelle: github.com/jonas-koeritz/Taktische-Zeichen (CC BY 4.0)\n(function(){var x=' + json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + ';\nif(typeof symbolProperties!=="undefined"){symbolProperties.categories=symbolProperties.categories.concat(x.categories);symbolProperties.symbols=symbolProperties.symbols.concat(x.symbols);}else{window.symbolProperties=x;}})();\n'
open(os.path.join(out, 'symbols-tz.js'), 'w', encoding='utf-8').write(js)
print(len(syms), 'Symbole,', len(cats), 'Kategorien')
