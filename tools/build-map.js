/* Build accurate WW2 board geometry from Natural Earth (world-atlas 50m).
   Emits public/ww2/map-regions.js: region hit paths + base land path, all in
   the existing 1077x442 equirectangular canvas. */
const fs = require('fs');
const topojson = require('topojson-client');
const pc = require('polygon-clipping');

const W = 1077, H = 442, NORTH = 83.5;
const K = W / 360;                    // px per degree, identical in x and y
const px = lon => (lon + 180) * K;
const py = lat => (NORTH - lat) * K;

const topo = JSON.parse(fs.readFileSync(__dirname + '/countries-50m.json', 'utf8'));
const fc = topojson.feature(topo, topo.objects.countries);
const byName = {};
for (const f of fc.features) byName[f.properties.name] = f;

const missing = new Set();
const mpOf = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const bx = (l, s, r, n) => [[[[l, s], [r, s], [r, n], [l, n], [l, s]]]];

/* Rings that straddle the 180th meridian (Aleutians, Chukotka, Fiji, NZ) jump
   from +179 to -179 and would otherwise be drawn as a stripe across the whole
   map. Unwrap each ring to be continuous, then cut it back into the -180..180
   frame so each side lands at its own edge. */
function antimeridianFix(mp) {
  const crosses = mp.some(poly => poly.some(r => {
    for (let i = 1; i < r.length; i++) if (Math.abs(r[i][0] - r[i - 1][0]) > 180) return true;
    return false;
  }));
  if (!crosses) return mp;
  const unwrapped = mp.map(poly => poly.map(ring => {
    const out = [ring[0].slice()];
    for (let i = 1; i < ring.length; i++) {
      let lon = ring[i][0];
      const prev = out[i - 1][0];
      while (lon - prev > 180) lon -= 360;
      while (prev - lon > 180) lon += 360;
      out.push([lon, ring[i][1]]);
    }
    return out;
  }));
  const shift = (m, d) => m.map(p => p.map(r => r.map(([x, y]) => [x + d, y])));
  const cut = (lo, hi, d) => {
    try { const r = pc.intersection(unwrapped, bx(lo, -90, hi, 90)); return r && r.length ? shift(r, d) : []; }
    catch (e) { return []; }
  };
  return [...cut(-180, 180, 0), ...cut(180, 900, -360), ...cut(-900, -180, 360)];
}

function country(name) {
  const f = byName[name];
  if (!f) { missing.add(name); return []; }
  return antimeridianFix(mpOf(f.geometry));
}
// spec: array of [ [countries...], clipBox? ]
function build(spec) {
  const parts = [];
  for (const [names, clip] of spec) {
    for (const n of names) {
      let mp = country(n);
      if (!mp.length) continue;
      if (clip) { try { mp = pc.intersection(mp, bx(...clip)); } catch (e) { continue; } }
      if (mp && mp.length) parts.push(mp);
    }
  }
  if (!parts.length) return [];
  try { return parts.length === 1 ? parts[0] : pc.union(...parts); }
  catch (e) { return parts.flat(); }
}

