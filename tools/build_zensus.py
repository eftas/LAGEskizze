#!/usr/bin/env python3
"""Baut die Bevoelkerungspakete (Zensus 2022, 100-m-Gitter) fuer die Lagekarte.

Eingabe (Download von destatis.de, Datenlizenz Deutschland - Namensnennung 2.0):
  - Zensus2022_Durchschnittsalter_100m-Gitter.csv
  - Zensus2022_Alter_INFR_100m-Gitter.csv        (infrastrukturelle Altersgruppen)
  - Zensus2022_Alter_5er-Jahresgruppen_100m-Gitter.csv
  - Bundeslaender-GeoJSON (isellsoap/deutschlandGeoJSON, 2_hoch.geo.json)

Ausgabe: je Bundesland eine Datei  zensus/zensus-<KUERZEL>.js  plus zensus/zensus-index.js

Paketformat (vor Base64 mit deflate-raw komprimiert), little endian:
  Kopf  : 'ZB1' | u32 Zellzahl | i32 xmin | i32 ymin    (Einheit: 100 m, EPSG:3035, linke untere Ecke)
  Zellen: nach (y, x) sortiert; je Zelle als Varint:
            dy (Zeilenwechsel, 0 = gleiche Zeile)
            xr (gleiche Zeile: x - x_vorher, sonst x - xmin)
            pop, age2 (Durchschnittsalter*2, 255 = unbekannt), u18x3 (unter 18 in Dritteln), o65
Alle Felder liegen als Spalten hintereinander (bessere Kompression).
"""
import argparse, base64, json, os, sys, zlib
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

CODES = {'DE-BW': 'BW', 'DE-BY': 'BY', 'DE-BE': 'BE', 'DE-BB': 'BB', 'DE-HB': 'HB', 'DE-HH': 'HH',
         'DE-HE': 'HE', 'DE-MV': 'MV', 'DE-NI': 'NI', 'DE-NW': 'NW', 'DE-RP': 'RP', 'DE-SL': 'SL',
         'DE-ST': 'ST', 'DE-SN': 'SN', 'DE-SH': 'SH', 'DE-TH': 'TH'}


def varints(a):
    a = np.asarray(a, dtype=np.int64)
    out = bytearray()
    for v in a.tolist():
        while v >= 128:
            out.append((v & 127) | 128)
            v >>= 7
        out.append(v)
    return bytes(out)


