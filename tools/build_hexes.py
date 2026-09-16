"""Build the hex grid for the WW2 board.

Every hex gets a terrain type and the region it belongs to. Terrain comes from
real data: elevation from Mapzen terrarium tiles, deserts and tundra from
Natural Earth's named physical regions. There is no forest class because no
global land-cover source was reachable; inventing one from latitude would be
guesswork, so plains covers it.

Writes hexes.js next to this script.
"""
import base64, json, math, os, re, sys
import elevation

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1077, 442
NORTH = 83.5
DEG = W / 360.0                       # px per degree, both axes
COLS = 156                            # even, so the grid wraps at the dateline
HEXW = W / COLS                       # 6.9038 px  ~= 2.31 deg ~= 250 km
R = HEXW / math.sqrt(3)               # circumradius
ROWH = 1.5 * R
ROWS = int(math.ceil(H / ROWH))

# terrain codes
SEA, PLAINS, HILLS, MOUNTAIN, DESERT, TUNDRA = range(6)


def hex_center(col, row):
    x = (col + 0.5 * (row & 1) + 0.5) * HEXW
    y = R + row * ROWH
    return x, y


# ---------------------------------------------------------------- source data
def load_region_paths():
    src = open(os.path.join(HERE, 'map-regions.js'), encoding='utf8').read()
    paths = json.loads(re.search(r'WW2_REGION_PATHS=(.*?);\n', src, re.S).group(1))
    out = {}
    for rid, d in paths.items():
        rings = []
        for sub in d.split('M')[1:]:
            pts = [tuple(float(v) for v in q.split(',')) for q in sub.rstrip('Z').split()]
            if len(pts) >= 3:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                rings.append((pts, min(xs), min(ys), max(xs), max(ys)))
        if rings:
            out[rid] = rings
    return out


def load_region_meta():
    src = open(os.path.join(HERE, 'index.html'), encoding='utf8').read()
    body = re.search(r'const H=\{([\s\S]*?)\n\};', src).group(1)
    meta = {}
    for m in re.finditer(r'"([a-z_0-9]+)":\["([^"]+)",([\d.-]+),([\d.-]+),"([LS])"(?:,"([A-Z]*)")?(?:,(\d))?', body):
        rid, name, x, y, kind, owner, cap = m.groups()
        meta[rid] = dict(name=name, x=float(x), y=float(y), land=kind == 'L',
                         owner=owner or 'NEU', cap=bool(cap))
    return meta


def load_physical():
    """Natural Earth named physical regions -> desert and tundra rings (canvas px)."""
    p = os.path.join(HERE, 'ne_regions.geojson')
    data = json.load(open(p, encoding='utf8'))
    out = {'Desert': [], 'Tundra': []}
    for f in data['features']:
        cls = f['properties'].get('FEATURECLA')
        if cls not in out:
            continue
        geom = f.get('geometry') or {}
        polys = geom.get('coordinates') or []
        if geom.get('type') == 'Polygon':
            polys = [polys]
        for poly in polys:
            for ring in poly[:1]:                      # outer ring is enough
                pts = [((lon + 180) * DEG, (NORTH - lat) * DEG) for lon, lat in ring]
                if len(pts) >= 3:
                    xs = [q[0] for q in pts]
                    ys = [q[1] for q in pts]
                    out[cls].append((pts, min(xs), min(ys), max(xs), max(ys)))
    return out


