#!/usr/bin/env python3
"""Extrahiert aus einem OSM-PBF-Auszug (z. B. BBBike Köln) die Daten für die Offline-Lagekarte.

Aufruf:  python3 extract_osm.py koeln.osm.pbf out.json
Benötigt: pip install osmium shapely
Ausgabe: JSON mit KRITIS-Objekten, Vektor-Grundkarte (Straßen, Bahn, Wasser, Grün), Ortsnamen, Verwaltungsgrenzen.
"""
import json, sys, datetime
import osmium
from shapely.geometry import LineString, Polygon

# Muss mit LAYERS in kritis-lage.html übereinstimmen (Reihenfolge = Index).
LAYERS = [
 ('umspannwerk',[[('power','substation')]]), ('kraftwerk',[[('power','plant')]]),
 ('wasserwerk',[[('man_made','water_works')]]), ('klaeranlage',[[('man_made','wastewater_plant')]]), ('wasserturm',[[('man_made','water_tower')]]),
 ('krankenhaus',[[('amenity','hospital')]]), ('pflege',[[('amenity','nursing_home')]]), ('apotheke',[[('amenity','pharmacy')]]),
 ('feuerwehr',[[('amenity','fire_station')]]), ('polizei',[[('amenity','police')]]), ('rettungswache',[[('emergency','ambulance_station')]]),
 ('bahnhof',[[('railway','station')]]), ('flughafen',[[('aeroway','aerodrome')]]), ('hafen',[[('industrial','port')]]),
 ('rechenzentrum',[[('telecom','data_center')]]), ('vermittlung',[[('telecom','exchange')]]),
 ('funkmast',[[('man_made','mast'),('tower:type','communication')],[('man_made','tower'),('tower:type','communication')]]),
 ('grosshandel',[[('shop','wholesale')]]), ('supermarkt',[[('shop','supermarket')]]), ('bank',[[('amenity','bank')]]),
 ('rathaus',[[('amenity','townhall')]]), ('behoerde',[[('office','government')]]), ('gericht',[[('amenity','courthouse')]]),
 ('zeitung',[[('office','newspaper')]]), ('studio',[[('amenity','studio')]]),
]
ROAD = {'motorway':'motorway','motorway_link':'motorway','trunk':'trunk','trunk_link':'trunk','primary':'primary','primary_link':'primary',
        'secondary':'secondary','secondary_link':'secondary','tertiary':'tertiary','tertiary_link':'tertiary',
        'unclassified':'minor','residential':'minor','living_street':'minor'}
TOL = {'motorway':2e-5,'trunk':2e-5,'primary':2e-5,'secondary':2.5e-5,'tertiary':3e-5,'minor':4e-5,'rail':3e-5,'water':3e-5,'river':3e-5}
DEG2_PER_M2 = 1 / 7.8e9

def classify(tags):
    for i,(lid,alts) in enumerate(LAYERS):
        if any(all(tags.get(k)==v for k,v in alt) for alt in alts): return i
    return None

def addr(t):
    a = []
    if t.get('addr:street'): a.append(t['addr:street'] + (' ' + t['addr:housenumber'] if t.get('addr:housenumber') else ''))
    c = ' '.join(x for x in (t.get('addr:postcode'), t.get('addr:city')) if x)
    if c: a.append(c)
    return ', '.join(a)

def enc(vals):
    out=[]
    for v in vals:
        v = ~(v<<1) if v<0 else v<<1
        while v>=0x20:
            out.append(chr((0x20|(v&0x1f))+63)); v>>=5
        out.append(chr(v+63))
    return ''.join(out)
def poly_enc(coords):                    # coords: [(lon,lat)...]
    pl=pla=0; out=[]
    for lon,lat in coords:
        la=round(lat*1e5); lo=round(lon*1e5)
        out += [la-pla, lo-pl]; pla,pl=la,lo
    return enc(out)

class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.pois = {}; self.lines = {k:[] for k in ['motorway','trunk','primary','secondary','tertiary','minor','rail','river']}
        self.water=[]; self.green=[]; self.places=[]; self.admin=[]
    def poi(self, key, lat, lng, t):
        i = classify(t)
        if i is None or key in self.pois: return
        self.pois[key] = [key, round(lat,6), round(lng,6), i, t.get('name') or t.get('operator') or '', addr(t)]
    def node(self, n):
        t = {x.k:x.v for x in n.tags}
        if not t: return
        self.poi('n%d'%n.id, n.location.lat, n.location.lon, t)
        pl = t.get('place')
        if pl in ('city','town','suburb','quarter','village') and t.get('name'):
            self.places.append([round(n.location.lat,5), round(n.location.lon,5), t['name'], {'city':0,'town':1,'suburb':2,'quarter':3,'village':3}[pl]])
    def way(self, w):
        t = {x.k:x.v for x in w.tags}
        if not t: return
        cls = None
        if 'highway' in t and t['highway'] in ROAD: cls = ROAD[t['highway']]
        elif t.get('railway') in ('rail','light_rail','tram','subway') and t.get('service') is None: cls = 'rail'
        elif t.get('waterway') in ('river','canal'): cls = 'river'
        if not cls: return
        try: pts = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(pts) < 2: return
        g = LineString(pts).simplify(TOL[cls], preserve_topology=False)
        if g.geom_type == 'LineString' and len(g.coords) >= 2:
            self.lines[cls].append(poly_enc(list(g.coords)))
    def area(self, a):
        t = {x.k:x.v for x in a.tags}
        if not t: return
        try: rings = [[(n.lon, n.lat) for n in r] for r in a.outer_rings()]
        except osmium.InvalidLocationError: return
        if not rings: return
        big = max(rings, key=len)
        if len(big) < 4: return
        pg = Polygon(big)
        if not pg.is_valid: pg = pg.buffer(0)
        if pg.is_empty: return
        c = pg.representative_point()
        key = ('w%d' if a.from_way() else 'r%d') % a.orig_id()
        self.poi(key, c.y, c.x, t)
        ar = pg.area
        if t.get('boundary') == 'administrative' and t.get('admin_level') in ('6','9','10') and t.get('name'):
            polys = [poly_enc(list(Polygon(r).simplify(1.5e-4, preserve_topology=True).exterior.coords)) for r in rings if len(r) >= 4]
            self.admin.append({'name': t['name'], 'level': int(t['admin_level']), 'rings': polys})
        if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') == 'reservoir':
            if ar > 3000*DEG2_PER_M2: self.water.append(poly_enc(list(pg.simplify(3e-5).exterior.coords)))
        elif t.get('landuse') in ('forest','grass','meadow','recreation_ground','village_green','cemetery') or t.get('leisure') in ('park','garden','nature_reserve') or t.get('natural') in ('wood','grassland'):
            if ar > 25000*DEG2_PER_M2: self.green.append(poly_enc(list(pg.simplify(6e-5).exterior.coords)))

src, dst = sys.argv[1], sys.argv[2]
h = H(); h.apply_file(src, locations=True)
out = {'meta': {'source': 'OpenStreetMap-Mitwirkende (ODbL), Auszug BBBike Köln', 'built': datetime.date.today().isoformat(), 'layers': [l[0] for l in LAYERS]},
       'pois': list(h.pois.values()), 'lines': h.lines, 'water': h.water, 'green': h.green, 'places': h.places, 'admin': h.admin}
json.dump(out, open(dst,'w'), ensure_ascii=False, separators=(',',':'))
print({k:(len(v) if hasattr(v,'__len__') else v) for k,v in out.items() if k!='meta'}, {k:len(v) for k,v in h.lines.items()})