/* ---------------- land regions ---------------- */
const LAND = {
  alaska:    [[['United States of America'], [-180, 51, -129, 72]], [['United States of America'], [172, 51, 180, 56]]],
  canada_w:  [[['Canada'], [-141, 41, -95, 84]]],
  canada:    [[['Canada'], [-95, 41, -52, 84]], [['St. Pierre and Miquelon']]],
  usa_west:  [[['United States of America'], [-125, 31, -104, 49.5]]],
  usa:       [[['United States of America'], [-104, 36, -66, 49.5]]],
  usa_south: [[['United States of America'], [-107, 24, -75, 36]]],
  mexico:    [[['Mexico']]],
  camerica:  [[['Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama']]],
  caribbean: [[['Cuba', 'Haiti', 'Dominican Rep.', 'Jamaica', 'Puerto Rico', 'Bahamas', 'Trinidad and Tobago']]],
  venezuela: [[['Venezuela', 'Colombia', 'Ecuador', 'Guyana', 'Suriname']], [['France'], [-55, 1, -51, 7]]],
  brazil:    [[['Brazil']]],
  peru:      [[['Peru', 'Bolivia', 'Paraguay']]],
  argentina: [[['Argentina', 'Chile', 'Uruguay']]],
  greenland: [[['Greenland']]],
  iceland:   [[['Iceland']]],
  britain:   [[['United Kingdom'], [-6.5, 49, 2, 55.6]]],
  scotland:  [[['United Kingdom'], [-8.5, 55.6, 0, 61]]],
  ireland:   [[['Ireland']], [['United Kingdom'], [-8.5, 54, -5, 55.6]]],
  norway:    [[['Norway'], [3, 57, 35, 81]]],
  sweden:    [[['Sweden']]],
  finland:   [[['Finland']], [['Åland']]],
  leningrad: [[['Russia'], [26, 57.5, 33, 63]]],
  northrussia: [[['Russia'], [28, 63, 68, 82]]],
  baltstates: [[['Estonia', 'Latvia', 'Lithuania']]],
  denmark:   [[['Denmark'], [7, 54, 13, 58]]],
  low:       [[['Netherlands'], [3, 50, 8, 54]], [['Belgium', 'Luxembourg']]],
  normandy:  [[['France'], [-5.2, 47.4, 1.5, 51.2]]],
  paris:     [[['France'], [1.5, 46.5, 8.3, 51.2]]],
  bordeaux:  [[['France'], [-2.2, 42.5, 1.5, 47.4]]],
  frsouth:   [[['France'], [1.5, 41, 10, 46.5]]],
  swiss:     [[['Switzerland', 'Liechtenstein']]],
  spain:     [[['Spain'], [-10, 35, 4.5, 44]], [['Portugal'], [-10, 36, -6, 42.2]], [['Andorra']]],
  ruhr:      [[['Germany'], [5.8, 47, 9.5, 54.5]]],
  berlin:    [[['Germany'], [9.5, 50.5, 15.1, 55]]],
  eastprussia: [[['Russia'], [19, 54, 23.5, 55.5]], [['Poland'], [18.5, 53.3, 23.5, 55]]],
  bavaria:   [[['Germany'], [9.5, 47, 14, 50.5]]],
  austria:   [[['Austria', 'Czechia', 'Slovakia']]],
  italy_n:   [[['Italy'], [6, 43.5, 14, 47.2]]],
  rome:      [[['Italy'], [8, 40.5, 17, 43.5]]],
  sicily:    [[['Italy'], [8, 35, 19, 40.5]], [['Malta']]],
  hungary:   [[['Hungary']]],
  yugo:      [[['Serbia', 'Croatia', 'Bosnia and Herz.', 'Slovenia', 'Montenegro', 'Macedonia', 'Kosovo', 'Albania']]],
  poland_w:  [[['Poland'], [13, 48, 18.5, 55]]],
  poland_e:  [[['Poland'], [18.5, 48, 25, 53.3]]],
  romania:   [[['Romania', 'Moldova']]],
  bulgaria:  [[['Bulgaria']]],
  greece:    [[['Greece']]],
  belarus:   [[['Belarus']]],
  kiev:      [[['Ukraine'], [21, 43, 33, 53]]],
  ukraine:   [[['Ukraine'], [33, 43, 41, 53]], [['Russia'], [32, 44, 37, 46.5]]],
  caucasus:  [[['Georgia', 'Armenia', 'Azerbaijan']], [['Russia'], [37, 41, 50, 46]]],
  moscow:    [[['Russia'], [26, 53, 48, 57.5]], [['Russia'], [33, 57.5, 48, 63]]],
  stalingrad: [[['Russia'], [26, 46, 52, 53]]],
  urals:     [[['Russia'], [48, 53, 68, 63]], [['Russia'], [52, 46, 68, 53]]],
  kazakh:    [[['Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan']]],
  siberia:   [[['Russia'], [68, 42, 110, 82]]],
  esiberia:  [[['Russia'], [110, 42, 155, 82]]],
  kamchatka: [[['Russia'], [155, 42, 180, 82]], [['Russia'], [-180, 60, -168, 82]]],
  mongolia:  [[['Mongolia']]],
  manchuria: [[['China'], [118, 38.5, 136, 54]]],
  korea:     [[['North Korea', 'South Korea']]],
  japan:     [[['Japan']], [['Taiwan']]],
  china_w:   [[['China'], [73, 21, 100, 50]]],
  china_n:   [[['China'], [100, 33, 118, 54]], [['China'], [118, 33, 125, 38.5]]],
  chongqing: [[['China'], [100, 17, 112, 33]]],
  china_e:   [[['China'], [112, 17, 123, 33]]],
  turkey:    [[['Turkey', 'Cyprus', 'N. Cyprus']]],
  iraq:      [[['Iraq', 'Iran', 'Kuwait']]],
  saudi:     [[['Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates', 'Qatar', 'Bahrain']]],
  levant:    [[['Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan']]],
  india:     [[['India', 'Pakistan', 'Bangladesh', 'Nepal', 'Bhutan', 'Sri Lanka', 'Afghanistan']]],
  burma:     [[['Myanmar']]],
  indochina: [[['Vietnam', 'Laos', 'Cambodia', 'Thailand']]],
  malaya:    [[['Malaysia', 'Singapore', 'Brunei']]],
  dei:       [[['Indonesia', 'Timor-Leste']]],
  philippines: [[['Philippines']]],
  newguinea: [[['Papua New Guinea', 'Solomon Is.']]],
  australia: [[['Australia']]],
  nz:        [[['New Zealand']]],
  egypt:     [[['Egypt', 'Sudan']]],
  morocco:   [[['Morocco', 'W. Sahara']]],
  algeria:   [[['Algeria', 'Tunisia']]],
  libya:     [[['Libya']]],
  wafrica:   [[['Mauritania', 'Mali', 'Niger', 'Senegal', 'Gambia', 'Guinea-Bissau', 'Guinea', 'Sierra Leone', 'Liberia', "Côte d'Ivoire", 'Ghana', 'Burkina Faso', 'Togo', 'Benin', 'Nigeria']]],
  cafrica:   [[['Chad', 'Central African Rep.', 'Cameroon', 'Eq. Guinea', 'Gabon', 'Congo', 'Dem. Rep. Congo', 'Angola']]],
  eafrica:   [[['Ethiopia', 'Eritrea', 'Djibouti', 'Somalia', 'Somaliland', 'Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Burundi', 'S. Sudan']]],
  safrica:   [[['Zambia', 'Zimbabwe', 'Malawi', 'Mozambique', 'Botswana', 'Namibia']]],
  southafrica: [[['South Africa', 'Lesotho', 'eSwatini']]],
  madagascar: [[['Madagascar', 'Comoros', 'Mauritius']]],
};

