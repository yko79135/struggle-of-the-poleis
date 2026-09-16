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
