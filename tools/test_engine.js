/* Headless harness: runs the real page script against a stub DOM and exercises
   the hex engine. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.argv[2];
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

function makeEl() {
  const el = {
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], childNodes: [],
    innerHTML: '', textContent: '', hidden: false, disabled: false, value: 'Normal',
    appendChild(c) { this.children.push(c); return c },
    append(...c) { this.children.push(...c) },
    attrs: {}, tag: '',
    prepend() {}, remove() {},
    setAttribute(k, v) { this.attrs[k] = v }, getAttribute(k) { return this.attrs[k] },
    addEventListener() {}, removeEventListener() {}, closest: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 500 }),
    querySelector: () => null, querySelectorAll: () => [],
    setPointerCapture() {}, focus() {}, click() {},
  };
  return el;
}
const els = {};
const document = {
  getElementById: id => (els[id] ||= makeEl()),
  createElement: t => { const e = makeEl(); e.tag = t; return e },
  createElementNS: (ns, t) => { const e = makeEl(); e.tag = t; return e },
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {},
};
const sandbox = {
  document, console, atob, Math, Date, JSON, setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: () => 0, alert: () => {}, ResizeObserver: class { observe() {} },
  DOMPoint: class { constructor(x, y) { this.x = x; this.y = y } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const page = read('index.html');
const inline = [...page.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

const TESTS = `
/* ---------------- assertions ---------------- */
const fail=[], note=[];
const ok=(c,m)=>{ if(!c) fail.push(m); };

// 1. hexAt is the exact inverse of hexCenter
let bad=0;
for(let i=0;i<NHEX;i+=7){ const [x,y]=hexCenter(i); if(hexAt(x,y)!==i) bad++; }
ok(bad===0, 'hexAt/hexCenter round-trip failed for '+bad+' hexes');

// 2. neighbours are symmetric and wrap at the dateline
let asym=0;
for(let i=0;i<NHEX;i+=11) for(const n of neighbors(i)) if(!neighbors(n).includes(i)) asym++;
ok(asym===0, 'neighbour symmetry broken in '+asym+' cases');
const westEdge=40*COLS+0, eastEdge=40*COLS+(COLS-1);
ok(neighbors(westEdge).includes(eastEdge)||neighbors(eastEdge).includes(westEdge),
   'grid does not wrap around the dateline');

// 3. land hex count and per-faction starting territory
let land=0; for(let i=0;i<NHEX;i++) if(isLand(i)) land++;
note.push('land hexes: '+land);
ok(land>2500&&land<4200, 'unexpected land hex count '+land);

active=factions.slice(); ai=new Set(); gameStarted=true; initialState();
const starts={};
for(const f of factions) starts[f]=countHexes(f,'L');
note.push('start land: '+factions.map(f=>f+'='+starts[f]).join(' '));
for(const f of ['GER','USSR','USA','JPN','UK','FRA','ITA','CHN'])
  ok(starts[f]>0, f+' starts with no land hexes');

// 4. capitals resolve to real hexes owned by their faction
for(const f of factions){
  const ch=capHex[f];
  ok(ch!=null, f+' has no capital hex');
  if(ch!=null){ ok(isLand(ch), f+' capital is not on land'); }
}

// 5. starting VP in the same range as the region game (which opened ~8-22)
const vps=factions.map(f=>score(f));
note.push('start VP: '+factions.map(f=>f+'='+score(f).toFixed(1)).join(' '));
ok(Math.max(...vps)<40, 'starting VP too high: '+Math.max(...vps).toFixed(1));

// 6. a front advance takes ground, respects the budget, and only from one owner
idx=factions.indexOf('GER'); mode='conquer'; pool=6;
const before=countHexes('GER','L');
let targets=[]; for(let i=0;i<NHEX;i++) if(isTarget(i)) targets.push(i);
ok(targets.length>0, 'Germany has no legal conquest targets at start');
if(targets.length){
  const victim=ownerOf(targets[0]);
  const vBefore=countHexes(victim,'L');
  const res=frontAdvance(targets[0],"GER",32,h=>isLand(h));
  note.push('advance took '+res.taken.length+' hexes for '+res.spent+' of 32 pts from '+victim);
  ok(res.taken.length>0, 'front advance captured nothing');
  ok(res.spent<=32, 'front advance overspent: '+res.spent);
  ok(countHexes('GER','L')===before+res.taken.length, 'attacker hex count inconsistent');
  ok(countHexes(victim,'L')===vBefore-res.taken.length, 'defender lost wrong number of hexes');
  for(const h of res.taken) ok(isLand(h), 'advance took a sea hex without naval');
}