/* ---------------- sea zones ----------------
   One seed per zone; the ocean is partitioned into Voronoi cells around them,
   then land is subtracted. This tiles the whole ocean with no gaps and no
   overlaps, which plain boxes could not do. */
const SEA_SEEDS = {
  npac_e: [-145, 38], westpac: [150, 20], spac_e: [-110, -25], pacific_s: [170, -25],
  coral: [157, -17], javasea: [113, -5], southchina: [113, 12], eastchina: [125, 28],
  yellowsea: [122, 36], japansea: [135, 41], okhotsk: [150, 53], caribsea: [-73, 15],
  atl_w: [-63, 33], atl_n: [-25, 55], atl_mid: [-37, 22], atl_e: [-16, 35],
  atl_s: [-15, -25], arctic: [80, 78], arctic_w: [-95, 76], hudson: [-85, 58],
  northsea: [3, 56], baltic: [19, 58], channel: [-1.5, 50], bay: [-6, 46],
  westmed: [4, 39], centralmed: [15, 36], eastmed: [28, 34], blacksea: [34, 43],
  redsea: [38, 20], arabian: [63, 14], indian: [75, -12], southind: [70, -38],
};
/* A Voronoi cell alone sprawls: with only 32 seeds, the Black Sea cell reached
   the Arctic. Each zone is also capped to a plausible bounding box. */