def in_rings(rings, x, y):
    """Even-odd point-in-polygon across a region's rings, with a bbox prefilter."""
    inside = False
    for pts, x0, y0, x1, y1 in rings:
        if x < x0 or x > x1 or y < y0 or y > y1:
            continue
        n = len(pts)
        j = n - 1
        for i in range(n):
            xi, yi = pts[i]
            xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def main():
    print('loading geometry...', file=sys.stderr)
    paths = load_region_paths()
    meta = load_region_meta()
    phys = load_physical()
    ids = [r for r in meta if r in paths]
    land_ids = [r for r in ids if meta[r]['land']]
    sea_ids = [r for r in ids if not meta[r]['land']]
    idx_of = {r: i for i, r in enumerate(ids)}

    # region bboxes, to skip regions quickly
    bbox = {}
    for r in ids:
        xs0 = min(b[1] for b in paths[r]); ys0 = min(b[2] for b in paths[r])
        xs1 = max(b[3] for b in paths[r]); ys1 = max(b[4] for b in paths[r])
        bbox[r] = (xs0, ys0, xs1, ys1)

    print('sampling elevation (this reads 256 tiles)...', file=sys.stderr)
    EW, EH = W * 2, H * 2
    grid = elevation.sample_grid(EW, EH, NORTH, 360.0 / EW)

    def elev_stats(cx, cy):
        """max and mean elevation across the hex footprint"""
        x0 = max(0, int((cx - HEXW / 2) * 2)); x1 = min(EW - 1, int((cx + HEXW / 2) * 2))
        y0 = max(0, int((cy - R) * 2)); y1 = min(EH - 1, int((cy + R) * 2))
        hi, tot, n = -11000, 0, 0
        for yy in range(y0, y1 + 1):
            rowv = grid[yy]
            for xx in range(x0, x1 + 1):
                v = rowv[xx]
                if v > hi:
                    hi = v
                tot += v
                n += 1
        return (hi, tot / n) if n else (0, 0)

    print(f'grid {COLS}x{ROWS} = {COLS*ROWS} hexes', file=sys.stderr)
    terrain = bytearray(COLS * ROWS)
    region = bytearray([255]) * (COLS * ROWS)
    counts = {}
    for row in range(ROWS):
        if row % 10 == 0:
            print(f'  row {row}/{ROWS}', file=sys.stderr)
        for col in range(COLS):
            i = row * COLS + col
            cx, cy = hex_center(col, row)
            if cy > H:
                terrain[i] = SEA
                continue
            found = None
            for r in land_ids:
                x0, y0, x1, y1 = bbox[r]
                if cx < x0 or cx > x1 or cy < y0 or cy > y1:
                    continue
                if in_rings(paths[r], cx, cy):
                    found = r
                    break
            if found is None:
                for r in sea_ids:
                    x0, y0, x1, y1 = bbox[r]
                    if cx < x0 or cx > x1 or cy < y0 or cy > y1:
                        continue
                    if in_rings(paths[r], cx, cy):
                        found = r
                        break
                terrain[i] = SEA
                if found:
                    region[i] = idx_of[found]
                continue

            region[i] = idx_of[found]
            hi, mean = elev_stats(cx, cy)
            # Mean matters more than max here: one peak inside a 250km hex does
            # not make the hex a mountain range, and max alone put the Brazilian
            # and African plateaus in the Alps' category.
            if found == 'greenland' or in_rings(phys['Tundra'], cx, cy):
                t = TUNDRA                      # Greenland is ice sheet, not rock
            elif in_rings(phys['Desert'], cx, cy):
                t = DESERT
            elif mean >= 1000 or hi >= 3000:
                t = MOUNTAIN
            elif mean >= 350 or hi >= 1500:
                t = HILLS
            else:
                t = PLAINS
            terrain[i] = t
            counts[t] = counts.get(t, 0) + 1

    names = {SEA: 'sea', PLAINS: 'plains', HILLS: 'hills', MOUNTAIN: 'mountain',
             DESERT: 'desert', TUNDRA: 'tundra'}
    land_total = sum(counts.values())
    print('\nland hexes:', land_total, file=sys.stderr)
    for t, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f'  {names[t]:9} {c:6}  {100*c/land_total:4.1f}%', file=sys.stderr)

    # capital hexes
    caps = {}
    for r, m in meta.items():
        if m['cap']:
            col = int(m['x'] / HEXW)
            row = min(ROWS - 1, int((m['y'] - R) / ROWH + 0.5))
            col = int(m['x'] / HEXW - 0.5 * (row & 1))
            caps[r] = (row % ROWS) * COLS + (col % COLS)

    out = {
        'cols': COLS, 'rows': ROWS, 'hexW': round(HEXW, 4), 'R': round(R, 4),
        'rowH': round(ROWH, 4), 'north': NORTH, 'deg': round(DEG, 4),
        'ids': ids,
        'terrainNames': [names[i] for i in range(6)],
        'terrain': base64.b64encode(bytes(terrain)).decode(),
        'region': base64.b64encode(bytes(region)).decode(),
        'caps': caps,
    }
    js = ('/* Generated by tools/build_hexes.py. Terrain from Mapzen terrarium\n'
          '   elevation + Natural Earth desert/tundra polygons. */\n'
          'window.WW2_HEX=' + json.dumps(out) + ';\n')
    open(os.path.join(HERE, 'hexes.js'), 'w', encoding='utf8').write(js)
    print('wrote hexes.js', round(len(js) / 1024), 'KB', file=sys.stderr)


if __name__ == '__main__':
    main()
