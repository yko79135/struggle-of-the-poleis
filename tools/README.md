# Map geometry generator

`build-map.js` generates `public/ww2/map-regions.js` — the board's land/sea
geometry — from Natural Earth data, so the coastlines match the real globe
instead of being drawn by hand.

## Running it

```sh
npm install topojson-client polygon-clipping
curl -o countries-50m.json https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json
node build-map.js            # writes map-regions.js next to the script
AUDIT=1 node build-map.js    # also reports land no region covers
```

Copy the result to `public/ww2/map-regions.js`. The anchors it writes to
`anchors.json` are the label / capital-marker coordinates in the `H` table in
`public/ww2/index.html`; regenerating geometry means updating those too.

## How it works

- **Projection.** Equirectangular, longitude −180..180 across the 1077px width,
  same pixels-per-degree vertically, so latitude 83.5°N..64.2°S fills 442px.
  Antarctica is below the frame, which is why the board is 2.44:1 and not 2:1.
- **Land regions** are built from named countries, optionally clipped to
  lat/lon boxes for sub-national splits (the Soviet, US and Chinese regions).
  Boxes of neighbouring regions must share an edge exactly; a gap leaves land
  that belongs to no region, which is what `AUDIT=1` looks for. The only patch
  it still reports is Hawaii, which the game has no region for.
- **Sea zones** are a Voronoi partition around one seed per zone, capped to a
  bounding box and with land subtracted, so the ocean is tiled with no overlaps.
- **Anchors** are a pole-of-inaccessibility search, not centroids: a centroid
  falls in the sea for concave regions like Norway.
- Rings crossing the 180th meridian are unwrapped and re-cut, or they draw as a
  stripe across the whole map.

# Hex board generator

`build_hexes.py` turns the region geometry into the playing grid and writes
`public/ww2/hexes.js` (~32KB: terrain and region membership, base64-packed).

```sh
python -m pip install Pillow
python build_hexes.py        # needs map-regions.js and index.html beside it
```

It caches ~25MB of elevation tiles in `tools/tiles/` on first run.

## The grid

156 columns x 74 rows of pointy-top hexes, ~2.31 degrees (~250 km) across,
about 11,500 hexes of which ~3,300 are land. The column count is even so the
grid wraps cleanly at the dateline — Alaska borders Kamchatka. Hit-testing at
runtime is arithmetic (`hexAt`), not DOM: 11,500 elements would not be usable.

## Terrain

- **Elevation** from Mapzen/AWS terrarium tiles (`elevation.py`), decoded as
  `(R*256 + G + B/256) - 32768` metres and resampled from Web Mercator onto the
  board's equirectangular canvas. Mean elevation drives the classification, not
  maximum: one peak inside a 250km hex does not make it a mountain range, and
  using the max put the Brazilian and African plateaus in the Alps' category.
- **Deserts and tundra** from Natural Earth's named physical regions.
- Greenland is forced to tundra: it reads as high ground, but it is ice.
- There is **no forest class**. No global land-cover source was reachable, and
  deriving forest from latitude would have been guesswork dressed up as data.

## Balance notes, learned the hard way

Both of these came out of `tools/test_engine.js`, which runs the real page
script against a stub DOM and plays a full AI game.

- **Area is not value.** Scoring hexes by count gave the USSR 27 VP against
  Germany's 0.6 at setup, because Siberia is enormous and the Ruhr is not.
  Territory is now scored by terrain worth and compressed by `value^0.35`,
  which restores roughly the spread the region game had.
- **A die roll has to move a front.** Unscaled, a d6 advanced about three hexes
  and a whole 12-round game barely shifted a border, so rolls are multiplied by
  `ADVANCE_SCALE`. A related bug made this worse: the flood charged each hex the
  *cumulative* path cost rather than its own, so advances died after three hexes.
