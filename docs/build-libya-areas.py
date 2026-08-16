"""Build the four-level Libya area dataset from OSM place nodes + the ministry
municipality list. Every level-3 row traces to an OSM node id; nothing invented."""
import json, math, re, csv, unicodedata, collections

TIFINAGH = re.compile(r'[ⴰ-⵿]+')
LATIN = re.compile(r'[A-Za-z]')

def arabic_name(tags):
    """name:ar wins; otherwise strip Tifinagh and Latin runs out of `name`."""
    if tags.get('name:ar'):
        return tags['name:ar'].strip()
    raw = TIFINAGH.sub(' ', tags.get('name', ''))
    # `الظهرة Dhahra` -> `الظهرة`: drop trailing Latin transliteration.
    parts = [p for p in raw.split() if not LATIN.search(p)]
    return ' '.join(parts).strip()

def display_name(tags):
    """The Arabic name where OSM has one; the Latin name rather than nothing.

    Ben Ashour and Gargaresh are mapped with Latin names only. Dropping them
    would lose two of Tripoli's best-known neighbourhoods, and writing the
    Arabic from the transliteration would be inventing data — so the row ships
    with the name OSM holds and `تعريب مطلوب` marks it for a human pass.
    """
    ar = arabic_name(tags)
    if ar:
        return ar, 'لا'
    latin = TIFINAGH.sub(' ', tags.get('name', '') or tags.get('name:en', '')).strip()
    return re.sub(r'\s+', ' ', latin), 'نعم' 

def norm(s):
    """Compare Arabic names ignoring the spellings that differ by habit."""
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    for a, b in (('أإآٱ', 'ا'), ('ى', 'ي'), ('ة', 'ه'), ('ؤ', 'و'), ('ئ', 'ي')):
        for ch in a:
            s = s.replace(ch, b)
    s = re.sub(r'^(ال|بلدية\s+|مدينة\s+|حي\s+)', '', s.strip())
    return re.sub(r'\s+', ' ', s).strip()

def km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371 * 2 * math.asin(math.sqrt(h))

def bearing(centre, p):
    lat1, lat2 = math.radians(centre[0]), math.radians(p[0])
    dlon = math.radians(p[1] - centre[1])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1)*math.sin(lat2) - math.sin(lat1)*math.cos(lat2)*math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

places = json.load(open('ly_all.json'))['elements']
# Ways and relations carry a `center`, nodes carry lat/lon directly. Half of
# Tripoli's neighbourhoods are mapped as areas, not points, so both are needed.
for p in places:
    if 'lat' not in p and 'center' in p:
        p['lat'], p['lon'] = p['center']['lat'], p['center']['lon']
places = [p for p in places if 'lat' in p]
for p in places:
    p['ar'], p['needs_ar'] = display_name(p['tags'])
    p['key'] = norm(p['ar'])

# ---- level 1: the major cities the brief names, pinned to their OSM node ----
LEVEL1 = ['طرابلس', 'بنغازي', 'مصراتة', 'الزاوية', 'الخمس', 'زليتن', 'سرت', 'سبها',
          'البيضاء', 'درنة', 'طبرق', 'أجدابيا', 'غريان', 'ترهونة', 'صبراتة', 'صرمان', 'زوارة']
PRIMARY = list(LEVEL1)  # the 17 the brief names, before OSM adds the rest
# How far out a neighbourhood can sit and still belong to the city, by size.
RADIUS = collections.defaultdict(lambda: 20.0, {'طرابلس': 35.0, 'بنغازي': 30.0, 'مصراتة': 25.0})

# Sabratha is a way in OSM, not a node, so the place-node extract misses it.
# Point taken from Nominatim rather than typed from memory.
PINNED = {'صبراتة': (32.7884983, 12.4913440)}

# Rule 10: cover the areas people actually use, not only the 17 named as
# examples. Every other city OSM knows becomes a level-1 of its own, so the
# neighbourhoods around it have somewhere to belong instead of being dropped.
osm_cities = sorted({arabic_name(p['tags']) for p in places
                     if p['tags'].get('place') == 'city' and arabic_name(p['tags'])})
for extra in osm_cities:
    if not any(norm(extra) == norm(n) for n in LEVEL1):
        LEVEL1.append(extra)

cities = dict(PINNED)
for name in LEVEL1:
    k = norm(name)
    hits = [p for p in places if p['key'] == k and p['tags'].get('place') in ('city', 'town')]
    if not hits:
        hits = [p for p in places if p['key'] == k]
    if hits:
        best = sorted(hits, key=lambda p: {'city': 0, 'town': 1}.get(p['tags'].get('place'), 2))[0]
        cities.setdefault(name, (best['lat'], best['lon']))
print('level-1 cities located:', len(cities), 'of', len(LEVEL1))
print('  missing:', [n for n in LEVEL1 if n not in cities])

# ---- level 4: ministry municipality list, pinned where OSM knows the name ----
baladiyat = [b for b in json.load(open('baladiyat.json'))
             if not b.startswith("''") and 'المنطقة الادارية' not in b]
muni_pts = {}
for b in baladiyat:
    k = norm(b)
    hits = [p for p in places if p['key'] == k]
    if hits:
        best = sorted(hits, key=lambda p: {'city': 0, 'town': 1, 'suburb': 2}.get(p['tags'].get('place'), 3))[0]
        muni_pts[b] = (best['lat'], best['lon'])