const SEA_BOX = {
  npac_e: [-180, 12, -118, 62], westpac: [127, -4, 180, 45], spac_e: [-150, -64, -68, 8],
  pacific_s: [140, -64, 180, 8], coral: [140, -32, 175, -4], javasea: [100, -14, 128, 2],
  southchina: [102, -2, 125, 25], eastchina: [117, 21, 135, 34], yellowsea: [114, 30, 128, 42],
  japansea: [126, 32, 148, 52], okhotsk: [134, 42, 165, 63], caribsea: [-92, 5, -55, 28],
  atl_w: [-82, 18, -40, 50], atl_n: [-60, 42, 2, 70], atl_mid: [-60, 2, -14, 42],
  atl_e: [-30, 14, -2, 50], atl_s: [-50, -64, 22, 6], arctic: [10, 66, 180, 84],
  arctic_w: [-180, 62, -35, 84], hudson: [-100, 48, -65, 70], northsea: [-6, 49, 12, 62],
  baltic: [9, 52, 32, 66], channel: [-8, 47, 5, 53], bay: [-14, 41, 2, 50],
  westmed: [-8, 33, 13, 45], centralmed: [8, 29, 23, 45], eastmed: [19, 28, 38, 40],
  blacksea: [26, 39, 43, 49], redsea: [30, 8, 46, 31], arabian: [48, -2, 78, 28],
  indian: [48, -30, 108, 8], southind: [20, -64, 115, -20],
};
// Clip a convex polygon to the half-plane of points nearer to a than to b.
function halfPlane(poly, a, b) {
  const nx = 2 * (b[0] - a[0]), ny = 2 * (b[1] - a[1]);
  const c = b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1];
  const inside = p => nx * p[0] + ny * p[1] <= c;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const pi = inside(p), qi = inside(q);
    if (pi) out.push(p);
    if (pi !== qi) {
      const dp = nx * p[0] + ny * p[1], dq = nx * q[0] + ny * q[1];
      const t = (c - dp) / (dq - dp);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/* ---------------- geometry helpers ---------------- */
function simplify(ring, tol) {                // Douglas-Peucker
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = -1, mi = -1;
    const [ax, ay] = ring[a], [bx2, by2] = ring[b];
    const dx = bx2 - ax, dy = by2 - ay, dd = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = ring[i];
      let t = dd ? ((x - ax) * dx + (y - ay) * dy) / dd : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx, qy = ay + t * dy;
      const d = (x - qx) ** 2 + (y - qy) ** 2;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol * tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const area = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return Math.abs(s / 2); };
const n1 = v => { const r = Math.round(v * 10) / 10; return (Number.isInteger(r) ? r : r.toFixed(1)); };

function toPath(mp, tol = 0.3, minArea = 0.8) {
  const out = [];
  for (const poly of mp) {
    for (let ri = 0; ri < poly.length; ri++) {
      let ring = poly[ri].map(([lon, lat]) => [px(lon), py(lat)]);
      ring = simplify(ring, tol);
      if (ring.length < 4 || area(ring) < minArea) continue;
      out.push('M' + ring.map(p => n1(p[0]) + ',' + n1(p[1])).join(' ') + 'Z');
    }
  }
  return out.join('');
}
/* Anchors must lie INSIDE the region: a plain centroid falls in the sea for
   concave shapes like Norway or Argentina+Chile. This is a pole-of-inaccessibility
   search (grid, then refine) on the region's largest projected polygon. */
const projPoly = poly => poly.map(ring => ring.map(([lon, lat]) => [px(lon), py(lat)]));
function pointIn(poly, x, y) {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function edgeDist(poly, x, y) {
  let best = Infinity;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const dx = xj - xi, dy = yj - yi, dd = dx * dx + dy * dy;
      let t = dd ? ((x - xi) * dx + (y - yi) * dy) / dd : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (x - xi - t * dx) ** 2 + (y - yi - t * dy) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
function anchorOf(mp) {
  let best = null, ba = -1;
  for (const poly of mp) { const a = area(poly[0]); if (a > ba) { ba = a; best = poly; } }
  if (!best) return null;
  const poly = projPoly(best);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of poly[0]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  const score = (x, y) => (pointIn(poly, x, y) ? 1 : -1) * edgeDist(poly, x, y);
  let bx0 = (minx + maxx) / 2, by0 = (miny + maxy) / 2, bs = score(bx0, by0);
  let step = Math.max(maxx - minx, maxy - miny) / 36;
  for (let x = minx + step / 2; x < maxx; x += step)
    for (let y = miny + step / 2; y < maxy; y += step) {
      const s = score(x, y);
      if (s > bs) { bs = s; bx0 = x; by0 = y; }
    }
  for (let pass = 0; pass < 3; pass++) {           // refine around the winner
    step /= 3;
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++) {
        const x = bx0 + dx * step, y = by0 + dy * step, s = score(x, y);
        if (s > bs) { bs = s; bx0 = x; by0 = y; }
      }
  }
  return [Math.round(bx0 * 10) / 10, Math.round(by0 * 10) / 10, bs > 0];
}

/* ---------------- run ---------------- */
const paths = {}, labels = {}, empty = [], outside = [];
const landMPs = [];
for (const [id, spec] of Object.entries(LAND)) {
  const mp = build(spec);
  if (!mp.length) { empty.push(id); continue; }
  landMPs.push(mp);
  paths[id] = toPath(mp, 0.4, 1.0);
  const a = anchorOf(mp);
  if (a && !a[2]) outside.push(id);
  labels[id] = a ? [a[0], a[1]] : null;
}
if (outside.length) console.error('WARNING anchor outside region:', outside.join(','));
console.error('land regions built:', Object.keys(paths).length, 'empty:', empty.join(',') || 'none');
if (missing.size) console.error('MISSING COUNTRY NAMES:', [...missing].join(', '));

// land union for the base silhouette / coastline, and for carving sea zones
let allLand = [];
for (const mp of landMPs) { try { allLand = allLand.length ? pc.union(allLand, mp) : mp; } catch (e) { } }
console.error('land union rings:', allLand.length);

const seaIds = Object.keys(SEA_SEEDS);
const seeds = seaIds.map(id => [px(SEA_SEEDS[id][0]), py(SEA_SEEDS[id][1])]);
const frame = [[0, 0], [W, 0], [W, H], [0, H]];
const unproj = ([x, y]) => [x / K - 180, NORTH - y / K];
for (let i = 0; i < seaIds.length; i++) {
  const id = seaIds[i];
  let cell = frame;
  for (let j = 0; j < seeds.length && cell.length; j++) if (j !== i) cell = halfPlane(cell, seeds[i], seeds[j]);
  if (cell.length < 3) { empty.push(id); continue; }
  const ring = cell.map(unproj); ring.push(ring[0]);
  let mp = [[ring]];
  try { mp = pc.intersection(mp, bx(...SEA_BOX[id])); } catch (e) { }
  if (!mp || !mp.length) { empty.push(id); continue; }
  try { mp = pc.difference(mp, allLand); } catch (e) { }
  if (!mp || !mp.length) { empty.push(id); continue; }
  paths[id] = toPath(mp, 0.5, 3);
  const a = anchorOf(mp);                     // keeps the label in open water
  labels[id] = a ? [a[0], a[1]] : [Math.round(seeds[i][0] * 10) / 10, Math.round(seeds[i][1] * 10) / 10];
}
console.error('total regions:', Object.keys(paths).length);

/* Audit: any land inside a country we actually use that no region covers is a
   hole in the board (a gap between two clip boxes). Report the big ones. */
if (process.env.AUDIT) {
  const used = new Set();
  for (const spec of Object.values(LAND)) for (const [names] of spec) for (const n of names) used.add(n);
  let trueLand = [];
  for (const n of used) { const mp = country(n); if (mp.length) { try { trueLand = trueLand.length ? pc.union(trueLand, mp) : mp; } catch (e) { } } }
  let gaps = [];
  try { gaps = pc.difference(trueLand, allLand); } catch (e) { }
  const scored = gaps.map(poly => {
    const r = poly[0];
    let x = 0, y = 0;
    for (const [lon, lat] of r) { x += lon; y += lat; }
    return { a: area(r), lon: (x / r.length).toFixed(1), lat: (y / r.length).toFixed(1) };
  }).filter(g => g.a > 0.5).sort((p, q) => q.a - p.a).slice(0, 20);
  console.error('UNCOVERED LAND PATCHES (deg^2, centre lon/lat):');
  for (const g of scored) console.error('   ', g.a.toFixed(2), g.lon, g.lat);
}

const basePath = toPath(allLand, 0.3, 0.8);
const out =
  '/* Generated from Natural Earth 50m (world-atlas) by build.js.\n' +
  '   Equirectangular, lon -180..180 -> x 0..' + W + ', lat ' + NORTH + '..' + (NORTH - H / K).toFixed(2) + ' -> y 0..' + H + '.\n' +
  '   Same px-per-degree in x and y, so coastlines are true to the real globe. */\n' +
  'window.WW2_REGION_PATHS=' + JSON.stringify(paths) + ';\n' +
  'window.WW2_LAND_PATH=' + JSON.stringify(basePath) + ';\n' +
  'window.WW2_REGION_ANCHORS=' + JSON.stringify(labels) + ';\n';
fs.writeFileSync(__dirname + '/anchors.json', JSON.stringify(labels));
fs.writeFileSync(__dirname + '/map-regions.js', out);
console.error('wrote map-regions.js', (out.length / 1024).toFixed(0) + 'KB');
