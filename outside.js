// The far part of the view out of the window: apartment towers, the ridges and Namsan with its tower, and the pools
// the street lamps throw at night. The street and the row across it are baked in Blender (blender/outside.py,
// outside.glb); these are far and hazy enough to stay simple.
// Everything here is unlit (MeshBasicMaterial): shading lives in vertex colours and canvas textures, and update()
// tints it for the time of day and the weather. A real-time light would also land on the room, whose light is baked.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STREET = -8;                 // street level
const FACADE = -18;                // front of the row across the street
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildOutside(scene, { phone = false, seed = 11, lamps = [] } = {}) {
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

  /* ---------- lamp light on the street at night (lamps: [x, y, z] of the heads, from the bake's manifest) ---------- */
  if (lamps.length) {
    const poolTex = canvas(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,.75)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    const poolMat = basic({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, litMats);
    group.add(new THREE.Mesh(mergeGeometries(lamps.map(([x, , z]) => { const g = new THREE.PlaneGeometry(7, 7); g.rotateX(-Math.PI / 2); g.translate(x, STREET + .17, z - .4); return g; })), poolMat));
  }

  /* ---------- further off: apartment towers, then Namsan ---------- */
  const aptTex = canvas(256, 512, (g, w, h) => {   // cream blocks: a glazed balcony per flat, stair cores between
    g.fillStyle = '#ddd6c8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 44) {
      if (x % 176 === 132) { g.fillStyle = '#c9c1b2'; g.fillRect(x + 8, y, 28, 16); g.fillStyle = '#9aa3a8'; g.fillRect(x + 18, y + 6, 8, 6); continue; }   // stair core
      const v = 120 + Math.floor(rnd() * 30); g.fillStyle = `rgb(${v - 8},${v + 2},${v + 12})`; g.fillRect(x + 3, y + 5, 38, 8);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 3, y + 5, 38, 1);
      g.fillStyle = '#d2cbbd'; g.fillRect(x + 21, y + 5, 2, 8);
    }
    g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < h; y += 16) g.fillRect(0, y + 13, w, 3);
  });
  aptTex.wrapS = aptTex.wrapT = THREE.RepeatWrapping;
  const aptLit = canvas(256, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 44) if (x % 176 !== 132 && rnd() < .42) { g.fillStyle = pick(['#ffd08a', '#ffe6b8', '#fff3dc', '#d6e4ff']); g.fillRect(x + 3, y + 5, 38, 8); }
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
    group.add(new THREE.Mesh(g, basic({ color: col, fog: false })));   // pre-hazed colour: linear fog would wipe them out
  };
  ridge(-800, 40, 110, '#a4b0bd', 2.1);
  ridge(-600, 20, 70, '#7e8b86', .4);                                     // Namsan's ridge
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
    tinted: m => { m.userData.base = m.color.clone(); dayMats.push(m); },   // another unlit material to tint with the day
    // env: day 0..1, darkness 0..1, gray (overcast) 0..1, golden 0..1, flash 0..1 (lightning), haze: the sky's low colour
    update({ day, darkness, gray, golden, flash = 0, exposure = 1 }) {
      tint.set('#1a2133').lerp(cA.set('#ffffff'), day);
      tint.lerp(cA.set('#ffc999'), Math.min(1, golden) * .3 * day);
      tint.lerp(cA.set('#9da4ac').multiplyScalar(.5 + .5 * day), gray * .45);
      tint.addScalar(flash * .4);
      tint.multiplyScalar(1.5 / exposure);   // unlit colours still go through the room's exposure: undo most of it
      dayMats.forEach(m => m.color.copy(m.userData.base).multiply(tint));
      const on = smooth(.25, .8, darkness);
      litMats.forEach(m => { m.opacity = on; });
      glowMats.forEach(m => { m.color.set('#ff5a4a').multiplyScalar(.35 + 2.2 * on); });
      beacon.visible = on > .2;
    },
  };
}