print(f'municipalities: {len(baladiyat)} listed, {len(muni_pts)} located in OSM')

# ---- level 3: only real OSM neighbourhoods, assigned to the nearest city ----
AREA_KINDS = ('suburb', 'neighbourhood', 'quarter', 'borough')
# OSM has only Latin `name` tags for these two well-known Tripoli areas. Keep
# the source name in the alternate-name column, but use the reviewed Arabic
# spelling in the operational name shown to users.
ARABIC_OVERRIDES = {
    'OSM relation/14708500': 'النوفليين',
    'OSM relation/14713957': 'بن عاشور',
}
SCOPE = [(337.5, 22.5, 'شمال'), (22.5, 67.5, 'شمال شرق'), (67.5, 112.5, 'شرق'),
         (112.5, 157.5, 'جنوب شرق'), (157.5, 202.5, 'جنوب'), (202.5, 247.5, 'جنوب غرب'),
         (247.5, 292.5, 'غرب'), (292.5, 337.5, 'شمال غرب')]

def scope_of(city, centre, point):
    """Centre stays centre; further out, the compass sector it sits in."""
    d = km(centre, point)
    if d <= 3.5:
        return f'{city} المركز'
    b = bearing(centre, point)
    for lo, hi, label in SCOPE:
        if (lo > hi and (b >= lo or b < hi)) or (lo <= b < hi):
            return f'{label} {city}'
    return f'{city} المركز'

rows, unassigned = [], 0
for p in places:
    if p['tags'].get('place') not in AREA_KINDS or not p['ar']:
        continue
    # A named major city wins whenever the point falls inside it, even if a
    # smaller city sits closer: Qasr Bin Ghashir is its own municipality but it
    # is still somewhere in greater Tripoli, and that is how an order is priced.
    def nearest(names):
        c = sorted((km(cities[n], (p['lat'], p['lon'])), n) for n in names if n in cities)
        return c[0] if c and c[0][0] <= RADIUS[c[0][1]] else None

    found = nearest(PRIMARY) or nearest([n for n in LEVEL1 if n not in PRIMARY])
    if not found:
        unassigned += 1
        continue
    dist, city = found

    mdist, muni = None, ''
    if muni_pts:
        cand = sorted((km(c, (p['lat'], p['lon'])), n) for n, c in muni_pts.items())
        # A municipality centre more than 25 km away is a guess, not an answer.
        if cand[0][0] <= 25.0:
            mdist, muni = cand[0]

    tags = p['tags']
    alt = tags.get('alt_name') or tags.get('old_name') or tags.get('name:en') or ''
    source = f"OSM {p['type']}/{p['id']}"
    reviewed_name = ARABIC_OVERRIDES.get(source, p['ar'])
    rows.append({
        'المدينة الكبرى': city,
        'النطاق الجغرافي': scope_of(city, cities[city], (p['lat'], p['lon'])),
        'المنطقة / الحي': reviewed_name,
        'البلدية': muni,
        'الاسم البديل': alt,
        'خط العرض': round(p['lat'], 6),
        'خط الطول': round(p['lon'], 6),
        'بُعد عن مركز المدينة (كم)': round(dist, 1),
        'دقة البلدية': f'{mdist:.1f} كم' if mdist is not None else 'غير محدد',
        'تعريب مطلوب': 'لا' if source in ARABIC_OVERRIDES else p['needs_ar'],
        'المصدر': source,
    })

# Same name twice in one city is one place mapped twice; keep the closer node.
rows.sort(key=lambda r: (r['المدينة الكبرى'], r['المنطقة / الحي'], r['بُعد عن مركز المدينة (كم)']))
seen, deduped = set(), []
for r in rows:
    k = (r['المدينة الكبرى'], norm(r['المنطقة / الحي']))
    if k in seen:
        continue
    seen.add(k)
    deduped.append(r)

deduped.sort(key=lambda r: (LEVEL1.index(r['المدينة الكبرى']), r['النطاق الجغرافي'], r['المنطقة / الحي']))
for i, r in enumerate(deduped, 1):
    r['المعرف'] = f'{i:04d}'

cols = ['المعرف', 'المدينة الكبرى', 'النطاق الجغرافي', 'المنطقة / الحي', 'البلدية',
        'الاسم البديل', 'خط العرض', 'خط الطول', 'بُعد عن مركز المدينة (كم)', 'دقة البلدية', 'تعريب مطلوب', 'المصدر']
with open('/home/omix/rawaj/rawaj/docs/libya-areas.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows({c: r[c] for c in cols} for r in deduped)

# The municipality list in full, so level 4 is usable even where no area matched.
with open('/home/omix/rawaj/rawaj/docs/libya-municipalities.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['المعرف', 'البلدية', 'خط العرض', 'خط الطول', 'محددة الموقع'])
    for i, b in enumerate(sorted(baladiyat, key=norm), 1):
        pt = muni_pts.get(b)
        w.writerow([f'{i:03d}', b, pt[0] if pt else '', pt[1] if pt else '', 'نعم' if pt else 'لا'])

print(f'\nlevel-3 rows: {len(deduped)}  (dropped {unassigned} outside every city radius)')
print('with a municipality:', sum(1 for r in deduped if r['البلدية']))
per_city = collections.Counter(r['المدينة الكبرى'] for r in deduped)
for c in LEVEL1:
    print(f'  {c:10s} {per_city.get(c, 0):4d}')