def num(s):
    return pd.to_numeric(s, errors='coerce').fillna(0).astype(np.int64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True, help='Ordner mit den drei CSV-Dateien')
    ap.add_argument('--geojson', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'src', 'public', 'zensus'))
    ap.add_argument('--only', help='Kuerzel, z. B. NW (Test)')
    a = ap.parse_args()

    def p(n): return os.path.join(a.dir, n)
    age = pd.read_csv(p('Zensus2022_Durchschnittsalter_100m-Gitter.csv'), sep=';', dtype=str)
    age.columns = ['id', 'x', 'y', 'age', 'flag'][:len(age.columns)]
    age['age'] = pd.to_numeric(age['age'].str.replace(',', '.'), errors='coerce')
    infr = pd.read_csv(p('Zensus2022_Alter_INFR_100m-Gitter.csv'), sep=';', dtype=str)
    infr.columns = ['id'] + list(infr.columns[1:])
    g5 = pd.read_csv(p('Zensus2022_Alter_5er-Jahresgruppen_100m-Gitter.csv'), sep=';', dtype=str)
    g5.columns = ['id'] + list(g5.columns[1:])

    base = g5[['id', 'x_mp_100m', 'y_mp_100m', 'Insgesamt_Bevoelkerung']].copy()
    old = ['a65bis69', 'a70bis74', 'a75bis79', 'a80bis84', 'a85bis89', 'a90undaelter']
    base['o65'] = sum(num(g5[c]) for c in old)
    base['pop'] = num(g5['Insgesamt_Bevoelkerung'])
    ip = infr.set_index('id')
    u18x3 = 3 * (num(infr['Unter3']) + num(infr['a3bis5']) + num(infr['a6bis9']) + num(infr['a10bis15'])) \
        + 2 * num(infr['a16bis18'])
    u = pd.DataFrame({'id': infr['id'], 'u18x3': u18x3})
    base = base.merge(u, on='id', how='left').merge(age[['id', 'age']], on='id', how='left')
    base['u18x3'] = base['u18x3'].fillna(0).astype(np.int64)
    print('Zellen', len(base), 'ohne Alter', int(base['age'].isna().sum()), flush=True)

    cx = pd.to_numeric(base['x_mp_100m']).to_numpy()
    cy = pd.to_numeric(base['y_mp_100m']).to_numpy()
    gx = ((cx - 50) // 100).astype(np.int64)
    gy = ((cy - 50) // 100).astype(np.int64)
    lon, lat = Transformer.from_crs(3035, 4326, always_xy=True).transform(cx, cy)

    gj = json.load(open(a.geojson, encoding='utf-8'))
    geoms = {}
    for f in gj['features']:
        geoms[CODES[f['properties']['id']]] = (f['properties']['name'], shapely.from_geojson(json.dumps(f['geometry'])))
    code = np.full(len(base), '', dtype='<U2')
    for k, (nm, geo) in geoms.items():
        m = shapely.contains_xy(geo, lon, lat) & (code == '')
        code[m] = k
    rest = np.where(code == '')[0]
    print('ausserhalb aller Landesgrenzen (wird dem naechsten Land zugeordnet):', len(rest), flush=True)
    if len(rest):
        keys = list(geoms.keys())
        tree = shapely.STRtree([geoms[k][1] for k in keys])
        pts = shapely.points(lon[rest], lat[rest])
        _, idx = tree.query_nearest(pts, all_matches=False)
        code[rest] = np.array(keys)[idx]

    os.makedirs(a.out, exist_ok=True)
    index = {}
    for k, (nm, geo) in sorted(geoms.items()):
        if a.only and k != a.only:
            continue
        m = code == k
        x, y = gx[m], gy[m]
        o = np.lexsort((x, y))
        x, y = x[o], y[o]
        pop = base['pop'].to_numpy()[m][o]
        o65 = base['o65'].to_numpy()[m][o]
        u3 = base['u18x3'].to_numpy()[m][o]
        ag = base['age'].to_numpy()[m][o]
        age2 = np.where(np.isnan(ag), 255, np.minimum(np.round(np.nan_to_num(ag) * 2), 254)).astype(np.int64)
        xmin, ymin = int(x.min()), int(y.min())
        dy = np.diff(y, prepend=y[0])
        dy[0] = 0
        same = dy == 0
        xr = np.where(same, np.diff(x, prepend=x[0]), x - xmin)
        xr[0] = x[0] - xmin
        assert y[0] == ymin
        raw = b'ZB1' + np.array([len(x)], '<u4').tobytes() + np.array([xmin, ymin], '<i4').tobytes()
        for col in (dy, xr, pop, age2, u3, o65):
            raw += varints(col)
        comp = zlib.compressobj(9, zlib.DEFLATED, -15)
        z = comp.compress(raw) + comp.flush()
        tot = int(pop.sum())
        meta = {'code': k, 'name': nm, 'cells': int(len(x)), 'pop': tot, 'u18': round(float(u3.sum()) / 3),
                'o65': int(o65.sum()), 'bbox': [xmin, ymin, int(x.max()), int(y.max())], 'bytes': len(z)}
        meta['b64'] = base64.b64encode(z).decode()
        js = "(window.ZENSUS_PKG=window.ZENSUS_PKG||{})[%s]=%s;\n" % (json.dumps(k), json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
        fn = os.path.join(a.out, 'zensus-%s.js' % k)
        open(fn, 'w', encoding='utf-8').write(js)
        index[k] = {kk: vv for kk, vv in meta.items() if kk != 'b64'}
        print('%s %-22s Zellen %8d Einwohner %10d  %.2f MB' % (k, nm, len(x), tot, len(js) / 1e6), flush=True)
    if not a.only:
        open(os.path.join(a.out, 'zensus-index.js'), 'w', encoding='utf-8').write(
            'window.ZENSUS_INDEX=%s;\n' % json.dumps(index, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
