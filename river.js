// The view out of the window, Han River version: the room is on the 15th floor of a riverside block on the north
// bank, looking south. Below: the block's grounds, the Gangbyeon expressway, Hangang Park; then a kilometre of river
// with an arch bridge on the left and a cable-stayed one on the right; across it the Gangnam skyline, Lotte World
// Tower far off to the east, and the ridges behind.
// Two groups in the room's scene, one render pass like everything else: `near` (true scale out to the far bank)
// and `far` (skyline, ridges), which is shrunk 10x about the eye and drawn last on the far plane, so the GPU only
// shades it where the window shows sky. The caller hides both while the window is out of view.
// Everything is unlit: shading is in vertex colours and canvas textures, update() tints it for the time of day,
// and a real-time light would also land on the room, whose light is baked.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const G = -42;          // ground level (the room's floor is at 0: 14 floors up)
const W = -47;          // the river's surface
const SHORE_N = -160, SHORE_S = -1160;   // water from here to there
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildRiver(scene, { phone = false, seed = 21 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const near = new THREE.Group(); near.name = 'river-near'; scene.add(near);
  scene.fog = new THREE.Fog('#b9c6d3', 200, 2600);   // starts far beyond the room
  const dayMats = [], litMats = [], glow = [];
  const tex = (w, h, draw, repeat) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const basic = (o, list = dayMats) => { const m = new THREE.MeshBasicMaterial(o); m.userData.base = m.color.clone(); list.push(m); return m; };
  const additive = (o, list = litMats) => basic({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, ...o }, list);
  // faces lit from the sky: tops brightest, the sides facing the river (and us) next
  const shade = (g, col) => {
    g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals();
    const n = g.attributes.normal, c = new Float32Array(n.count * 3), base = new THREE.Color(col);
    for (let i = 0; i < n.count; i++) {
      const k = .6 + .4 * Math.max(0, n.getY(i)) + .18 * Math.max(0, n.getZ(i)) + .1 * Math.max(0, n.getX(i));
      c[i * 3] = base.r * k; c[i * 3 + 1] = base.g * k; c[i * 3 + 2] = base.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
  };
  const box = (w, h, d, x, y, z, col, ry = 0, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); return shade(g, col); };
  const cyl = (rt, rb, h, x, y, z, col, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return shade(g, col); };
  const plane = (w, d, x, y, z, map, list) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), map.isMaterial ? map : basic({ map }, list));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m;
  };
  const solids = [];   // vertex-coloured near things, merged into one mesh at the end
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

  /* ================= near: the block, the expressway, the park ================= */
  // neighbouring towers of our own complex, left and right along the bank
  const aptTex = tex(256, 512, (g, w, h) => {
    g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 17) {
      g.fillStyle = '#d2cdc3'; g.fillRect(0, y, w, 2);                                          // slab edge
      for (let x = 0; x < w; x += 64) {
        g.fillStyle = '#7c8996'; g.fillRect(x + 6, y + 4, 40, 10);                                // balcony glass
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 6, y + 4, 40, 2);
        g.fillStyle = '#c9c4ba'; g.fillRect(x + 6, y + 12, 40, 2);                                // balcony rail
        g.fillStyle = '#9aa3ab'; g.fillRect(x + 50, y + 5, 8, 8);                                 // small window
      }
    }
    g.fillStyle = 'rgba(0,0,0,.05)'; for (let x = 0; x < w; x += 64) g.fillRect(x + 46, 0, 4, h);  // walls between flats
  }, true);
  const aptLit = k => tex(256, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 17) for (let x = 0; x < w; x += 64) if (rnd() < k) {
      g.fillStyle = pick(['#ffd08a', '#ffe6b8', '#fff3dc', '#d6e4ff']); g.fillRect(x + 6, y + 4, 40, 10);
    }
  }, true);
  const aptLitTex = aptLit(.45);
  // texture tiles: aptTex is 4 flats (20 m) by 30 floors (90 m), officeTex 8 bays (28 m) by 32 floors (128 m)
  const tiled = (g, w, h, d, tw, th) => {   // box UVs scaled so the tile keeps its size on every face
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let k = 0; k < uv.count; k++) {
      const sx = Math.abs(n.getX(k)) > .5 ? d : w, sy = Math.abs(n.getY(k)) > .5 ? d : h;
      uv.setXY(k, uv.getX(k) * sx / tw, uv.getY(k) * sy / th);
    }
    return g;
  };
  for (const [x0, x1] of [[-118, -62], [62, 118]]) {   // the block's other towers, beside ours along the bank
    const w = x1 - x0, h = 92, d = 16, cx = (x0 + x1) / 2, cz = -3.2 + d / 2;
    const geo = tiled(new THREE.BoxGeometry(w, h, d), w, h, d, 20, 90); geo.translate(cx, G + h / 2, cz);
    near.add(new THREE.Mesh(geo, basic({ map: aptTex })));
    const lit = tiled(new THREE.BoxGeometry(w + .1, h, d + .1), w, h, d, 20, 90); lit.translate(cx, G + h / 2, cz);
    near.add(new THREE.Mesh(lit, additive({ map: aptLitTex })));
  }
  // Fine detail over the big ground textures, so close up they aren't a smooth smear: a small grey tile repeating every
  // few metres, multiplied in through the light-map slot (MeshBasic: diffuse x lightMap x intensity / PI).
  const detail = (n, draw) => { const t = tex(n, n, draw, true); t.colorSpace = THREE.NoColorSpace; return t; };
  const withDetail = (mesh, dTex, w, d, m) => {
    const t = dTex.clone(); t.repeat.set(w / m, d / m); t.needsUpdate = true;
    mesh.material.lightMap = t; mesh.material.lightMapIntensity = Math.PI * 1.25; return mesh;   // the tile averages .8
  };
  const wrapDraw = (w, x, y, r, f) => {   // draw near an edge on the far side too, so the tile has no seams
    for (const dx of [0, -w, w]) for (const dy of [0, -w, w]) if (x + dx > -r && x + dx < w + r && y + dy > -r && y + dy < w + r) f(x + dx, y + dy);
  };
  const grassDetail = detail(512, (g, w) => {   // 4 m: blades and clumps
    g.fillStyle = '#cccccc'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 300; i++) { const v = 150 + rnd() * 100 | 0, r = 6 + rnd() * 18; g.fillStyle = `rgba(${v},${v},${v},.35)`; wrapDraw(w, rnd() * w, rnd() * w, r, (x, y) => { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }); }
    g.lineCap = 'round';
    for (let i = 0; i < 22000; i++) {
      const v = 110 + rnd() * 145 | 0, x = rnd() * w, y = rnd() * w, a = rnd() * 6.283, l = 2 + rnd() * 5;
      g.strokeStyle = `rgba(${v},${v},${v},.5)`; g.lineWidth = .8 + rnd() * 1.2;
      wrapDraw(w, x, y, l, (x, y) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); });
    }
  });
  const asphaltDetail = detail(256, (g, w) => {   // 3 m: aggregate, a few patches and cracks
    g.fillStyle = '#cccccc'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 9; i++) { const v = 170 + rnd() * 50 | 0, r = 10 + rnd() * 40; g.fillStyle = `rgba(${v},${v},${v},.4)`; wrapDraw(w, rnd() * w, rnd() * w, r, (x, y) => g.fillRect(x - r, y - r * .6, 2 * r, 1.2 * r)); }
    for (let i = 0; i < 9000; i++) { const v = 120 + rnd() * 135 | 0; g.fillStyle = `rgba(${v},${v},${v},.55)`; g.fillRect(rnd() * w, rnd() * w, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
    g.strokeStyle = 'rgba(70,70,70,.5)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { let x = rnd() * w, y = rnd() * w; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - .5) * 18; y += (rnd() - .3) * 10; g.lineTo(x, y); } g.stroke(); }
  });
  const blotches = (g, w, h, n, rMin, rMax, cols) => {   // big soft patches: worn, dry, lush ground (wrapping along x)
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = rMin + rnd() * (rMax - rMin), c = pick(cols);
      for (const dx of [0, -w, w]) { if (x + dx < -r || x + dx > w + r) continue; const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r); gr.addColorStop(0, c + '.28)'); gr.addColorStop(1, c + '0)'); g.fillStyle = gr; g.fillRect(x + dx - r, y - r, 2 * r, 2 * r); }
    }
  };
  // grounds of the complex, from the wall (z -38.5) toward us: footpath, two rows of nose-in bays, a kerb, lawn
  const GROUND_TILE = 62.4;   // 24 bays of 2.6 m; the parked cars sit every other bay
  const groundTex = tex(512, 256, (g, w, h) => {
    const Z = z => (z + 39) / 36 * h, X = w / GROUND_TILE;   // canvas top is the far edge (z -39)
    g.fillStyle = '#6f7d58'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, 40, 8, 40, ['rgba(150,140,80,', 'rgba(55,75,38,', 'rgba(125,140,75,']);
    for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < .5 ? 'rgba(40,60,30,.25)' : 'rgba(170,180,120,.18)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.fillStyle = '#b9b2a4'; g.fillRect(0, Z(-38.5), w, Z(-36) - Z(-38.5));                 // footpath by the wall
    g.fillStyle = '#8f8e8a'; g.fillRect(0, Z(-35.5), w, Z(-24.8) - Z(-35.5));               // the bays
    g.fillStyle = '#c9c4b8'; g.fillRect(0, Z(-24.8), w, Z(-23.2) - Z(-24.8));               // kerb and path
    g.fillStyle = '#ecebe6';
    for (let u = .9; u < GROUND_TILE; u += 2.6) g.fillRect(u * X - .5, Z(-35.3), 1.1, Z(-25) - Z(-35.3));
    g.fillRect(0, Z(-30.3), w, 1.1);
  }, true);
  groundTex.repeat.set(600 / GROUND_TILE, 1);
  near.add(withDetail(plane(600, 36, 0, G, -21, groundTex), grassDetail, 600, 36, 4));
  const parked = [];   // [x, z]: nose-in bays, drawn with the car models (traffic, below)
  for (let x = -300 + 2.2 + 5.2 * 29; x < 150; x += 5.2) for (const z of [-27.8, -32.8]) if (rnd() < (phone ? .35 : .65)) parked.push([x, z]);
  solids.push(box(600, 2.2, .5, 0, G + 1.1, -38.5, '#c9c2b4'));
  // the Gangbyeon expressway: eight lanes, a median, crash barriers, high-mast lights
  const ROAD_N = -40, ROAD_S = -74;
  const roadTex = tex(1024, 128, (g, w, h) => {
    g.fillStyle = '#3d3f42'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = rnd() < .5 ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.06)'; g.fillRect(rnd() * w, rnd() * h, 2, 1); }
    const L = h / 34, X = w / 40;                                // px per metre across (from the south edge), along
    // lanes (centres 3.5-14 and 20-30.5 m, where the cars drive): a darker track worn down each, lines between them
    for (const c of [3.5, 7, 10.5, 14, 20, 23.5, 27, 30.5]) { g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(0, (c - .7) * L, w, 1.4 * L); }
    g.fillStyle = '#e8e6df';
    for (const m of [5.25, 8.75, 12.25, 21.75, 25.25, 28.75]) for (let x = 0; x < w; x += 20 * X) g.fillRect(x, m * L, 10 * X, 1.2);
    g.fillRect(0, 1.75 * L, w, 1); g.fillRect(0, 32.25 * L, w, 1);                       // edge lines
    g.fillStyle = '#e2b53c'; g.fillRect(0, 15.9 * L, w, 1.2); g.fillRect(0, 18.1 * L, w, 1.2);
  }, true);
  roadTex.repeat.set(3000 / 40, 1);
  near.add(withDetail(plane(3000, ROAD_N - ROAD_S, 0, G + .02, (ROAD_N + ROAD_S) / 2, roadTex), asphaltDetail, 3000, ROAD_N - ROAD_S, 3));
  for (const z of [ROAD_N - .3, ROAD_S + .3]) solids.push(box(3000, .9, .4, 0, G + .45, z, '#c9c6bf'));
  solids.push(box(3000, 1, .6, 0, G + .5, -57, '#bdb9b1'));
  const lampHeads = [];
  for (let x = -600; x <= 600; x += 50) { solids.push(cyl(.15, .22, 14, x, G + 7, -57, '#7d8085', 6)); lampHeads.push([x - 1.2, G + 14, -57], [x + 1.2, G + 14, -57]); }
  // Hangang Park: lawn, a bike path and a walk, trees, the riprap bank down to the water
  const parkTex = tex(1024, 256, (g, w, h) => {
    g.fillStyle = '#6c7d4e'; g.fillRect(0, 0, w, h);
    blotches(g, w, h, 140, 12, 70, ['rgba(160,150,85,', 'rgba(55,78,38,', 'rgba(120,138,72,', 'rgba(95,110,60,']);
    for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < .5 ? 'rgba(40,60,30,.22)' : 'rgba(180,190,120,.14)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    const M = h / 78;
    g.fillStyle = '#8e5a4a'; g.fillRect(0, 22 * M, w, 4 * M);                                 // bike path
    g.fillStyle = '#e8e6df'; for (let x = 0; x < w; x += 24) g.fillRect(x, 23.9 * M, 12, .5);
    g.fillStyle = '#c2b9a8'; g.fillRect(0, 38 * M, w, 3 * M);                                 // walk
  }, true);
  parkTex.repeat.set(12, 1);
  near.add(withDetail(plane(3000, 78, 0, G - .6, -113, parkTex), grassDetail, 3000, 78, 4));
  const ripTex = tex(256, 64, (g, w, h) => { g.fillStyle = '#8b877f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const c = 100 + rnd() * 70; g.fillStyle = `rgb(${c},${c - 4},${c - 10})`; g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 5, 2 + rnd() * 3); } }, true);
  ripTex.repeat.set(200, 1);
  const slope = (zTop, zLow) => {   // riprap from the park's edge (zTop) down to the waterline (zLow)
    const g = new THREE.BufferGeometry(), X = 1500;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-X, G - .6, zTop, X, G - .6, zTop, X, W - .5, zLow, -X, W - .5, zLow], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); g.setIndex(zTop > zLow ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3]);
    near.add(new THREE.Mesh(g, basic({ map: ripTex, side: THREE.DoubleSide })));
  };
  slope(-152, SHORE_N); slope(SHORE_S - 8, SHORE_S);
  // trees: Cycles-rendered impostors (site_blender: blender/tree_sprites.py, packed by tools/tree_atlas.py): a row per
  // kind, a column per elevation the render was made from, the shadow (seen from straight above) in the last column.
  // One card per tree, square to the line from the window, showing the render nearest the angle it is seen at; the
  // shadow lies flat beneath it. Cut-out, not blended: cheap, and it sorts itself.
  const TREE_KINDS = [   // name, height, card centre height, card size, shadow size (m), at scale 1
    ['zelkova', 6.94, 3.46, 7.50, 15.00],
    ['cherry', 4.48, 2.24, 6.28, 12.55],
    ['metaseq', 13.65, 6.82, 14.75, 29.50],
  ];
  const TREE_ELEVS = [15, 30, 50, 75];
  const trees = []; let shadowMat = null;
  {   // planted in loose groups, as the park is: clumps of 3-9 with gaps between; the complex's grounds get fewer
    const onPath = z => (z < -124.5 && z > -131.5) || (z < -109.5 && z > -115.5) || (z < -98 && z > -102);   // bike path, walk, lamp line
    const add = (x, y0, z, kind) => onPath(z) || trees.push([x, y0, z, kind, kind === 2 ? 1 + rnd() * .3 : kind === 1 ? 1.35 + rnd() * .45 : 1.3 + rnd() * .5]);
    for (let i = 0; i < (phone ? 22 : 45); i++) add((rnd() - .5) * 560, G, -6 - rnd() * 15, rnd() < .6 ? 0 : 1);
    const groups = phone ? 70 : 150;
    for (let gI = 0; gI < groups; gI++) {
      const far = rnd() < .12, gx = (rnd() - .5) * (far ? 1600 : 1000) * (.4 + .6 * rnd());
      const gz = far ? SHORE_S - 20 - rnd() * 60 : -80 - rnd() * 66, kind = rnd() < .14 ? 2 : rnd() < .55 ? 0 : 1, n = 3 + Math.floor(rnd() * 7);
      for (let k = 0; k < n; k++) add(gx + (rnd() - .5) * 26, G - .6, Math.min(-77, gz + (rnd() - .5) * 14), rnd() < .8 ? kind : Math.floor(rnd() * 2));
    }
  }
  {
    const cols = TREE_ELEVS.length + 1, rows = TREE_KINDS.length;
    const atlasTex = new THREE.TextureLoader().load(new URL('./room/trees.webp', import.meta.url).href, () => { cards.visible = sh.visible = true; });
    atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 8;
    const Y = new THREE.Vector3(0, 1, 0), eyeW = new THREE.Vector3(0, 1.55, -1.5), C = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(), rt = new THREE.Vector3();
    const pos = [], uv = [], idx = [], spos = [], suv = [];
    const cell = (col, kind, sx, sy) => [(col + (sx + 1) / 2) / cols, 1 - (kind + (1 - sy) / 2) / rows];
    for (const [x, y0, z, kind, k] of trees) {
      const [, , cen, size, ssize] = TREE_KINDS[kind];
      C.set(x, y0 + cen * k, z); d.subVectors(eyeW, C).normalize();
      const el = Math.asin(d.y) * 180 / Math.PI;
      let e = 0; TREE_ELEVS.forEach((v, j) => { if (Math.abs(v - el) < Math.abs(TREE_ELEVS[e] - el)) e = j; });
      up.copy(Y).addScaledVector(d, -d.y).normalize(); rt.crossVectors(up, d).normalize();
      const h = size * k / 2, hs = ssize * k / 2, b = pos.length / 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(C.x + (rt.x * sx + up.x * sy) * h, C.y + (rt.y * sx + up.y * sy) * h, C.z + (rt.z * sx + up.z * sy) * h);
        uv.push(...cell(e, kind, sx, sy));
        spos.push(x + sx * hs, y0 + .12, z - sy * hs);       // shadow render: image right = +x, image up = south (-z)
        suv.push(...cell(cols - 1, kind, sx, sy));
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const quads = (p, t) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(t, 2)); g.setIndex(idx); return g; };
    const cards = new THREE.Mesh(quads(pos, uv), basic({ map: atlasTex, alphaTest: .45, side: THREE.DoubleSide }));
    const sh = new THREE.Mesh(quads(spos, suv), new THREE.MeshBasicMaterial({ color: '#000000', map: atlasTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    cards.visible = sh.visible = false;
    near.add(sh, cards); shadowMat = sh.material;
  }
  for (let x = -700; x <= 700; x += 35) { solids.push(cyl(.06, .08, 4.5, x, G + 1.65, -100, '#5b5e62', 5)); lampHeads.push([x, G + 3.9, -100]); }

  /* ================= the river ================= */
  const waterU = {
    time: { value: 0 }, skyTop: { value: new THREE.Color() }, skyBottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, .3, -1) }, sunColor: { value: new THREE.Color() }, sunK: { value: 1 },
    deep: { value: new THREE.Color('#294a4f') }, fogColor: { value: new THREE.Color() }, fogNear: { value: 200 }, fogFar: { value: 2600 },
    rough: { value: .5 },
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, SHORE_N - SHORE_S, 1, 1), new THREE.ShaderMaterial({
    uniforms: waterU,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float time, sunK, fogNear, fogFar, rough; uniform vec3 skyTop, skyBottom, sunDir, sunColor, deep, fogColor;
      varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      vec2 slope(vec2 p){   // ripples: a few octaves of drifting noise, finer ones weaker
        vec2 s = vec2(0.); float a = 1.; vec2 q = p * .22;
        for (int i = 0; i < 3; i++) { float e = .5;
          float c = n2(q + vec2(time * .07, time * .05)); s += a * vec2(n2(q + vec2(e, 0) + time * .07) - c, n2(q + vec2(0, e) + time * .05) - c) / e;
          q = q * 2.3 + 17.; a *= .55; }
        return s;
      }
      void main(){
        vec3 toEye = cameraPosition - vW; float dist = length(toEye); vec3 V = toEye / dist;
        vec2 sl = slope(vW.xz) * rough * mix(1., .25, smoothstep(150., 1100., dist));   // calmer with distance (no aliasing)
        vec3 N = normalize(vec3(-sl.x, 1., -sl.y));
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(skyBottom, skyTop, smoothstep(0., .55, R.y));
        float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
        vec3 col = mix(deep, sky * .9, fres * .85);
        float g = pow(max(dot(R, sunDir), 0.), 220.) * 2.2 + pow(max(dot(R, sunDir), 0.), 2200.) * 9.;   // the glitter path
        col += sunColor * g * sunK;
        col = mix(col, fogColor, smoothstep(fogNear, fogFar, dist));
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, W, (SHORE_N + SHORE_S) / 2); near.add(water);

  /* ================= bridges ================= */
  const reflections = [];   // [x, z, colour, width] light sources mirrored on the water at night
  const bridgeLights = [];
  // left: a steel tied-arch bridge (a nod to Dongjak), arches over the four river spans
  const AX = -230, AW = 26, AY = W + 17, DECK_N = -55, DECK_S = SHORE_S - 115;
  const approach = (bx, w, y, col) => {   // deck from bank to bank and beyond, a ramp down inland, piers on land
    solids.push(box(w, 2.2, DECK_N - DECK_S, bx, y - 1.1, (DECK_N + DECK_S) / 2, col));
    for (const sx of [-1, 1]) solids.push(box(.4, 1.1, DECK_N - DECK_S, bx + sx * (w / 2 - .2), y + .55, (DECK_N + DECK_S) / 2, '#d9d6cf'));
    const len = Math.hypot(100, y - G); solids.push(box(w, 2, len, bx, (y + G) / 2 - 1, DECK_N + 50, col, 0, Math.atan2(y - G, 100)));
    for (let z = DECK_N - 15; z > SHORE_N + 5; z -= 40) solids.push(cyl(1.6, 1.9, y - G, bx, (y + G) / 2, z, '#a29f96', 10));
    for (let z = SHORE_S - 15; z > DECK_S; z -= 40) solids.push(cyl(1.6, 1.9, y - G, bx, (y + G) / 2, z, '#a29f96', 10));
  };
  approach(AX, AW, AY, '#b3b1aa');
  const ARCH = '#6f98a6', archGeo = [];
  for (let z = SHORE_N - 60; z >= SHORE_S + 60; z -= 125) {
    for (const ox of [-6, 6]) solids.push(cyl(2.4, 2.8, AY - W, AX + ox, (AY + W) / 2, z, '#a29f96', 10));
    const z0 = z, z1 = z - 125;
    if (z0 > SHORE_N - 200 || z1 < SHORE_S + 200) continue;   // arches on the main spans only
    for (const sx of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3(AX + sx * (AW / 2 - .5), AY + 26 * 4 * t * (1 - t), z0 + (z1 - z0) * t)); }
      archGeo.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .9, 6, false));
      for (let i = 2; i < 24; i += 2) { const t = i / 24, y = AY + 26 * 4 * t * (1 - t); solids.push(box(.15, y - AY, .15, AX + sx * (AW / 2 - .5), (y + AY) / 2, z0 + (z1 - z0) * t, ARCH)); }
      reflections.push([AX + sx * (AW / 2), z0 - 62, '#7fd0ff', 5]);
    }
    for (let i = 4; i <= 20; i += 4) { const t = i / 24, y = AY + 26 * 4 * t * (1 - t); solids.push(box(AW - 1, .7, .7, AX, y, z0 + (z1 - z0) * t, ARCH)); }
  }
  const archMesh = new THREE.Mesh(shade(mergeGeometries(archGeo), ARCH), basic({ vertexColors: true }));
  archMesh.userData.glow = new THREE.Color('#5fc6ff'); near.add(archMesh); glow.push(archMesh);
  for (let z = DECK_N - 5; z >= DECK_S + 5; z -= 30) for (const sx of [-1, 1]) {
    solids.push(cyl(.1, .12, 9, AX + sx * (AW / 2 - 1), AY + 4.5, z, '#8a8d90', 5)); bridgeLights.push([AX + sx * (AW / 2 - 2), AY + 9, z]);
  }
  // right: a cable-stayed bridge with one tall pylon mid-river
  const BX = 420, BW = 30, BY = W + 19, PZ = (SHORE_N + SHORE_S) / 2, PH = 95;
  approach(BX, BW, BY, '#bebcb5');
  for (let z = SHORE_N - 50; z >= SHORE_S + 50; z -= 100) if (Math.abs(z - PZ) > 40) solids.push(cyl(2.2, 2.6, BY - W, BX, (BY + W) / 2, z, '#a29f96', 10));
  for (const sx of [-1, 1]) solids.push(box(3, BY - W + PH, 4.5, BX + sx * 9, (W + BY + PH) / 2, PZ, '#e6e3dc'));
  solids.push(box(21, 4, 4.5, BX, BY + PH - 6, PZ, '#e6e3dc'));
  solids.push(box(21, 3, 4.5, BX, BY - 4, PZ, '#d0cdc5'));
  const cablePts = [];
  for (const sx of [-1, 1]) for (const dir of [-1, 1]) for (let i = 1; i <= 14; i++) {
    const zt = PZ + dir * (22 + i * 20), yt = BY + PH - 9 - i * 1.6;
    cablePts.push(BX + sx * 9, yt, PZ + dir * 1.5, BX + sx * (BW / 2 - .8), BY + .8, zt);
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cg, basic({ color: '#e9e7e1' })); near.add(cables);
  for (let z = DECK_N - 5; z >= DECK_S + 5; z -= 30) for (const sx of [-1, 1]) {
    solids.push(cyl(.1, .12, 9, BX + sx * (BW / 2 - 1), BY + 4.5, z, '#8a8d90', 5)); bridgeLights.push([BX + sx * (BW / 2 - 2), BY + 9, z]);
  }
  reflections.push([BX - 9, PZ, '#fff1cf', 6], [BX + 9, PZ, '#fff1cf', 6]);
  // the far bank: riprap, park, the Olympic expressway behind a sound wall
  near.add(plane(3000, 82, 0, G - .6, SHORE_S - 49, parkTex));
  near.add(plane(3000, 16, 0, G - .55, SHORE_S - 98, roadTex));
  solids.push(box(3000, 6, 1, 0, G + 2.4, SHORE_S - 112, '#a7b0a9'));
  for (let x = -1400; x <= 1400; x += 60) lampHeads.push([x, G + 9, SHORE_S - 91]);

  near.add(new THREE.Mesh(mergeGeometries(solids), basic({ vertexColors: true })));

  /* ================= a cruise boat ================= */
  const boat = new THREE.Group(); near.add(boat);
  boat.add(new THREE.Mesh(mergeGeometries([box(34, 2.6, 8, 0, 1.3, 0, '#f1efe9'), box(34.4, .5, 8.2, 0, .5, 0, '#2c4f7a'),
    box(22, 2.6, 6.4, -2, 3.9, 0, '#f4f2ec'), box(12, 2.2, 5.6, -4, 6.3, 0, '#f4f2ec'), box(22.2, 1.1, 6.6, -2, 4.0, 0, '#3a4a58'), box(12.2, 1, 5.8, -4, 6.4, 0, '#3a4a58')]), basic({ vertexColors: true })));
  const boatLit = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(22.3, .9, 6.7).translate(-2, 4.0, 0), new THREE.BoxGeometry(12.3, .8, 5.9).translate(-4, 6.4, 0)]), additive({ color: '#ffe0a8' }));
  boat.add(boatLit); boat.position.set(-600, W + .1, -560); let boatV = 4;
  const boatGlowGeo = new THREE.PlaneGeometry(30, 70); boatGlowGeo.rotateX(-Math.PI / 2); boatGlowGeo.translate(0, -.05, 35);
  const boatGlow = new THREE.Mesh(boatGlowGeo, additive({ color: '#ffcf8a' })); boatGlow.position.copy(boat.position); near.add(boatGlow);   // its lights on the water, toward us

  /* ================= things that move: traffic ================= */
  const carGeo = (() => {
    const body = new THREE.BoxGeometry(4.4, .8, 1.8); body.translate(0, -.32, 0);
    const cab = new THREE.BoxGeometry(2.3, .62, 1.62); const p = cab.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setX(k, p.getX(k) * .8);
    cab.translate(-.25, .38, 0);
    return mergeGeometries([shade(body, '#ffffff'), shade(cab, '#3a3f45')]);
  })();
  const lanes = [];   // [axis 'x'|'z', fixed coord, y, speed (signed), from, to, count]
  for (const [z, v] of [[-43.5, 24], [-47, 22], [-50.5, 19], [-54, 17], [-60, -17], [-63.5, -19], [-67, -22], [-70.5, -24]]) lanes.push(['x', z, G + .75, v, -900, 900, phone ? 9 : 16]);
  for (const [bx, by, w] of [[AX, AY, AW], [BX, BY, BW]]) for (const [o, v] of [[-w / 4, 15], [-w / 8, 13], [w / 8, -13], [w / 4, -15]]) lanes.push(['z', bx + o, by + .75, v, DECK_S, DECK_N, phone ? 6 : 11]);
  for (const [z, v] of [[SHORE_S - 95, 22], [SHORE_S - 101, -22]]) lanes.push(['x', z, G + .75, v, -2500, 2500, phone ? 12 : 24]);
  // the expressway below gets real car models (site_blender: blender/car_models.py, lit in Cycles and baked into their
  // vertex colours); the bridges and the far bank, a kilometre off, keep the boxes
  const PAINTS = [['#e9e9e6', 30], ['#d8d4c8', 6], ['#a7abb0', 14], ['#5d6166', 12], ['#1d1f22', 18], ['#2b3f66', 7], ['#8e2a24', 5], ['#3d4a3c', 2], ['#c9b48a', 2]];
  const paint = () => { let r = rnd() * 96; for (const [c, w] of PAINTS) if ((r -= w) < 0) return c; return PAINTS[0][0]; };
  const KINDS = ['sedan', 'suv', 'hatch'], kindOf = () => { const r = rnd(); return r < .45 ? 0 : r < .8 ? 1 : 2; };
  const cars = [];
  lanes.forEach((L, li) => { for (let i = 0; i < L[6]; i++) cars.push({ L, p: L[4] + (L[5] - L[4]) * (i + rnd() * .6) / L[6], v: L[3] * (.85 + rnd() * .3), kind: li < 8 ? kindOf() : -1, col: paint() }); });
  // They drive in the vertex shader (lane, start and speed per car, position from the clock): rewriting their matrices
  // every frame made ANGLE/D3D11 wait on the GPU, ~16 ms a frame on an Intel iGPU.
  const carT = { value: 0 }, all = cars.map((_, i) => i);
  // car paint, as car_models.py packs it: corners with alpha over .25 are paint, rgb x the car's colour plus the
  // reflection ((a - .5) x 2), so dark cars still show the sky; glass, tyres and lights (alpha 0) stay as baked
  const paintShader = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPaint;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        vPaint = vec3(1.);
        #ifdef USE_INSTANCING_COLOR
          vPaint = instanceColor.rgb;
        #endif
        vColor = color;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPaint;')
      .replace('#include <color_fragment>', `diffuseColor.rgb *= mix(vColor.rgb, vColor.rgb * vPaint + max(vColor.a - .5, 0.) * 2., step(.25, vColor.a));`);
  };
  const paintMat = () => { const m = basic({ vertexColors: true }); m.userData.paint = true; return m; };
  const driving = (geo, mat, ahead, drop, idx = all) => {   // ahead, drop: where on the car (the lights), along the way and down
    const aLane = new Float32Array(idx.length * 4), aMove = new Float32Array(idx.length * 4);
    idx.forEach((ci, j) => { const c = cars[ci], L = c.L; aLane.set([L[0] === 'x' ? 1 : 0, L[1], L[2], L[4]], j * 4); aMove.set([c.p, c.v, L[5] - L[4], 0], j * 4); });
    geo.setAttribute('aLane', new THREE.InstancedBufferAttribute(aLane, 4)); geo.setAttribute('aMove', new THREE.InstancedBufferAttribute(aMove, 4));
    mat.onBeforeCompile = sh => {
      if (mat.userData.paint) paintShader(sh);
      Object.assign(sh.uniforms, { uCarT: carT, uAhead: { value: ahead }, uDrop: { value: drop } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aLane, aMove; uniform float uCarT, uAhead, uDrop;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float s = sign(aMove.y), p = aLane.w + mod(aMove.x - aLane.w + aMove.y * uCarT, aMove.z);
          bool alongX = aLane.x > .5;
          vec3 fwd = alongX ? vec3(s, 0., 0.) : vec3(0., 0., s), side = alongX ? vec3(0., 0., s) : vec3(-s, 0., 0.);
          transformed = (alongX ? vec3(p, aLane.z, aLane.y) : vec3(aLane.y, aLane.z, p)) + fwd * (transformed.x + uAhead)
            + side * transformed.z + vec3(0., transformed.y + uDrop, 0.);`);
    };
    mat.customProgramCacheKey = () => mat.userData.paint ? 'car-paint' : 'car';
    const im = new THREE.InstancedMesh(geo, mat, idx.length); im.frustumCulled = false;   // instance matrices stay identity
    if (mat.vertexColors) { const cc = new THREE.Color(); idx.forEach((ci, j) => im.setColorAt(j, cc.set(cars[ci].col))); }
    return im;
  };
  const boxes = cars.map((c, i) => i).filter(i => cars[i].kind < 0);
  const carMesh = driving(carGeo, basic({ vertexColors: true }), 0, 0, boxes);
  const lightGeo = new THREE.BoxGeometry(.4, .25, 1.5);
  const heads = driving(lightGeo, additive({ color: '#fff4dc' }), 2.25, -.1);
  const tails = driving(lightGeo, additive({ color: '#ff3024' }), -2.25, -.1);
  near.add(carMesh, heads, tails);
  new GLTFLoader().load(new URL('./room/cars.glb', import.meta.url).href, gltf => {
    const geos = KINDS.map(name => {   // one mesh per body style, a primitive per material: merged, colours only
      const parts = []; gltf.scene.getObjectByName(name).traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k); parts.push(g); } });
      return mergeGeometries(parts);
    });
    KINDS.forEach((_, kind) => {
      const idx = cars.map((c, i) => i).filter(i => cars[i].kind === kind);
      if (idx.length) near.add(Object.assign(driving(geos[kind].clone(), paintMat(), 0, -.75, idx), { renderOrder: 500 }));
      const mine = parked.filter((_, j) => j % 3 === kind);   // the bays: still, so plain instances
      const pm = paintMat(); pm.onBeforeCompile = paintShader; pm.customProgramCacheKey = () => 'parked';
      const im = new THREE.InstancedMesh(geos[kind], pm, mine.length), cc = new THREE.Color();
      mine.forEach(([x, z], j) => { m4.compose(new THREE.Vector3(x, G, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (j * 7 % 2 ? 1 : -1) * Math.PI / 2), new THREE.Vector3(1, 1, 1)); im.setMatrixAt(j, m4); im.setColorAt(j, cc.set(paint())); });
      im.renderOrder = 500; near.add(im);
    });
  });
  const moveCars = dt => { carT.value = (carT.value + dt) % 3600; };   // float precision; a jump once an hour

  /* ================= night: lamps, and their streaks on the water ================= */
  const allLamps = lampHeads.concat(bridgeLights);
  const lampGeo = mergeGeometries(allLamps.map(([x, y, z]) => { const g = new THREE.SphereGeometry(.35, 6, 4); g.translate(x, y, z); return g; }));
  const lampMat = basic({ color: '#ffd9a0' }, []); near.add(new THREE.Mesh(lampGeo, lampMat));
  {   // the pools of light they throw on the expressway and the park paths: soft discs, added, faded in with the night
    const poolTex = tex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    const pools = (list, w, d, col) => near.add(new THREE.Mesh(mergeGeometries(list.map(([x, y, z]) => {
      const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, y, z); return g;
    })), additive({ map: poolTex, color: col })));
    // the median masts' two heads light a roadway each, long pools that nearly meet; the park's lamps, small rounds
    pools(lampHeads.filter(h => h[1] > G + 8).map(([x, , z], i) => [x, G + .06, z + (i % 2 ? -8.5 : 8.5)]), 46, 17, '#4d3c28');
    pools(lampHeads.filter(h => h[1] < G + 8).map(([x, , z]) => [x, G - .54, z + 1.5]), 10, 10, '#5a4832');
  }
  const streakTex = tex(32, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.15, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h); });
  const streakU = { time: { value: 0 }, map: { value: streakTex }, opacity: { value: 0 } };
  const streakMat = new THREE.ShaderMaterial({ uniforms: streakU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: 'varying vec2 vUv; varying vec3 vC; void main(){ vUv = uv; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform sampler2D map; uniform float time, opacity; varying vec2 vUv; varying vec3 vC;
      void main(){ float wob = .55 + .45 * sin(vUv.y * 60. - time * 3. + vUv.x * 2.) * sin(vUv.y * 23. + time * 1.7);
        gl_FragColor = vec4(vC * texture2D(map, vUv).a * wob * opacity, 1.); }` });
  const eye = new THREE.Vector3(0, 1.55, 0), streaks = [], sc = new THREE.Color();
  for (const [x, y, z] of bridgeLights) reflections.push([x, z, '#ffcf8a', 1.6]);
  for (let x = -2000; x <= 2000; x += 70) reflections.push([x + rnd() * 40, SHORE_S - 4, pick(['#ffd9a0', '#fff1d6', '#cfe0ff', '#ffb070']), 4 + rnd() * 6]);
  for (const [x, z, col, w] of reflections) {
    // the streak runs from under the light toward the viewer, lying on the water
    const dx = eye.x - x, dz = eye.z - z, len = Math.min(Math.hypot(dx, dz) * .45, 260), ang = Math.atan2(dx, dz);
    const g = new THREE.PlaneGeometry(w, len); g.rotateX(-Math.PI / 2); g.translate(0, 0, len / 2); g.rotateY(ang); g.translate(x, W + .05, z);
    const cs = new Float32Array(g.attributes.position.count * 3); sc.set(col); for (let k = 0; k < cs.length; k += 3) cs.set([sc.r, sc.g, sc.b], k);
    g.setAttribute('color', new THREE.BufferAttribute(cs, 3)); streaks.push(g);
  }
  near.add(new THREE.Mesh(mergeGeometries(streaks), streakMat));

  /* ================= far: the Gangnam skyline, Lotte World Tower, the ridges ================= */
  const officeTex = tex(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#7f93a6'); gr.addColorStop(1, '#4e6072'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1); for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
  }, true);
  const officeLit = tex(128, 256, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 16) if (rnd() < .3) { g.fillStyle = pick(['#fff3dc', '#e4ecff', '#ffe2b0']); g.fillRect(x + 1, y + 1, 15, 6); } }, true);
  // Built at true scale, shrunk 10x about the eye (angles unchanged) and drawn after the sky (index.html), back to front,
  // on the far plane like it: only where nothing nearer has been drawn.
  // It hazes itself toward the low sky (scene fog would read the shrunk distances) and lights its own windows.
  const farAptLit = aptLit(.28);   // fewer lit than near: hundreds of blocks overlap from here
  const far = new THREE.Group(); far.name = 'river-far'; far.scale.setScalar(.1); far.position.copy(eye).multiplyScalar(1 - .1); scene.add(far);
  const hazeU = { value: new THREE.Color('#b9c6d3') }, litK = { value: 0 };
  let order = 1100;
  const farAdd = o => { o.renderOrder = order++; far.add(o); return o; };
  const farMat = (o, hazeK, lit = null, tile = null, gable = false) => {
    const m = basic({ ...o, fog: false, depthWrite: false });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uHaze: hazeU, uHazeK: { value: hazeK }, uLitK: litK, uLit: { value: lit } });
      // gable: the texture is two columns, front walls on the left, the blank end walls (|normal.x| > .5) on the right
      const tuv = gable ? 'tuv' : 'vMapUv';
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeK, uLitK; uniform sampler2D uLit;' + (gable ? '\nvarying float vSide;' : ''))
        .replace('#include <map_fragment>', gable ? `vec2 tuv = vec2(fract(vMapUv.x) * .5 + vSide * .5, vMapUv.y), gx = dFdx(vMapUv) * vec2(.5, 1.), gy = dFdy(vMapUv) * vec2(.5, 1.);
          diffuseColor *= textureGrad(map, tuv, gx, gy);` : '#include <map_fragment>')
        .replace('#include <opaque_fragment>', (lit ? `outgoingLight += ${gable ? 'textureGrad(uLit, tuv, gx, gy)' : 'texture2D(uLit, vMapUv)'}.rgb * uLitK;\n` : '') +
          'outgoingLight = mix(outgoingLight, uHaze, uHazeK);\n#include <opaque_fragment>');
      if (gable) sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSide;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vSide = abs(normal.x) > .5 ? 1. : 0.;\n  if (vSide > .5) vMapUv.x = uv.x;   // one end wall across');
      sh.vertexShader = sh.vertexShader.replace(/}\s*$/, '  gl_Position.z = gl_Position.w;\n}');
      if (tile) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING   // the texture repeats with the box size: UVs come from the unit box
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vMapUv = uv * vec2(abs(normal.x) > .5 ? sc.z : sc.x, abs(normal.y) > .5 ? sc.z : sc.y) / vec2(${tile});
        #endif`);
    };
    m.customProgramCacheKey = () => `far${lit ? 'L' : ''}${tile || ''}${gable ? 'G' : ''}`;
    return m;
  };
  const ridge = (z, base, amp, col, ph, k) => {
    const sh = new THREE.Shape(); sh.moveTo(-30000, G - 50);
    for (let x = -30000; x <= 30000; x += 200) sh.lineTo(x, G + base + amp * (.5 + .32 * Math.sin(x * .00031 + ph) + .18 * Math.sin(x * .0011 + ph * 2.3)));
    sh.lineTo(30000, G - 50); const g = new THREE.ShapeGeometry(sh); g.translate(0, 0, z);
    farAdd(new THREE.Mesh(g, farMat({ color: col }, k)));
  };
  ridge(-9500, 150, 520, '#8c9aaa', 1.3, .7);   // Gwanaksan and its neighbours
  ridge(-6500, 60, 260, '#6f7f86', 4.1, .55);
  { const g = new THREE.PlaneGeometry(60000, 30000); g.rotateX(-Math.PI / 2); g.translate(0, G - 1, SHORE_S - 15000);   // the far side's ground
    farAdd(new THREE.Mesh(g, farMat({ color: '#59605f' }, .45))); }
  {   // Lotte World Tower: a tapering square of 555 m, a long way off to the east
    const prof = []; for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push(new THREE.Vector2(38 * (1 - Math.pow(t, 1.7)) + 4 * (1 - t) + 1.5, t * 555)); }
    const g = new THREE.LatheGeometry(prof, 4); g.rotateY(Math.PI / 4); g.translate(-5600, G, -4800);
    farAdd(new THREE.Mesh(shade(g, '#c9d2da'), farMat({ vertexColors: true }, .5)));
    const beacon = farAdd(new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), farMat({ color: '#ff3a2a' }, .15))); beacon.position.set(-5600, G + 560, -4800); glow.push(beacon);
  }
  // the far bank's apartments: the Korean pattern, complexes of identical slabs in rows (old 15-floor ones, newer
  // towers of 25-35), each slab with its blank end walls and a lift housing on the roof
  const farAptTex = tex(512, 512, (g, w, h) => {   // left: front (4 flats x 30 floors), right: the end wall
    const H = w / 2;
    g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, H, h);
    for (let y = 0; y < h; y += 17) {
      g.fillStyle = '#d2cdc3'; g.fillRect(0, y, H, 2);
      for (let x = 0; x < H; x += 64) {
        g.fillStyle = '#7c8996'; g.fillRect(x + 6, y + 4, 40, 10); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 6, y + 4, 40, 2);
        g.fillStyle = '#c9c4ba'; g.fillRect(x + 6, y + 12, 40, 2); g.fillStyle = '#9aa3ab'; g.fillRect(x + 50, y + 5, 8, 8);
      }
    }
    g.fillStyle = 'rgba(0,0,0,.06)'; for (let x = 0; x < H; x += 64) g.fillRect(x + 46, 0, 4, h);
    g.fillStyle = '#ece8e0'; g.fillRect(H, 0, H, h);                                              // end wall: blank,
    g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(H, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
    for (let y = 8; y < h; y += 17) { g.fillStyle = '#8d96a0'; g.fillRect(H + H / 2 - 5, y, 10, 7); }   // the stair's small windows,
    g.fillStyle = '#4f7fae'; g.fillRect(H + 40, 18, H - 80, 10); g.fillStyle = '#b9483d'; g.fillRect(H + 40, 32, (H - 80) * .6, 6);   // a brand's stripes
  }, true);
  const farAptLitTex = tex(512, 512, (g, w, h) => {
    const H = w / 2;
    for (let y = 0; y < h; y += 17) for (let x = 0; x < H; x += 64) if (rnd() < .28) { g.fillStyle = pick(['#ffd08a', '#ffe6b8', '#fff3dc', '#d6e4ff']); g.fillRect(x + 6, y + 4, 40, 10); }
    for (let y = 8; y < h; y += 17) { g.fillStyle = 'rgba(255,240,210,.8)'; g.fillRect(H + H / 2 - 5, y, 10, 7); }   // stairs are lit all night
  }, true);
  // faces lit by the early-afternoon sun beyond them: tops brightest, the east ends (facing -x) next, the faces toward
  // us (+z) in their own shade, west ends darkest
  const shadedBox = () => {
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, .5, 0);
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let k = 0; k < n.count; k++) { const v = n.getY(k) > .5 ? 1.05 : n.getX(k) < -.5 ? .9 : n.getX(k) > .5 ? .68 : n.getZ(k) > .5 ? .8 : .75; c.set([v, v, v], k * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
  };
  const slabs = [], housings = [];   // [x, z, w, d, h]
  for (let c = 0; c < (phone ? 26 : 46); c++) {
    const newer = rnd() < .45, nx = 3 + Math.floor(rnd() * (newer ? 3 : 4)), nz = 1 + Math.floor(rnd() * 3);
    const w = newer ? 26 + rnd() * 14 : 45 + rnd() * 25, d = newer ? 22 : 14, h = newer ? 75 + rnd() * 35 : 40 + rnd() * 8;
    const x0 = (rnd() + rnd() - 1) * 2900 - 150, z0 = -1290 - rnd() * 650, gx = w + 22 + rnd() * 25, gz = d + 40 + rnd() * 30;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const hh = h * (newer ? .9 + rnd() * .2 : 1), x = x0 + i * gx + (j % 2) * gx * .3, z = z0 - j * gz;
      slabs.push([x, z, w, d, hh]);
      housings.push([x + w * (rnd() < .5 ? -.25 : .25), z, Math.min(w * .3, 9), d * .7, hh + (newer ? 7 : 4.5)]);
    }
  }
  const offices = [];
  for (let i = 0; i < (phone ? 50 : 90); i++) {      // Gangnam offices, clustered left of centre
    const x = -1900 + (rnd() + rnd() - 1) * 1600, z = -2300 - rnd() * 1500; offices.push([x, z, 30 + rnd() * 35, 30 + rnd() * 25, 90 + rnd() * 160]);
  }
  for (const L of [slabs, housings, offices]) L.sort((a, b) => a[1] - b[1]);   // far to near: no depth writes, the nearer drawn over
  // their texture tiles are about twice the near ones: true-size flats are under 2 px from here and read as noise when lit
  const farBoxes = (list, mat, tint) => {
    const im = farAdd(new THREE.InstancedMesh(shadedBox(), mat, list.length)), c = new THREE.Color();
    list.forEach(([x, z, w, d, h], i) => { m4.compose(new THREE.Vector3(x, G, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)); im.setMatrixAt(i, m4); im.setColorAt(i, tint(c)); });
  };
  farBoxes(offices, farMat({ map: officeTex, vertexColors: true }, .3, officeLit, '56., 230.'), c => c.setHSL(rnd() < .55 ? .09 : .58, .05 + rnd() * .1, .6 + rnd() * .3));
  // the roof housings go first: full-height boxes poking above their roofs, so every slab drawn after covers the part
  // below; a nearer slab then hides a farther housing, as it should (a farther, taller slab may hide a nearer one: rare)
  farBoxes(housings, farMat({ color: '#e3ded4', vertexColors: true }, .18), c => c.setHSL(.1, .04, .8 + rnd() * .12));
  farBoxes(slabs, farMat({ map: farAptTex, vertexColors: true }, .18, farAptLitTex, '40., 160.', true), c => c.setHSL(rnd() < .7 ? .1 : .58, .04 + rnd() * .1, .8 + rnd() * .15));

  // three.js sorts opaque things by material before distance, so the water and the grounds could go first and be shaded
  // behind the walls too; after the room's opaque things, the GPU skips them wherever the room is in front
  near.traverse(o => { if (o.material && !o.material.transparent) o.renderOrder = 500; });

  const tint = new THREE.Color(), cA = new THREE.Color(), sunDirTmp = new THREE.Vector3();
  return {
    near, far,
    // env: day, darkness, gray, golden, flash 0..1; skyTop, skyBottom: Colors; sunPos: world position of the sun disc
    update({ day, darkness, gray, golden, flash = 0, skyTop, skyBottom, sunPos, sunColor, exposure = 1 }, dt, t) {
      tint.set('#1c2333').lerp(cA.set('#ffffff'), day).lerp(cA.set('#ffc999'), Math.min(1, golden) * .3 * day)
        .lerp(cA.set('#9da4ac').multiplyScalar(.5 + .5 * day), gray * .45).addScalar(flash * .4)
        .multiplyScalar(1.5 / exposure);   // unlit colours still go through the room's exposure: undo most of it
      dayMats.forEach(m => m.color.copy(m.userData.base).multiply(tint));
      const on = smooth(.25, .8, darkness);
      litMats.forEach(m => { m.opacity = on; m.visible = on > .01; });
      lampMat.color.set('#ffd9a0').multiplyScalar(.15 + 2.4 * on);
      archMesh.material.color.copy(tint).lerp(archMesh.userData.glow, on * .85).multiplyScalar(1 + on * .6);
      cables.material.color.set('#e9e7e1').multiply(tint).lerp(cA.set('#fff1cf'), on * .6);
      glow.forEach(o => { if (o.isMesh && o !== archMesh) o.visible = on > .2 && Math.sin(t * 3) > -.2; });
      const haze = cA.copy(skyBottom).lerp(skyTop, .15);
      hazeU.value.copy(haze); scene.fog.color.copy(haze); litK.value = on;
      waterU.time.value = t; waterU.skyTop.value.copy(skyTop); waterU.skyBottom.value.copy(skyBottom);
      waterU.fogColor.value.copy(haze); waterU.deep.value.set('#294a4f').multiply(tint);
      waterU.sunDir.value.copy(sunDirTmp.copy(sunPos).sub(eye).normalize());
      waterU.sunColor.value.copy(sunColor); waterU.sunK.value = Math.max(0, sunDirTmp.y) > 0 ? (1 - gray * .9) * (.4 + .6 * day) : 0;
      waterU.rough.value = .16 + gray * .2;
      if (shadowMat) shadowMat.opacity = .25 + .75 * day * (1 - gray * .7);
      streakU.time.value = t; streakU.opacity.value = on; streakMat.visible = on > .01;
      moveCars(dt);
      boat.position.x += boatV * dt; if (boat.position.x > 1400 || boat.position.x < -1400) { boatV = -boatV; boat.rotation.y = boatV < 0 ? Math.PI : 0; }
      boatGlow.position.x = boat.position.x; boatGlow.material.opacity = on * .12;
    },
  };
}
