"""Fetch global elevation (Mapzen/AWS terrarium tiles) and resample it onto the
board's equirectangular canvas.

Terrarium encodes height as (R*256 + G + B/256) - 32768 metres.
Tiles are Web Mercator, so each output row maps back through the inverse
Mercator to find its source row.
"""
import math, os, io, sys, urllib.request, concurrent.futures
from PIL import Image

Z = 4                      # 16x16 tiles -> 4096x4096 px, ~9.8 km/px at equator
N = 1 << Z
TILE = 256
SRC = N * TILE
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tiles')
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def fetch(xy):
    x, y = xy
    path = os.path.join(CACHE, f'{Z}_{x}_{y}.png')
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(URL.format(z=Z, x=x, y=y),
                                 headers={'User-Agent': 'ww2-map-build/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            return path
        except Exception as e:
            if attempt == 2:
                print('  FAILED', x, y, e, file=sys.stderr)
                return None
    return None


def build_mercator():
    """Stitch all tiles into one Mercator-space elevation array (row-major)."""
    os.makedirs(CACHE, exist_ok=True)
    coords = [(x, y) for x in range(N) for y in range(N)]
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        for _ in ex.map(fetch, coords):
            done += 1
            if done % 64 == 0:
                print(f'  tiles {done}/{len(coords)}', file=sys.stderr)
    canvas = Image.new('RGB', (SRC, SRC))
    for x, y in coords:
        p = os.path.join(CACHE, f'{Z}_{x}_{y}.png')
        if not os.path.exists(p):
            continue
        canvas.paste(Image.open(p).convert('RGB'), (x * TILE, y * TILE))
    return canvas


def mercator_row_for_lat(lat):
    """Inverse Web Mercator: latitude -> pixel row in the stitched image."""
    lat = max(-85.05112878, min(85.05112878, lat))
    s = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    return min(SRC - 1, max(0, int(y * SRC)))


def sample_grid(width, height, north, deg_per_px):
    """Resample to the board canvas: equirectangular, `north` at row 0."""
    img = build_mercator()
    px = img.load()
    grid = [[0] * width for _ in range(height)]
    for row in range(height):
        lat = north - (row + 0.5) * deg_per_px
        sy = mercator_row_for_lat(lat)
        out = grid[row]
        for col in range(width):
            lon = -180 + (col + 0.5) * deg_per_px
            sx = min(SRC - 1, int((lon + 180) / 360 * SRC))
            r, g, b = px[sx, sy]
            out[col] = (r * 256 + g + b / 256) - 32768
    return grid


if __name__ == '__main__':
    # Spot-check against known heights before trusting the data.
    img = build_mercator()
    px = img.load()

    def at(lat, lon):
        sy = mercator_row_for_lat(lat)
        sx = min(SRC - 1, int((lon + 180) / 360 * SRC))
        r, g, b = px[sx, sy]
        return round((r * 256 + g + b / 256) - 32768)

    for name, lat, lon, expect in [
        ('Everest', 27.99, 86.93, '~8800 (coarse tile: lower)'),
        ('Alps (Mont Blanc)', 45.83, 6.86, '~2000-4800'),
        ('Sahara (Algeria)', 25.0, 2.0, '~200-500'),
        ('Netherlands', 52.2, 5.3, '~0-30'),
        ('Mid-Atlantic ocean', 30.0, -40.0, 'negative'),
        ('Caspian Sea', 41.5, 50.5, 'negative (-28)'),
        ('Tibet plateau', 32.0, 88.0, '~4500-5200'),
        ('Amazon basin', -3.0, -60.0, '~0-150'),
    ]:
        print(f'{name:22} {at(lat, lon):7} m   expect {expect}')