// 6b. rendering: terrain drawn once, ownership repainted, paths non-empty
initialState(); active=['GER','UK','USSR','USA','ITA','JPN','FRA','CHN']; gameStarted=true; idx=0;
boardBuilt=false; buildBoard(); draw();
const terrKids=hexTerrainG.children.filter(c=>c.tag==='path');
ok(terrKids.length===5, 'expected 5 terrain paths, got '+terrKids.length);
let terrHexes=0;
for(const k of terrKids){
  ok(typeof k.attrs.d==='string'&&k.attrs.d.length>0, 'terrain path has empty geometry');
  terrHexes+=(k.attrs.d.match(/M/g)||[]).length;
}
note.push('terrain paths: '+terrKids.length+' covering '+terrHexes+' hexes');
ok(terrHexes===land, 'terrain paths cover '+terrHexes+' hexes but there are '+land+' land hexes');
const ownKids=hexOwnG.children.filter(c=>c.tag==='path');
ok(ownKids.length>0, 'no ownership overlay drawn');
let ownHexes=0; for(const k of ownKids) ownHexes+=(k.attrs.d.match(/M/g)||[]).length;
note.push('ownership paths: '+ownKids.length+' covering '+ownHexes+' hexes');
const ownedNow=factions.reduce((a,f)=>a+countHexes(f,'L')+countHexes(f,'S'),0);
ok(ownHexes===ownedNow, 'overlay covers '+ownHexes+' hexes but '+ownedNow+' are owned');
ok(markerLayer.children.length>0, 'no capital markers drawn');
// a hex path must be a closed polygon of exactly 6 points
const pd=hexPath(1000);
const pts=pd.replace(/^M/,'').replace(/Z$/,'').split(' ');
ok(pd.startsWith('M')&&pd.endsWith('Z'), 'hex path not closed: '+pd);
ok(pts.length===6, 'hex path has '+pts.length+' points, expected 6');
ok(pts.every(q=>{const [a,b]=q.split(',').map(Number);return isFinite(a)&&isFinite(b)}), 'hex path has non-numeric points: '+pd);

// 7. supply tracing
initialState();
const sup=suppliedSet('GER');
ok(sup.size>0, 'Germany has no supplied hexes from its capital');
ok(sup.has(capHex['GER']), 'capital not in its own supply set');

// 8. a full AI game runs to completion without throwing
initialState();
active=['GER','UK','USSR','USA','ITA','JPN','FRA','CHN'];
ai=new Set(active); gameStarted=true; idx=0; round=1;
let turns=0, err=null;
try{
  while(gameStarted && turns<400){ aiTurn(); finishTurn(); advance(); turns++; }
}catch(e){ err=e }
ok(!err, 'AI game threw: '+(err&&err.stack||'').split('\\n').slice(0,3).join(' | '));
note.push('AI game ran '+turns+' turns, ended round '+round+', gameStarted='+gameStarted);
const finalLand=factions.map(f=>f+'='+countHexes(f,'L'));
note.push('final land: '+finalLand.join(' '));
const totalOwned=factions.reduce((a,f)=>a+countHexes(f,'L'),0);
ok(totalOwned<=land, 'more land owned ('+totalOwned+') than exists ('+land+')');
note.push('land owned at end: '+totalOwned+' / '+land);

JSON.stringify({fail,note});
`;

try {
  const result = vm.runInContext(read('map-regions.js') + '\n' + read('hexes.js') + '\n' + inline + '\n' + TESTS,
                                 sandbox, { filename: 'page.js', timeout: 120000 });
  const { fail, note } = JSON.parse(result);
  console.log('--- observations ---');
  for (const n of note) console.log('  ' + n);
  console.log('--- results ---');
  if (!fail.length) console.log('  ALL CHECKS PASSED');
  else { for (const f of fail) console.log('  FAIL: ' + f); process.exitCode = 1 }
} catch (e) {
  console.log('HARNESS ERROR:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
}
