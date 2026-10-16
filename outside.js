// The view out of the window: a Seoul side street seen from a third-floor room. The room's floor is at y 0, the
// street 8 m below. Across it a row of shops with flats above, apartment towers further off, and Namsan with its
// tower on the skyline.
// Everything here is unlit (MeshBasicMaterial): shading lives in vertex colours and canvas textures, and update()
// tints it for the time of day and the weather. A real-time light would also land on the room, whose light is baked.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STREET = -8;                 // street level
const FACADE = -18;                // front of the row across the street
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildOutside(scene, { phone = false, seed = 11 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const PX = phone ? 22 : 40;      // facade texture pixels per metre
  const group = new THREE.Group(); group.name = 'outside'; scene.add(group);
  const dayMats = [], litMats = [], glowMats = [];
  const canvas = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const basic = (o, list = dayMats) => { const m = new THREE.MeshBasicMaterial(o); m.userData.base = m.color.clone(); list.push(m); return m; };
  // shade a geometry's faces as if lit from the upper left: tops brightest, the street-facing side next
  const shade = (g, col) => {
    g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals();
    const n = g.attributes.normal, c = new Float32Array(n.count * 3), base = new THREE.Color(col);
    for (let i = 0; i < n.count; i++) {
      const k = .62 + .38 * Math.max(0, n.getY(i)) + .22 * Math.max(0, n.getZ(i)) + .12 * Math.max(0, -n.getX(i));
      c[i * 3] = base.r * k; c[i * 3 + 1] = base.g * k; c[i * 3 + 2] = base.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); return g;
  };
  const box = (w, h, d, x, y, z, col, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); g.rotateY(ry); g.translate(x, y, z); return shade(g, col);
  };
  const cyl = (rt, rb, h, x, y, z, col, seg = 12) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return shade(g, col); };
  const solids = [];   // vertex-coloured bits merged into one mesh: rooftop kit, trees, cars, lamp posts, kerbs
  const hangul = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Noto Sans CJK KR",sans-serif';

  /* ---------- the street ---------- */
  const NEAR_KERB = -6.6, FAR_KERB = -14.6, ROAD_W = NEAR_KERB - FAR_KERB, XL = -70, XR = 70, CROSS = [-9, -5];
  const roadTex = canvas(phone ? 2048 : 4096, phone ? 128 : 256, (g, w, h) => {
    const mx = w / (XR - XL), mz = h / ROAD_W, X = x => (x - XL) * mx, Z = z => (NEAR_KERB - z) * mz;
    g.fillStyle = '#3b3d40'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 40; i++) { g.fillStyle = rnd() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.06)'; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(20,20,22,.25)'; g.fillRect(rnd() * w, rnd() * h, 30 + rnd() * 120, 2 + rnd() * 6); }   // patched seams
    const cz = (NEAR_KERB + FAR_KERB + 2) / 2;   // centre line (the far lane is narrower: it has a parking strip)
    g.fillStyle = '#e2b53c'; g.fillRect(0, Z(cz) - .2 * mz, w, .12 * mz); g.fillRect(0, Z(cz) + .08 * mz, w, .12 * mz);
    g.fillStyle = '#e8e6df';
    g.fillRect(0, Z(FAR_KERB + 2.1), w, .12 * mz);                                                    // parking strip
    for (let x = XL; x < XR; x += 5) g.fillRect(X(x), Z(FAR_KERB + 2.1), .12 * mx, 2.1 * mz);       // bays
    for (let zz = NEAR_KERB - .35; zz > FAR_KERB + .6; zz -= 1) g.fillRect(X(CROSS[0]), Z(zz), (CROSS[1] - CROSS[0]) * mx, .5 * mz);   // zebra
    g.fillRect(X(CROSS[0] - 1.2), 0, .35 * mx, (NEAR_KERB - cz) * mz);                                 // stop line
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(XR - XL, ROAD_W), basic({ map: roadTex }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, STREET, (NEAR_KERB + FAR_KERB) / 2); group.add(road);
  const paverTex = canvas(256, 256, (g, w) => {
    g.fillStyle = '#b4ada2'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const c = 160 + rnd() * 30; g.fillStyle = `rgb(${c},${c - 6},${c - 14})`;
      g.fillRect(x * 64 + (y % 2) * 32 + 1, y * 32 + 1, 62, 30);
    }
  });
  paverTex.wrapS = paverTex.wrapT = THREE.RepeatWrapping;
  for (const [z0, z1] of [[-3.1, NEAR_KERB], [FAR_KERB, FACADE]]) {
    const t = paverTex.clone(); t.needsUpdate = true; t.repeat.set((XR - XL) / 2, Math.abs(z1 - z0) / 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(XR - XL, Math.abs(z1 - z0)), basic({ map: t }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, STREET + .15, (z0 + z1) / 2); group.add(m);
    for (const z of [z0, z1]) if (z === NEAR_KERB || z === FAR_KERB) solids.push(box(XR - XL, .17, .22, 0, STREET + .07, z, '#c9c4ba'));
  }

  /* ---------- the row across the street ---------- */
  const WALLS = [['#d8c8aa', 'plain'], ['#c2c3be', 'tile'], ['#9a5b48', 'brick'], ['#e3dfd6', 'tile'], ['#77797c', 'plain'], ['#cdb99a', 'brick'], ['#b9b2a6', 'plain']];
  const SHOPS = [['카페 온도', '#2f4a3c'], ['편의점', '#2c56a8'], ['온누리약국', '#2f8a5a'], ['김밥천국', '#d8a02a'], ['세탁소', '#3a7bbf'],
                 ['행복부동산', '#7a2e2e'], ['꽃집', '#c75b7a'], ['동네빵집', '#a8642c'], ['치킨', '#d1452c'], ['밝은안경', '#273a5a'],
                 ['분식', '#e07a2f'], ['미용실', '#6b4ea0'], ['정육점', '#9a2a2a'], ['문구', '#3d8a52']];
  const ROW = [[-48, 12, 6], [-34.5, 10.5, 5], [-24, 10, 7], [-12, 10, 3], [-2, 8, 4], [8.5, 11.5, 6], [20, 10, 5], [31.5, 12.5, 8], [46, 11, 4]];
  let shopI = 0;
  for (const [x0, w, floors] of ROW) {
    const [wall, kind] = pick(WALLS), H = 4 + (floors - 1) * 3, D = 12;
    const winW = pick([1.2, 1.5, 1.8]), frame = pick(['#f2f0ea', '#2e2f31', '#a7a9ab']), balc = rnd() < .45;
    const cols = Math.max(2, Math.floor((w - 1.2) / (winW + 1.1)));
    const tw = Math.round(w * PX), th = Math.round((H + .9) * PX), P = PX, Y = y => th - y * P;   // y in metres from the street
    const windows = [];
    const dayTex = canvas(tw, th, g => {
      g.fillStyle = wall; g.fillRect(0, 0, tw, th);
      if (kind === 'brick') for (let y = 0; y < th; y += P * .075) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y, tw, 1); for (let x = (y / (P * .075)) % 2 * P * .12; x < tw; x += P * .24) g.fillRect(x, y, 1, P * .075); }
      if (kind === 'tile') { g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < th; y += P * .3) g.fillRect(0, y, tw, 1); for (let x = 0; x < tw; x += P * .3) g.fillRect(x, 0, 1, th); }
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(40,30,20,.05)'; g.fillRect(rnd() * tw, rnd() * th * .3 + th * .2, P * (.1 + rnd() * .3), P * (1 + rnd() * 4)); }   // weathering streaks
      // ground floor: a shop front under a lit sign
      const [name, signCol] = SHOPS[shopI++ % SHOPS.length];
      g.fillStyle = '#2a2c2e'; g.fillRect(P * .3, Y(3.05), tw - P * .6, P * 3.05);
      const glass = g.createLinearGradient(0, Y(3), 0, Y(0)); glass.addColorStop(0, '#5d6d7c'); glass.addColorStop(1, '#2a333c');
      g.fillStyle = glass; g.fillRect(P * .45, Y(2.85), tw - P * .9, P * 2.75);
      g.fillStyle = '#1d1f21'; for (let x = P * .45; x < tw - P * .5; x += P * 1.6) g.fillRect(x, Y(2.85), P * .08, P * 2.75);
      g.fillStyle = 'rgba(255,240,215,.35)'; for (let i = 0; i < 5; i++) g.fillRect(P * (1 + rnd() * (w - 3)), Y(1.3), P * (.4 + rnd() * .8), P * (.3 + rnd() * .6));   // shelves inside
      windows.push({ x: P * .45, y: Y(2.85), w: tw - P * .9, h: P * 2.75, shop: true });
      g.fillStyle = signCol; g.fillRect(P * .3, Y(3.95), tw - P * .6, P * .8);
      g.fillStyle = '#ffffff'; g.font = `800 ${Math.round(P * .55)}px ${hangul}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(name, tw / 2, Y(3.55));
      windows.push({ x: P * .3, y: Y(3.95), w: tw - P * .6, h: P * .8, sign: true, col: signCol, name });
      // upper floors: framed windows with curtains, blinds and outdoor AC units
      for (let f = 1; f < floors; f++) {
        const yb = 4 + (f - 1) * 3, gap = (w - cols * winW) / (cols + 1);
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, Y(yb + .02), tw, P * .12);                       // slab line
        for (let c = 0; c < cols; c++) {
          const wx = P * (gap + c * (winW + gap)), wy = Y(yb + 2.35), ww = P * winW, wh = P * 1.5;
          g.fillStyle = frame; g.fillRect(wx - P * .07, wy - P * .07, ww + P * .14, wh + P * .14);
          const gl = g.createLinearGradient(0, wy, 0, wy + wh); gl.addColorStop(0, '#9fb4c6'); gl.addColorStop(.5, '#52606d'); gl.addColorStop(1, '#3a434c');
          g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
          const r = rnd();
          if (r < .35) { g.fillStyle = pick(['#ece3d2', '#d9cdb8', '#f4efe6', '#c9d3d9']); g.fillRect(wx, wy, ww * (.3 + rnd() * .4), wh); }
          else if (r < .55) { g.fillStyle = 'rgba(240,236,228,.75)'; for (let k = 0; k < wh * .6; k += P * .06) g.fillRect(wx, wy + k, ww, P * .03); }
          g.fillStyle = frame; g.fillRect(wx + ww / 2 - P * .03, wy, P * .06, wh);
          g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(wx - P * .1, wy + wh + P * .07, ww + P * .2, P * .07);   // sill
          windows.push({ x: wx, y: wy, w: ww, h: wh });
          if (!balc && rnd() < .3) {   // AC unit hung under the window
            const ax = wx + rnd() * (ww - P * .8), ay = wy + wh + P * .25;
            g.fillStyle = '#e4e4e0'; g.fillRect(ax, ay, P * .8, P * .55);
            g.fillStyle = '#8d9093'; g.beginPath(); g.arc(ax + P * .52, ay + P * .27, P * .2, 0, 7); g.fill();
            g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(ax, ay + P * .55, P * .8, P * .04);
          }
        }
      }
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, Y(H + .9), tw, P * .12);   // parapet coping
    });
    // the same windows, lit, for the night: some homes are in, the shops and signs are on
    const litTex = canvas(Math.round(tw / 2), Math.round(th / 2), (g, cw) => {
      const k = cw / tw;
      for (const wn of windows) {
        if (wn.sign) { g.fillStyle = wn.col; g.fillRect(wn.x * k, wn.y * k, wn.w * k, wn.h * k);
          g.fillStyle = '#ffffff'; g.font = `800 ${Math.round(PX * .55 * k)}px ${hangul}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(wn.name, (wn.x + wn.w / 2) * k, (wn.y + wn.h / 2) * k); continue; }
        if (!wn.shop && rnd() > .38) continue;
        g.fillStyle = wn.shop ? '#ffe9c8' : pick(['#ffcf86', '#ffe2b0', '#fff1d6', '#cfe0ff']);
        g.globalAlpha = wn.shop ? .9 : .65 + rnd() * .35; g.fillRect(wn.x * k, wn.y * k, wn.w * k, wn.h * k); g.globalAlpha = 1;
      }
    });
    const cx = x0 + w / 2;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, H + .9), basic({ map: dayTex }));
    front.position.set(cx, STREET + (H + .9) / 2, FACADE); group.add(front);
    const lit = new THREE.Mesh(new THREE.PlaneGeometry(w, H + .9), basic({ map: litTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, litMats));
    lit.position.set(cx, STREET + (H + .9) / 2, FACADE + .03); group.add(lit);
    // body behind the facade (sides and roof), parapet, awning, balconies, rooftop kit
    const body = new THREE.BoxGeometry(w, H, D); body.translate(cx, STREET + H / 2, FACADE - D / 2 - .01);
    solids.push(shade(body, wall));
    for (const [px, pz, pw, pd] of [[cx, FACADE - .145, w, .25], [cx, FACADE - D + .12, w, .25], [x0 + .12, FACADE - D / 2, .25, D], [x0 + w - .12, FACADE - D / 2, .25, D]])
      solids.push(box(pw, .9, pd, px, STREET + H + .45, pz, wall));
    solids.push(box(w - .5, .08, 1.1, cx, STREET + 3.15, FACADE + .55, pick(['#2f4a3c', '#7a2e2e', '#273a5a', '#c9a24a', '#5a5d61'])));   // awning
    if (balc) for (let f = 1; f < floors; f++) {
      const yb = STREET + 4 + (f - 1) * 3;
      solids.push(box(w - .4, .15, 1.0, cx, yb, FACADE + .5, '#d6d2ca'));
      solids.push(box(w - .4, .05, .05, cx, yb + 1.05, FACADE + .98, frame === '#2e2f31' ? '#2e2f31' : '#8c8f92'));
      for (let x = x0 + .3; x < x0 + w - .25; x += phone ? .3 : .14) solids.push(box(.025, 1.0, .025, x, yb + .55, FACADE + .98, '#6f7275'));
    }
    const roof = STREET + H;
    if (rnd() < .8) { solids.push(cyl(.75, .75, 1.6, x0 + w * (.2 + rnd() * .2), roof + .8, FACADE - D * .6, pick(['#5f87b5', '#c8ccd0', '#3f6f9a']), 16)); }
    solids.push(box(2.6, 2.4, 3, x0 + w * .7, roof + 1.2, FACADE - D * .65, wall));                     // stair house
    for (let i = 0; i < 2 + rnd() * 3; i++) solids.push(box(.9, .65, .4, x0 + 1 + rnd() * (w - 2), roof + .33, FACADE - 1.2 - rnd() * 3, '#e2e2de'));
    if (rnd() < .5) { solids.push(cyl(.025, .025, 3, x0 + w * .85, roof + 2.4 + 1.5, FACADE - D * .65, '#8a8d90', 6)); }
    if (rnd() < .4) for (let i = 0; i < 4; i++) solids.push(box(.8, .45, .8, x0 + 1 + i * 1.1, roof + .23, FACADE - D + 1.5, i % 2 ? '#5b7a3c' : '#6e8c46'));
  }

  /* ---------- trees, lamps and cars along the street ---------- */
  const lamps = [];
  for (const [z, x0, step, hMin] of [[-5.9, -60, 8, 4.4], [-15.3, -63, 8, 5.5]]) {
    for (let x = x0; x < 66; x += step) {
      const tx = x + rnd() * 1.5, h = hMin + rnd() * 1.4;
      if (z > -8 && Math.abs(tx + 1) < 6.5) continue;   // keep the window's view down the street open
      solids.push(cyl(.14, .2, h, tx, STREET + h / 2, z, '#4a3a2c', 8));
      for (let b = 0; b < 4; b++) {   // a ginkgo in October: gold over green
        const blob = new THREE.IcosahedronGeometry(1.2 + rnd() * .7, 1);
        blob.scale(1, 1.25, 1); blob.translate(tx + (rnd() - .5) * 1.4, STREET + h + (rnd() - .2) * 1.6, z + (rnd() - .5) * 1.2);
        solids.push(shade(blob, pick(['#cdb340', '#d8c255', '#b8ae45', '#9aa047', '#e0c860'])));
      }
    }
  }
  for (let x = -54; x < 60; x += 18) {
    const z = -15.0, top = STREET + 7.2;
    solids.push(cyl(.07, .1, 7.2, x, STREET + 3.6, z, '#55585c', 8));
    solids.push(box(.12, .1, 1.4, x, top, z + .7, '#55585c'));
    lamps.push(new THREE.Vector3(x, top - .12, z + 1.3));
  }
  const lampHead = basic({ color: '#fff2d6', fog: false }, glowMats);
  const lampGeo = mergeGeometries(lamps.map(p => { const g = new THREE.BoxGeometry(.5, .08, .28); g.translate(p.x, p.y, p.z); return g; }));
  group.add(new THREE.Mesh(lampGeo, lampHead));
  const poolTex = canvas(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,.75)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  const poolMat = basic({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, litMats);
  group.add(new THREE.Mesh(mergeGeometries(lamps.map(p => { const g = new THREE.PlaneGeometry(7, 7); g.rotateX(-Math.PI / 2); g.translate(p.x, STREET + .03, p.z + .5); return g; })), poolMat));
  const CARS = ['#e9e9e6', '#1d1f22', '#a7abb0', '#2b3f66', '#8e2a24', '#5d6166', '#e9e9e6', '#c9c2b4'];
  for (let x = -47.5, i = 0; x < 50; x += 5 * (1 + Math.floor(rnd() * 2)), i++) {
    if (rnd() < .25 || (x > CROSS[0] - 3 && x < CROSS[1] + 3)) continue;
    const z = FAR_KERB + 1.05, col = CARS[i % CARS.length], L = 4.4, ry = (rnd() - .5) * .04;
    solids.push(box(L, .75, 1.8, x, STREET + .62, z, col, ry));
    const cab = new THREE.BoxGeometry(L * .55, .6, 1.62), p = cab.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setX(k, p.getX(k) * .78);
    cab.rotateY(ry); cab.translate(x - .15, STREET + 1.28, z); solids.push(shade(cab, '#2a3036'));
    for (const [dx, dz] of [[-1.35, -.8], [1.35, -.8], [-1.35, .8], [1.35, .8]]) {
      const wh = new THREE.CylinderGeometry(.33, .33, .22, 12); wh.rotateX(Math.PI / 2); wh.translate(x + dx, STREET + .33, z + dz); solids.push(shade(wh, '#161616'));
    }
  }

  /* ---------- further off: apartment towers, then Namsan ---------- */
  const aptTex = canvas(256, 512, (g, w, h) => {   // white blocks with glazed balcony bands, the Seoul look
    g.fillStyle = '#e6e2da'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = '#7e8c99'; g.fillRect(4, y + 5, w - 8, 8); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(4, y + 5, w - 8, 1);
      for (let x = 4; x < w; x += 22) { g.fillStyle = '#d9d4ca'; g.fillRect(x, y + 5, 2, 8); } }
  });
  aptTex.wrapS = aptTex.wrapT = THREE.RepeatWrapping;
  const aptLit = canvas(256, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 16) for (let x = 4; x < w - 22; x += 22) if (rnd() < .4) { g.fillStyle = pick(['#ffd08a', '#ffe6b8', '#fff3dc', '#d6e4ff']); g.fillRect(x + 2, y + 5, 20, 8); }
  });
  aptLit.wrapS = aptLit.wrapT = THREE.RepeatWrapping;
  const aptGeo = [], aptLitGeo = [];
  for (let i = 0; i < 16; i++) {
    const w = 14 + rnd() * 8, h = 42 + rnd() * 26, z = -70 - rnd() * 45, x = -150 + i * 19 + rnd() * 6, d = 12;
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, STREET + h / 2, z);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 22 + i * .37, uv.getY(k) * h / 44);
    aptGeo.push(g);
    const f = new THREE.PlaneGeometry(w, h); const fu = f.attributes.uv; for (let k = 0; k < fu.count; k++) fu.setXY(k, fu.getX(k) * w / 22 + i * .37, fu.getY(k) * h / 44);
    f.translate(x, STREET + h / 2, z + d / 2 + .05); aptLitGeo.push(f);
  }
  group.add(new THREE.Mesh(mergeGeometries(aptGeo), basic({ map: aptTex, color: '#ffffff' })));
  group.add(new THREE.Mesh(mergeGeometries(aptLitGeo), basic({ map: aptLit, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, litMats)));
  const ridge = (z, base, amp, col, seedOff) => {
    const sh = new THREE.Shape(); sh.moveTo(-900, STREET - 5);
    for (let x = -900; x <= 900; x += 15) sh.lineTo(x, STREET + base + amp * (.55 + .3 * Math.sin(x * .004 + seedOff) + .15 * Math.sin(x * .013 + seedOff * 2)));
    sh.lineTo(900, STREET - 5);
    const g = new THREE.ShapeGeometry(sh); g.translate(0, 0, z);
    group.add(new THREE.Mesh(g, basic({ color: col })));
  };
  ridge(-800, 40, 110, '#8798ab', 2.1);
  ridge(-600, 20, 70, '#56685a', .4);                                     // Namsan's ridge
  const TZ = -599, towerX = -130, towerBase = STREET + 20 + 70 * (.55 + .3 * Math.sin(towerX * .004 + .4) + .15 * Math.sin(towerX * .013 + .8)) - 1;
  solids.push(cyl(1.0, 1.6, 14, towerX, towerBase + 7, TZ, '#d9d6cf', 10));
  solids.push(cyl(2.6, 2.2, 3, towerX, towerBase + 15.5, TZ, '#b9b6af', 16));
  solids.push(cyl(.35, .6, 13, towerX, towerBase + 23.5, TZ, '#e4e0d8', 8));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.8, 10, 8), basic({ color: '#ff5a4a', fog: false }, glowMats)); beacon.position.set(towerX, towerBase + 30.5, TZ + 1); group.add(beacon);
  const podLit = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.25, 1.2, 16, 1, true), basic({ color: '#ffe0a8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, litMats));
  podLit.position.set(towerX, towerBase + 15.8, TZ); group.add(podLit);

  const solidMesh = new THREE.Mesh(mergeGeometries(solids), basic({ vertexColors: true })); group.add(solidMesh);
  const tint = new THREE.Color(), cA = new THREE.Color();

  return {
    group,
    // env: day 0..1, darkness 0..1, gray (overcast) 0..1, golden 0..1, flash 0..1 (lightning), haze: the sky's low colour
    update({ day, darkness, gray, golden, flash = 0 }) {
      tint.set('#1a2133').lerp(cA.set('#ffffff'), day);
      tint.lerp(cA.set('#ffc999'), Math.min(1, golden) * .3 * day);
      tint.lerp(cA.set('#9da4ac').multiplyScalar(.5 + .5 * day), gray * .45);
      tint.addScalar(flash * .4);
      dayMats.forEach(m => m.color.copy(m.userData.base).multiply(tint));
      const on = smooth(.25, .8, darkness);
      litMats.forEach(m => { m.opacity = on; });
      glowMats.forEach(m => { m.color.set(m === lampHead ? '#fff2d6' : '#ff5a4a').multiplyScalar(.35 + 2.2 * on); });
      beacon.visible = on > .2;
    },
  };
}
