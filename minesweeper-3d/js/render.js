/* 지뢰 큐브 — WebGL2 렌더러.
   닫힌 칸은 인스턴싱한 정육면체, 열린 숫자 칸은 항상 카메라를 보는 원형 배지(어느 각도에서도 읽힘)로 그린다. */
(function (root) {
  'use strict';
  var MS = root.MS = root.MS || {};

  // ---------- 작은 벡터·행렬 도구 ----------
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function persp(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(e, t, u) {
    var z = norm(sub(e, t)), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function parseColor(s) {
    s = (s || '').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { var v = parseInt(m[1], 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; }
    m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) { var p = m[1].split(/[ ,/]+/).map(parseFloat); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
    return [0.5, 0.5, 0.5];
  }
  MS.parseColor = parseColor;

  // ---------- 셰이더 ----------
  var CUBE_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;',
    'layout(location=2) in vec4 iOff; layout(location=3) in vec4 iCol; layout(location=4) in vec2 iMode;',
    'uniform mat4 uVP;',
    'out vec3 vLocal; out vec3 vNor; out vec3 vCol; out float vEm; out float vMode; out float vAlpha; out vec3 vWorld;',
    'void main(){',
    '  vec3 w = iOff.xyz + aPos * iOff.w;',
    '  vLocal = aPos; vNor = aNor; vCol = iCol.rgb; vEm = iCol.a; vMode = iMode.x; vAlpha = iMode.y; vWorld = w;',
    '  gl_Position = uVP * vec4(w, 1.0);',
    '}'].join('\n');
  var CUBE_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vLocal; in vec3 vNor; in vec3 vCol; in float vEm; in float vMode; in float vAlpha; in vec3 vWorld;',
    'uniform vec3 uLight; uniform vec3 uEye; uniform vec3 uEdge; uniform vec3 uStripe; uniform vec3 uMark; uniform vec3 uFog; uniform vec2 uFogRange;',
    'out vec4 o;',
    'void main(){',
    '  vec3 n = normalize(vNor);',
    '  vec3 a = abs(vLocal) * (1.0 - abs(n));',
    '  float d = max(a.x, max(a.y, a.z));',
    '  float w = max(fwidth(d), 0.002);',
    '  if (vMode > 1.5 && vMode < 2.5) {',
    '    float e = smoothstep(0.47 - w * 1.5, 0.47 + w, d);',
    '    if (e < 0.02) discard;',
    '    o = vec4(vCol, vAlpha * e);',
    '    return;',
    '  }',
    '  float diff = 0.5 + 0.5 * max(dot(n, uLight), 0.0);',
    '  vec3 c = vCol * diff;',
    '  if (vMode > 0.5 && vMode < 1.5) {',
    '    float s = fract((vLocal.x + vLocal.y + vLocal.z) * 4.0);',
    '    float st = smoothstep(0.5 - w * 6.0, 0.5 + w * 6.0, s) - smoothstep(0.98 - w * 6.0, 0.98, s);',
    '    c = mix(c, uStripe * diff, st * 0.9);',
    '  }',
    // 임시 깃발: 면마다 4×4 체크무늬 (면의 두 좌표만 써서 면 경계에서 무늬가 깨지지 않게)
    '  if (vMode > 2.5) {',
    '    vec3 q = floor((vLocal + 0.5) * 4.0) * (1.0 - abs(n));',
    '    float cb = mod(q.x + q.y + q.z, 2.0);',
    '    c = mix(c, uMark * diff, cb * 0.8);',
    '  }',
    '  c *= 1.0 - 0.28 * smoothstep(0.30, 0.5, d);',
    '  c = mix(c, uEdge, smoothstep(0.465 - w, 0.465 + w, d) * 0.85);',
    '  c += vEm * vec3(1.0, 0.96, 0.82) * 0.55;',
    '  float f = clamp((distance(vWorld, uEye) - uFogRange.x) / uFogRange.y, 0.0, 1.0);',
    '  o = vec4(mix(c, uFog, f * 0.42), 1.0);',
    '}'].join('\n');
  var BADGE_VS = [
    '#version 300 es',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec4 iPos; layout(location=2) in vec4 iCol; layout(location=3) in vec4 iBg;',
    'uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uGrid;',
    'out vec2 vUV; out vec3 vCol; out vec4 vBg; out vec3 vWorld;',
    'void main(){',
    '  vec3 w = iPos.xyz + (uRight * aCorner.x + uUp * aCorner.y) * iPos.w;',
    '  float t = iCol.w;',
    '  vec2 cell = vec2(mod(t, uGrid.x), floor(t / uGrid.x));',
    '  vUV = (cell + vec2(aCorner.x * 0.5 + 0.5, 0.5 - aCorner.y * 0.5)) / uGrid;',
    '  vCol = iCol.rgb; vBg = iBg; vWorld = w;',
    '  gl_Position = uVP * vec4(w, 1.0);',
    '}'].join('\n');
  var BADGE_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV; in vec3 vCol; in vec4 vBg; in vec3 vWorld;',
    'uniform sampler2D uTex; uniform vec3 uEye; uniform vec3 uFog; uniform vec2 uFogRange;',
    'out vec4 o;',
    'void main(){',
    '  vec4 t = texture(uTex, vUV);',
    '  vec3 c = mix(vBg.rgb, vCol, clamp(max(t.r, t.b), 0.0, 1.0));',
    '  float a = t.g * vBg.a;',
    '  if (a < 0.03) discard;',
    '  float f = clamp((distance(vWorld, uEye) - uFogRange.x) / uFogRange.y, 0.0, 1.0);',
    '  o = vec4(mix(c, uFog, f * 0.3), a);',
    '}'].join('\n');
  var LINE_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol;',
    'uniform mat4 uVP; out vec4 vCol;',
    'void main(){ vCol = aCol; gl_Position = uVP * vec4(aPos, 1.0); }'].join('\n');
  var LINE_FS = [
    '#version 300 es',
    'precision highp float; in vec4 vCol; out vec4 o;',
    'void main(){ o = vCol; }'].join('\n');

  function compile(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, cnt = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < cnt; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  // 정육면체 36개 정점 (위치 + 법선)
  var CUBE = (function () {
    var faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
    ], out = [];
    faces.forEach(function (f) {
      var nrm = f[0], u = f[1], v = f[2];
      var corner = function (su, sv) {
        return [nrm[0] * 0.5 + u[0] * su * 0.5 + v[0] * sv * 0.5, nrm[1] * 0.5 + u[1] * su * 0.5 + v[1] * sv * 0.5, nrm[2] * 0.5 + u[2] * su * 0.5 + v[2] * sv * 0.5];
      };
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        var p = corner(c[0], c[1]);
        out.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2]);
      });
    });
    return new Float32Array(out);
  })();

  // 타일 1~80은 숫자(4D는 이웃이 80칸), 그 뒤는 아이콘
  var TILE = { flag: 81, mine: 82, cross: 83 };
  var GRID = [16, 6];
  var W_GAP = 2.4;   // 4D에서 W 큐브 사이 간격(칸 단위)
  var NUM_PICK = 0.16;   // 숫자 배지(반지름 0.36)에서 클릭을 받는 가운데 구의 반지름 — 숫자 글자 크기 정도

  // 배지 아틀라스: R=글자/아이콘, G=원판, B=테두리 고리. 셰이더에서 색을 입힌다.
  function buildAtlas(fontFamily) {
    var T = 128, cv = document.createElement('canvas');
    cv.width = T * GRID[0]; cv.height = T * GRID[1];
    var c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'lighter';
    for (var t = 1; t < GRID[0] * GRID[1]; t++) {
      var ox = (t % GRID[0]) * T + T / 2, oy = Math.floor(t / GRID[0]) * T + T / 2;
      c.fillStyle = 'rgb(0,255,0)';
      c.beginPath(); c.arc(ox, oy, 56, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgb(0,0,255)'; c.lineWidth = 7;
      c.beginPath(); c.arc(ox, oy, 51, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgb(255,0,0)'; c.strokeStyle = 'rgb(255,0,0)';
      if (t <= 80) {
        var txt = String(t);
        c.font = '800 ' + (txt.length > 1 ? 60 : 74) + 'px ' + fontFamily;
        c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        var mtr = c.measureText(txt);
        var asc = mtr.actualBoundingBoxAscent || 52, desc = mtr.actualBoundingBoxDescent || 0;
        c.fillText(txt, ox, oy + (asc - desc) / 2);
      } else if (t === TILE.flag) {
        c.fillRect(ox - 18, oy - 30, 7, 62);
        c.beginPath(); c.moveTo(ox - 11, oy - 30); c.lineTo(ox + 28, oy - 16); c.lineTo(ox - 11, oy - 2); c.closePath(); c.fill();
      } else if (t === TILE.mine) {
        c.beginPath(); c.arc(ox, oy, 22, 0, Math.PI * 2); c.fill();
        c.lineWidth = 7; c.lineCap = 'round';
        for (var k = 0; k < 8; k++) {
          var ang = k * Math.PI / 4;
          c.beginPath(); c.moveTo(ox + Math.cos(ang) * 18, oy + Math.sin(ang) * 18);
          c.lineTo(ox + Math.cos(ang) * 36, oy + Math.sin(ang) * 36); c.stroke();
        }
      } else if (t === TILE.cross) {
        c.lineWidth = 12; c.lineCap = 'round';
        c.beginPath(); c.moveTo(ox - 24, oy - 24); c.lineTo(ox + 24, oy + 24);
        c.moveTo(ox + 24, oy - 24); c.lineTo(ox - 24, oy + 24); c.stroke();
      }
    }
    return cv;
  }

  function Renderer(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    var gl = null;
    try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false }); } catch (e) { gl = null; }
    this.ok = !!gl;
    this.gl = gl;
    this.opts = {
      axis: 1, slice: 'all', layer: 0, explode: 0, hideSettled: true, hideNumbers: false, hideFlags: false, neighbors: true, dim: true, autoRotate: false,
      wView: 'all', wFocus: 0   // 4D: 모든 W 큐브 / 고른 W와 양옆(w−1, w+1)만
    };
    this.cam = { yaw: 0.65, pitch: 0.5, dist: 12, tyaw: 0.65, tpitch: 0.5, tdist: 12, tgt: [0, 0, 0], ttgt: [0, 0, 0], fov: 40 * Math.PI / 180 };
    this.game = null;
    this.hover = -1;
    this.hint = null;
    this.gap = 0;
    this.revealAt = null;
    this.shakeUntil = 0;
    this.labels = {};
    this.colors = null;
    this.raf = 0;
    this.lastT = 0;
    this.idleSince = 0;
    this.move = [0, 0, 0];
    this.linkSel = -1;
    this.onFrame = null;
    if (!gl) return;
    var self = this;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    canvas.addEventListener('webglcontextrestored', function () { self.lost = false; self.initGL(); self.invalidate(); });
    this.initGL();
  }
  MS.Renderer = Renderer;

  Renderer.prototype.initGL = function () {
    var gl = this.gl;
    this.pCube = compile(gl, CUBE_VS, CUBE_FS);
    this.pBadge = compile(gl, BADGE_VS, BADGE_FS);
    this.pLine = compile(gl, LINE_VS, LINE_FS);
    this.msaa = !!(gl.getContextAttributes() || {}).antialias;

    var cubeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    var self = this;
    function cubeVAO() {
      var vao = gl.createVertexArray(), inst = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      var st = 40;
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 16); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, st, 32); gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
      return { vao: vao, buf: inst };
    }
    this.solid = cubeVAO();
    this.ghost = cubeVAO();

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var bvao = gl.createVertexArray(), binst = gl.createBuffer();
    gl.bindVertexArray(bvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, binst);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 48, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 48, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 48, 32); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.badge = { vao: bvao, buf: binst };

    var lvao = gl.createVertexArray(), lbuf = gl.createBuffer();
    gl.bindVertexArray(lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    this.lines = { vao: lvao, buf: lbuf, count: 0 };

    this.tex = gl.createTexture();
    this.uploadAtlas(self.fontFamily || 'monospace');
  };

  Renderer.prototype.uploadAtlas = function (fontFamily) {
    this.fontFamily = fontFamily;
    if (!this.ok || !this.gl) return;
    var gl = this.gl, cv = buildAtlas(fontFamily);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.invalidate();
  };

  Renderer.prototype.setTheme = function (css) {
    var g = function (name) { return parseColor(css.getPropertyValue(name)); };
    var nums = [], grp = [];
    for (var k = 1; k <= 9; k++) nums.push(g('--n' + k));
    for (k = 1; k <= MS.GROUP_COLORS; k++) grp.push(g('--grp' + k));
    this.colors = {
      stage: g('--stage'), cube: g('--cube'), flag: g('--accent'), stripe: g('--stripe'), edge: g('--edge'),
      hot: g('--hot'), nb: g('--nb'), good: g('--good'), bad: g('--bad'), badge: g('--badge'), line: g('--line-3d'),
      ink: g('--ink'), axx: g('--axx'), axy: g('--axy'), axz: g('--axz'), nums: nums, grp: grp
    };
    this.invalidate();
  };

  Renderer.prototype.setGame = function (game, keepView) {
    this.game = game;
    this.revealAt = new Float64Array(game.n);
    this.nbMark = new Uint8Array(game.n);
    this.hover = -1;
    this.hint = null;
    this.gap = this.opts.explode;
    this.layout();
    if (!keepView) this.resetView(true);
    this.invalidate();
  };

  Renderer.prototype.setOptions = function (o) {
    var key = function (p) { return p.axis + '|' + p.wView + '|' + p.wFocus; }, before = key(this.opts);
    for (var k in o) this.opts[k] = o[k];
    if (this.game) {
      var N = [this.game.X, this.game.Y, this.game.Z][this.opts.axis];
      this.opts.layer = Math.max(0, Math.min(N - 1, this.opts.layer | 0));
      this.opts.wFocus = Math.max(0, Math.min(this.game.W - 1, this.opts.wFocus | 0));
      if (key(this.opts) !== before) this.layout();
    }
    this.invalidate();
  };

  // 4D에서 화면에 놓을 W 범위: 모두, 또는 고른 W와 양옆(이웃 80칸이 걸치는 세 큐브)
  Renderer.prototype.wRange = function () {
    var g = this.game, W = g ? g.W : 1, o = this.opts;
    if (W <= 1 || o.wView !== 'near') return [0, W - 1];
    var f = Math.max(0, Math.min(W - 1, o.wFocus | 0));
    return [Math.max(0, f - 1), Math.min(W - 1, f + 1)];
  };

  // 칸의 세계 좌표. 펼치기(gap)는 선택한 축 방향으로 층 사이를 벌린다.
  // 4D는 W마다 3D 큐브 하나를 만들어 화면의 긴 쪽(가로면 X, 세로로 긴 화면이면 Y) 방향으로 나란히 놓는다.
  Renderer.prototype.layout = function () {
    var g = this.game;
    if (!g) return;
    var dims = [g.X, g.Y, g.Z], ax = this.opts.axis, gap = this.gap;
    var ch = dims.map(function (d, a) { return (d - 1) / 2 * (a === ax ? 1 + gap : 1) + 0.5; });
    var wr = this.wRange(), count = wr[1] - wr[0] + 1;
    var aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    var wd = g.W > 1 && aspect < 0.8 ? 1 : 0;
    var slot = ch[wd] * 2 + W_GAP, centers = [];
    for (var w = wr[0]; w <= wr[1]; w++) {
      var cc = [0, 0, 0];
      cc[wd] = (w - wr[0] - (count - 1) / 2) * slot;
      centers[w] = cc;
    }
    var pos = this.pos = new Float32Array(g.n * 3);
    var wOut = this.wOut = new Uint8Array(g.n);
    for (var i = 0; i < g.n; i++) {
      var c = g.xyz(i), ce = centers[c[3]];
      if (!ce) { wOut[i] = 1; continue; }
      for (var a = 0; a < 3; a++) {
        var v = c[a] - (dims[a] - 1) / 2;
        if (a === ax) v *= 1 + gap;
        pos[i * 3 + a] = v + ce[a];
      }
    }
    var half = ch.slice();
    half[wd] = (count * slot - W_GAP) / 2;
    var oldR = this.radius && this.layoutGame === g && this.wDir === wd ? this.radius : 0;
    this.cubeHalf = ch;
    this.centers = centers;
    this.wr = wr;
    this.wDir = wd;
    this.half = half;
    this.radius = Math.hypot(half[0], half[1], half[2]);
    this.layoutGame = g;
    // 펼치기나 W 범위 때문에 판이 커지거나 작아지면 카메라도 같은 비율로 움직여 화면 안에 들어오게 한다.
    if (oldR && oldR !== this.radius) { var k = this.radius / oldR; this.cam.dist *= k; this.cam.tdist *= k; }
  };

  Renderer.prototype.resetView = function (instant) {
    var c = this.cam, four = this.game && this.game.W > 1;
    // 4D 큐브 줄은 정면에 가깝게 봐야 서로 덜 가린다.
    c.tyaw = four ? (this.wDir === 1 ? 0.55 : 0.28) : 0.62;
    c.tpitch = four ? 0.42 : 0.52;
    c.ttgt = [0, 0, 0];
    c.tdist = this.fitDistance(c.tyaw, c.tpitch);
    // 지금 화면 비율로 맞췄으니, 다음 프레임에서 비율 변화로 또 고치지 않게 기록해 둔다.
    this.lastAspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    if (instant) { c.yaw = c.tyaw; c.pitch = c.tpitch; c.dist = c.tdist; c.tgt = c.ttgt.slice(); }
    this.invalidate();
  };

  // 판을 감싼 상자의 꼭짓점 8개가 모두 화면에 들어오는 카메라 거리
  Renderer.prototype.fitDistance = function (yaw, pitch, aspect) {
    var h = this.half || [3, 3, 3], c = this.cam;
    if (yaw == null) { yaw = c.tyaw; pitch = c.tpitch; }
    if (!aspect) aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    var ty = Math.tan(c.fov / 2), tx = ty * aspect;
    var eye = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
    var fwd = [-eye[0], -eye[1], -eye[2]];
    var right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd), d = 0;
    for (var k = 0; k < 8; k++) {
      var p = [k & 1 ? h[0] : -h[0], k & 2 ? h[1] : -h[1], k & 4 ? h[2] : -h[2]];
      d = Math.max(d, Math.abs(dot(p, right)) / tx - dot(p, fwd), Math.abs(dot(p, up)) / ty - dot(p, fwd));
    }
    return d * 1.08;
  };

  Renderer.prototype.rotate = function (dx, dy) {
    var c = this.cam;
    c.tyaw -= dx * 0.0085;
    c.tpitch = Math.max(-1.5, Math.min(1.5, c.tpitch + dy * 0.0085));
    this.idleSince = performance.now();
    this.invalidate();
  };
  Renderer.prototype.zoom = function (factor) {
    var c = this.cam, fit = this.fitDistance();
    c.tdist = Math.max(fit * 0.25, Math.min(fit * 3, c.tdist * factor));
    this.invalidate();
  };
  Renderer.prototype.pan = function (dx, dy) {
    var b = this.basis(), c = this.cam, k = c.dist * 0.0017;
    for (var a = 0; a < 3; a++) c.ttgt[a] += (-b.right[a] * dx + b.up[a] * dy) * k;
    this.clampTarget();
    this.invalidate();
  };
  // 회전 중심이 판을 감싼 상자 밖으로 나가지 않게 한다. W로 계속 들어가도 판 맞은편 면에서 멈춰, 판을 등지지 않는다.
  Renderer.prototype.clampTarget = function () {
    var c = this.cam, h = this.half || [3, 3, 3];
    for (var a = 0; a < 3; a++) c.ttgt[a] = Math.max(-h[a], Math.min(h[a], c.ttgt[a]));
  };
  // 키보드 이동 방향: x 오른쪽, y 위, z 앞. 키를 누르고 있는 동안 frame()이 이 방향으로 계속 옮긴다.
  Renderer.prototype.setMove = function (x, y, z) {
    var m = this.move;
    m[0] = x; m[1] = y; m[2] = z;
    if (x || y || z) this.invalidate();
  };

  Renderer.prototype.basis = function () {
    var c = this.cam;
    var eye = [c.tgt[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.tgt[1] + c.dist * Math.sin(c.pitch), c.tgt[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    var fwd = norm(sub(c.tgt, eye));
    var right = norm(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);
    return { eye: eye, fwd: fwd, right: right, up: up };
  };

  Renderer.prototype.setHover = function (i) {
    if (i === this.hover) return;
    this.hover = i;
    this.invalidate();
  };

  // 묶으려고 고른 임시 깃발 칸(-1이면 없음)
  Renderer.prototype.setLinkSel = function (i) {
    if (i === this.linkSel) return;
    this.linkSel = i;
    this.invalidate();
  };

  // keep: 지울 때까지 계속 표시(오늘의 판 시작 칸)
  Renderer.prototype.setHint = function (cell, type, keep) {
    this.hint = cell == null ? null : { cell: cell, type: type, until: keep ? Infinity : performance.now() + 6000 };
    this.invalidate();
  };

  Renderer.prototype.animateReveal = function (res) {
    if (!res || !res.cells || !this.revealAt) return;
    var t = performance.now(), many = res.cells.length > 60;
    for (var k = 0; k < res.cells.length; k++) this.revealAt[res.cells[k]] = t + res.depth[k] * (many ? 28 : 45);
    this.invalidate();
  };

  Renderer.prototype.shake = function () { this.shakeUntil = performance.now() + 450; this.invalidate(); };

  Renderer.prototype.visibleLayer = function (i) {
    var o = this.opts;
    if (o.slice === 'all') return true;
    var c = this.game.xyz(i)[o.axis];
    return o.slice === 'one' ? c === o.layer : c <= o.layer;
  };

  // 칸 상태 → 인스턴스 데이터. 상태나 옵션이 바뀌거나 애니메이션 중일 때 매 프레임 다시 만든다(12³까지 충분히 빠름).
  Renderer.prototype.rebuild = function (now) {
    var g = this.game, o = this.opts, C = this.colors, n = g.n, pos = this.pos;
    if (!this.sArr || this.sArr.length < n * 10) {
      this.sArr = new Float32Array(n * 10);
      this.gArr = new Float32Array(n * 10);
      this.bArr = new Float32Array(n * 12);
    }
    var S = this.sArr, Gh = this.gArr, B = this.bArr, wOut = this.wOut;
    var picks = this.picks = [];
    var ns = 0, ng = 0, nb = 0, animating = false;
    var hov = this.hover, mark = this.nbMark;
    // 깃발 윤곽만 모드에서 숫자를 가리키면 그 숫자 둘레의 깃발은 색을 채워 보여 준다(강조 설정과 상관없이).
    var peek = hov >= 0 && o.hideFlags && g.open[hov] && g.num[hov] > 0;
    var nbOn = hov >= 0 && o.neighbors;
    mark.fill(0);
    if (nbOn || peek) {
      for (var k = g.nbStart[hov]; k < g.nbStart[hov + 1]; k++) mark[g.nbList[k]] = 1;
    }
    var focus = nbOn && o.dim;
    var lost = g.state === 'lost', dims = [g.X, g.Y, g.Z], NA = dims[o.axis];
    var hint = this.hint && now < this.hint.until ? this.hint : null;
    var pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
    var CUBE_S = 0.86;

    function pushCube(arr, idx, x, y, z, s, col, em, mode, alpha) {
      var b = idx * 10;
      arr[b] = x; arr[b + 1] = y; arr[b + 2] = z; arr[b + 3] = s;
      arr[b + 4] = col[0]; arr[b + 5] = col[1]; arr[b + 6] = col[2]; arr[b + 7] = em;
      arr[b + 8] = mode; arr[b + 9] = alpha;
    }
    function pushBadge(x, y, z, size, col, tile, bg, alpha) {
      var b = nb * 12;
      B[b] = x; B[b + 1] = y; B[b + 2] = z; B[b + 3] = size;
      B[b + 4] = col[0]; B[b + 5] = col[1]; B[b + 6] = col[2]; B[b + 7] = tile;
      B[b + 8] = bg[0]; B[b + 9] = bg[1]; B[b + 10] = bg[2]; B[b + 11] = alpha;
      nb++;
    }

    for (var i = 0; i < n; i++) {
      if (wOut[i]) continue;
      var x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      var vis = this.visibleLayer(i);
      var layer = g.xyz(i)[o.axis];
      var isHint = hint && hint.cell === i;
      var related = i === hov || mark[i];
      var dimmed = focus && !related;
      var t0 = this.revealAt[i], rp = 1;
      if (t0) {
        rp = (now - t0) / 200;
        if (rp >= 1.6) { this.revealAt[i] = 0; rp = 1.6; } else animating = true;
      }

      if (g.open[i] || (lost && (g.mine[i] ? !g.flag[i] : g.flag[i]))) {
        // 열리는 중인 정육면체(줄어드는 애니메이션)
        if (t0 && rp < 1 && vis) {
          var sc = rp < 0 ? CUBE_S : CUBE_S * (1 - easeIn(rp));
          if (sc > 0.01) pushCube(S, ns++, x, y, z, sc, layerTint(C.cube, layer, NA), 0, 0, 1);
        }
        if (!vis) continue;
        if (g.mine[i] && g.open[i]) { pushBadge(x, y, z, 0.4, [1, 1, 1], TILE.mine, C.bad, 1); continue; }
        if (lost && g.mine[i]) { pushBadge(x, y, z, 0.36, C.ink, TILE.mine, C.badge, 1); continue; }
        if (lost && g.flag[i]) { pushBadge(x, y, z, 0.36, C.bad, TILE.cross, C.badge, 1); continue; }
        var num = g.num[i];
        if (!num || o.hideNumbers) continue;
        var settled = g.isSettled(i);
        if (o.hideSettled && settled && i !== hov && !isHint) continue;
        // 숫자는 배지 가운데 작은 구(반지름 NUM_PICK)만 클릭 대상이다. 배지 가장자리는 통과해 뒤쪽 칸이 눌린다.
        // 애니메이션과 상관없이 바로 대상이 되어야 숫자 한가운데를 누른 클릭이 뒤로 새지 않는다.
        picks.push(i, x, y, z, -NUM_PICK);
        var pop = t0 ? Math.max(0, Math.min(1, (rp - 0.5) / 0.9)) : 1;
        if (t0 && pop <= 0) continue;
        var size = 0.36 * easeOutBack(pop);
        var col = C.nums[Math.min(num, 9) - 1], bg = C.badge;
        if (settled) { col = mix(col, C.badge, 0.45); }
        if (i === hov) { bg = mix(C.badge, C.hot, 0.55); size *= 1.14; }
        else if (nbOn && mark[i]) bg = mix(C.badge, C.nb, 0.28);
        if (dimmed) { col = mix(col, C.stage, 0.55); bg = mix(bg, C.stage, 0.55); }
        pushBadge(x, y, z, size, col, num, bg, 1);
        continue;
      }

      // 닫힌 칸
      var flagged = !!g.flag[i];
      var thin = flagged && o.hideFlags;
      if (!vis || (thin && !(peek && mark[i]))) {
        var gc = flagged ? C.flag : C.line;
        pushCube(Gh, ng++, x, y, z, CUBE_S, gc, 0, 2, flagged ? 0.5 : 0.22);
        continue;
      }
      var base = flagged ? C.flag : layerTint(C.cube, layer, NA), em = 0;
      // 묶인 임시 깃발은 묶음 색 체크무늬(주황 칸과 번갈아)
      var gid = !flagged && g.mark[i] ? g.grp[i] : 0;
      if (gid) base = C.grp[g.grpColor[gid] || 0];
      if (i === hov) { base = mix(base, C.hot, flagged ? 0.35 : 0.7); em = 0.12; }
      else if (nbOn && mark[i]) base = mix(base, C.nb, flagged || gid ? 0.25 : 0.55);
      else if (dimmed) base = mix(base, C.stage, 0.45);
      if (i === this.linkSel) {
        base = mix(base, C.hot, 0.3);
        em = 0.12 + 0.3 * pulse;
        animating = true;
      }
      if (isHint) {
        var hc = hint.type === 'mine' ? C.flag : (hint.type === 'badflag' ? C.bad : C.good);
        base = mix(base, hc, 0.75);
        em = 0.1 + 0.35 * pulse;
        animating = true;
      }
      if (g.state === 'won' && flagged) em = 0.05;
      // 모드: 0 보통, 1 깃발 줄무늬, 3 임시 깃발 체크무늬
      pushCube(S, ns++, x, y, z, CUBE_S, base, em, flagged ? 1 : (g.mark[i] ? 3 : 0), 1);
      // 잠깐 채워 보인 깃발은 클릭을 받지 않는다. 받으면 가리킨 숫자를 가려 강조가 깜빡인다.
      if (!thin) picks.push(i, x, y, z, CUBE_S / 2);
    }
    if (hint) animating = true;

    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solid.buf);
    gl.bufferData(gl.ARRAY_BUFFER, S.subarray(0, ns * 10), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghost.buf);
    gl.bufferData(gl.ARRAY_BUFFER, Gh.subarray(0, ng * 10), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.badge.buf);
    gl.bufferData(gl.ARRAY_BUFFER, B.subarray(0, nb * 12), gl.DYNAMIC_DRAW);
    this.counts = { solid: ns, ghost: ng, badge: nb };
    this.buildLines();
    return animating;

    function layerTint(c, l, N) { return scale3(c, 0.8 + 0.34 * (N > 1 ? l / (N - 1) : 0.5)); }
  };

  function easeIn(t) { return t * t; }
  function easeOutBack(t) { var s = 1.7; t = t - 1; return t * t * ((s + 1) * t + s) + 1; }

  // 큐브(4D는 W마다 하나) 테두리, 단면 위치 사각형, W 이름표 자리
  Renderer.prototype.buildLines = function () {
    var g = this.game, C = this.colors, o = this.opts, h = this.cubeHalf, v = [], self = this;
    function seg(a, b, col, al) { v.push(a[0], a[1], a[2], col[0], col[1], col[2], al, b[0], b[1], b[2], col[0], col[1], col[2], al); }
    var E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
    var four = g.W > 1, focus = four && o.wView === 'near' ? o.wFocus : -1;
    this.sliceAnchor = null;
    this.wAnchors = [];
    for (var wi = this.wr[0]; wi <= this.wr[1]; wi++) {
      var ce = this.centers[wi];
      var lo = [ce[0] - h[0], ce[1] - h[1], ce[2] - h[2]], hi = [ce[0] + h[0], ce[1] + h[1], ce[2] + h[2]];
      var P = function (i, j, k) { return [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]]; };
      var boxCol = wi === focus ? C.flag : C.line, boxA = wi === focus ? 0.8 : 0.55;
      E.forEach(function (e) { seg(P(e[0], e[1], e[2]), P(e[3], e[4], e[5]), boxCol, boxA); });
      if (four) {
        self.wAnchors.push({ w: wi, p: self.wDir === 1 ? [lo[0] - 0.9, ce[1], ce[2]] : [ce[0], hi[1] + 0.8, ce[2]] });
      }
      if (o.slice !== 'all') {
        var ax = o.axis, dims = [g.X, g.Y, g.Z];
        var c = ce[ax] + (o.layer - (dims[ax] - 1) / 2) * (1 + this.gap);
        var u = (ax + 1) % 3, w = (ax + 2) % 3, pad = 0.12;
        var q = [lo.slice(), lo.slice(), lo.slice(), lo.slice()];
        q[0][u] = lo[u] - pad; q[0][w] = lo[w] - pad;
        q[1] = q[0].slice(); q[1][u] = hi[u] + pad;
        q[2] = q[1].slice(); q[2][w] = hi[w] + pad;
        q[3] = q[0].slice(); q[3][w] = hi[w] + pad;
        for (var k = 0; k < 4; k++) q[k][ax] = c;
        for (k = 0; k < 4; k++) seg(q[k], q[(k + 1) % 4], C.flag, 0.95);
        if (!this.sliceAnchor || wi === this.wr[1]) this.sliceAnchor = q[1];
      }
    }
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lines.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    this.lines.count = v.length / 7;
  };

  Renderer.prototype.invalidate = function () {
    this.stale = true;
    if (this.raf || !this.ok) return;
    var self = this;
    this.raf = requestAnimationFrame(function (t) { self.raf = 0; self.frame(t); });
  };

  Renderer.prototype.resize = function () {
    var cv = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  };

  Renderer.prototype.frame = function (t) {
    if (!this.ok || this.lost || !this.game || !this.colors) return;
    // 3D 화면이 숨겨져 있으면(층별 보기) 그리지 않는다. 1×1로 줄여 그리면 다시 보일 때 그 한 점이 화면 가득 늘어나 보인다.
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
    var dt = Math.min(0.05, this.lastT ? (t - this.lastT) / 1000 : 0.016);
    this.lastT = t;
    var c = this.cam, k = 1 - Math.exp(-dt * 14), moving = false;
    if (this.opts.autoRotate && t - this.idleSince > 1200) { c.tyaw += dt * 0.35; moving = true; }
    var targetGap = this.opts.explode;
    if (Math.abs(this.gap - targetGap) > 0.002) { this.gap += (targetGap - this.gap) * k; moving = true; this.layout(); }
    else if (this.gap !== targetGap) { this.gap = targetGap; this.layout(); }
    // 4D: 화면이 세로로 길어지거나 가로로 넓어지면 W 큐브를 놓는 방향을 바꾼다.
    var asp = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    if (this.game.W > 1 && (asp < 0.8 ? 1 : 0) !== this.wDir) { this.layout(); this.resetView(true); }
    // 화면 비율이 바뀌면(나란히 보기, 창 크기) 같은 비율로 거리를 다시 맞춰 판이 잘리지 않게 한다.
    else if (this.lastAspect && Math.abs(asp / this.lastAspect - 1) > 0.02) {
      var ratio = this.fitDistance(c.tyaw, c.tpitch, asp) / this.fitDistance(c.tyaw, c.tpitch, this.lastAspect);
      c.tdist *= ratio; c.dist *= ratio;
    }
    this.lastAspect = asp;
    // 키보드 이동. 앞(W)은 먼저 회전 중심으로 다가가고, 더 다가갈 수 없으면 중심째 밀고 들어가 판 안쪽까지 간다.
    // 옆(A/D)은 화면 가로, 위아래(E/Q)는 세계의 위아래로 회전 중심을 옮긴다.
    var mv = this.move;
    if (mv[0] || mv[1] || mv[2]) {
      var b = this.basis(), sp = Math.max(3, this.radius) * 0.8 * dt;
      if (mv[2]) {
        var fit = this.fitDistance(), lo = fit * 0.25, nd = c.tdist - mv[2] * sp;
        if (nd < lo) { for (var a = 0; a < 3; a++) c.ttgt[a] += b.fwd[a] * (lo - nd); nd = lo; }
        c.tdist = Math.min(fit * 3, nd);
      }
      for (a = 0; a < 3; a++) c.ttgt[a] += (b.right[a] * mv[0] + (a === 1 ? mv[1] : 0)) * sp;
      this.clampTarget();
      this.idleSince = t;
      moving = true;
    }
    var d = function (a, b) { return Math.abs(a - b); };
    c.yaw += (c.tyaw - c.yaw) * k; c.pitch += (c.tpitch - c.pitch) * k; c.dist += (c.tdist - c.dist) * k;
    for (var a = 0; a < 3; a++) c.tgt[a] += (c.ttgt[a] - c.tgt[a]) * k;
    if (d(c.yaw, c.tyaw) > 1e-4 || d(c.pitch, c.tpitch) > 1e-4 || d(c.dist, c.tdist) > 1e-3 || d(c.tgt[0], c.ttgt[0]) + d(c.tgt[1], c.ttgt[1]) + d(c.tgt[2], c.ttgt[2]) > 1e-3) moving = true;
    var anim = this.draw(t);
    if (this.onFrame) this.onFrame();
    if (moving || anim || t < this.shakeUntil) this.invalidate();
  };

  Renderer.prototype.renderNow = function () { this.frame(performance.now()); };

  Renderer.prototype.matrices = function (t) {
    var b = this.basis(), cv = this.canvas, eye = b.eye.slice();
    if (t < this.shakeUntil) {
      var s = (this.shakeUntil - t) / 450 * 0.18;
      eye[0] += (Math.random() - 0.5) * s; eye[1] += (Math.random() - 0.5) * s; eye[2] += (Math.random() - 0.5) * s;
    }
    var aspect = cv.width / cv.height;
    // 회전 중심을 옮기면 눈과 판 사이 거리가 cam.dist와 달라지므로, 판 중심(원점)까지의 거리로 잡는다.
    var de = this.eyeDist = Math.hypot(eye[0], eye[1], eye[2]);
    var near = Math.max(0.1, de - this.radius * 2.5), far = de + this.radius * 2.5;
    var proj = persp(this.cam.fov, aspect, near, far);
    var view = lookAt(eye, this.cam.tgt, [0, 1, 0]);
    this.vp = mul(proj, view);
    this.eye = eye;
    this.b = b;
    return this.vp;
  };

  Renderer.prototype.draw = function (t) {
    var gl = this.gl, C = this.colors;
    this.resize();
    this.stale = false;
    var anim = this.rebuild(t);
    var vp = this.matrices(t), b = this.b, eye = this.eye;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(C.stage[0], C.stage[1], C.stage[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    var light = norm([b.right[0] * -0.35 + b.up[0] * 0.75 - b.fwd[0] * 0.55, b.right[1] * -0.35 + b.up[1] * 0.75 - b.fwd[1] * 0.55, b.right[2] * -0.35 + b.up[2] * 0.75 - b.fwd[2] * 0.55]);
    var fog = [this.eyeDist - this.radius, Math.max(1, this.radius * 2)];

    // 1) 불투명 정육면체
    var P = this.pCube;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform3fv(P.u.uLight, light);
    gl.uniform3fv(P.u.uEye, eye);
    gl.uniform3fv(P.u.uEdge, C.edge);
    gl.uniform3fv(P.u.uStripe, C.stripe);
    gl.uniform3fv(P.u.uMark, C.flag);
    gl.uniform3fv(P.u.uFog, C.stage);
    gl.uniform2fv(P.u.uFogRange, fog);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    if (this.counts.solid) {
      gl.bindVertexArray(this.solid.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.counts.solid);
    }

    // 2) 숫자 배지 (카메라를 향하는 사각형)
    if (this.counts.badge) {
      var Q = this.pBadge;
      gl.useProgram(Q.p);
      gl.uniformMatrix4fv(Q.u.uVP, false, vp);
      gl.uniform3fv(Q.u.uRight, b.right);
      gl.uniform3fv(Q.u.uUp, b.up);
      gl.uniform2f(Q.u.uGrid, GRID[0], GRID[1]);
      gl.uniform3fv(Q.u.uEye, eye);
      gl.uniform3fv(Q.u.uFog, C.stage);
      gl.uniform2fv(Q.u.uFogRange, fog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(Q.u.uTex, 0);
      if (this.msaa) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      gl.bindVertexArray(this.badge.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.counts.badge);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }

    // 3) 반투명: 단면 밖 칸의 윤곽, 선
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (this.counts.ghost) {
      gl.useProgram(P.p);
      gl.bindVertexArray(this.ghost.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.counts.ghost);
    }
    if (this.lines.count) {
      var L = this.pLine;
      gl.useProgram(L.p);
      gl.uniformMatrix4fv(L.u.uVP, false, vp);
      gl.bindVertexArray(this.lines.vao);
      gl.drawArrays(gl.LINES, 0, this.lines.count);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    this.placeLabels();
    return anim;
  };

  Renderer.prototype.project = function (p) {
    var m = this.vp;
    if (!m) return null;
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    var y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    var w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0.01) return null;
    return { x: (x / w * 0.5 + 0.5) * this.canvas.clientWidth, y: (0.5 - y / w * 0.5) * this.canvas.clientHeight };
  };

  // 오른쪽 아래 방향 표시: 카메라 회전만 반영한 X·Y·Z 양의 방향
  Renderer.prototype.placeLabels = function () {
    if (!this.overlay) return;
    var g = this.labels.gizmo, b = this.b, NS = 'http://www.w3.org/2000/svg';
    if (!g) {
      g = this.labels.gizmo = document.createElementNS(NS, 'svg');
      g.setAttribute('class', 'gizmo');
      g.setAttribute('viewBox', '-40 -40 80 80');
      this.labels.axes = ['x', 'y', 'z'].map(function (k) {
        var line = document.createElementNS(NS, 'line'), text = document.createElementNS(NS, 'text');
        line.setAttribute('class', 'gz-line gz-' + k);
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
        text.setAttribute('class', 'gz-text gz-' + k);
        text.textContent = k.toUpperCase();
        g.appendChild(line); g.appendChild(text);
        return { line: line, text: text };
      });
      this.overlay.appendChild(g);
    }
    var dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], order = [];
    for (var a = 0; a < 3; a++) {
      var d = dirs[a], sx = dot(d, b.right) * 24, sy = -dot(d, b.up) * 24, depth = dot(d, b.fwd);
      var A = this.labels.axes[a];
      A.line.setAttribute('x2', sx.toFixed(1)); A.line.setAttribute('y2', sy.toFixed(1));
      A.text.setAttribute('x', (sx * 1.38).toFixed(1)); A.text.setAttribute('y', (sy * 1.38 + 4).toFixed(1));
      order.push([depth, A]);
    }
    // 화면 안쪽으로 향하는 축을 먼저 그려 겹침 순서를 맞춘다.
    order.sort(function (p, q) { return q[0] - p[0]; }).forEach(function (p) { g.appendChild(p[1].line); g.appendChild(p[1].text); });
    var sl = this.labels.slice;
    if (!sl) {
      sl = this.labels.slice = document.createElement('span');
      sl.className = 'slice-label';
      this.overlay.appendChild(sl);
    }
    var sp = this.sliceAnchor && this.project(this.sliceAnchor);
    sl.hidden = !sp;
    if (sp) {
      var axisName = ['X', 'Y', 'Z'][this.opts.axis];
      sl.textContent = axisName + ' ' + (this.opts.layer + 1) + '층';
      sl.style.transform = 'translate(' + sp.x.toFixed(1) + 'px,' + sp.y.toFixed(1) + 'px) translate(6px,-50%)';
    }
    this.placeLinks(NS);
    // 4D: 큐브마다 W 이름표. 고른 W는 강조한다.
    var pool = this.labels.w || (this.labels.w = []), anchors = this.wAnchors || [], focus = this.opts.wView === 'near' ? this.opts.wFocus : -1;
    for (var k = 0; k < Math.max(pool.length, anchors.length); k++) {
      var el = pool[k];
      if (!el) {
        el = pool[k] = document.createElement('span');
        this.overlay.appendChild(el);
      }
      var an = anchors[k], p = an && this.project(an.p);
      el.hidden = !p;
      if (!p) continue;
      el.className = 'w-label' + (an.w === focus ? ' on' : '');
      el.textContent = 'W' + (an.w + 1);
      el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-50%)';
    }
  };

  // 임시 깃발 묶음: 같은 묶음 칸의 가운데를 묶인 순서대로 잇는 선. 붙어 있는 묶음도 다른 각도에서 헷갈리지 않게
  // 깊이와 상관없이 맨 위에 그린다. 단면 밖 층에 걸친 묶음은 흐리게, 4D에서 안 보이는 W에 걸친 칸은 빼고 잇는다.
  Renderer.prototype.placeLinks = function (NS) {
    var lk = this.labels.links;
    if (!lk) {
      lk = this.labels.links = document.createElementNS(NS, 'svg');
      lk.setAttribute('class', 'links');
      this.overlay.insertBefore(lk, this.overlay.firstChild);
    }
    var g = this.game, pos = this.pos, wOut = this.wOut, self = this, svg = '';
    var at = function (i) { return wOut[i] ? null : self.project([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); };
    var xy = function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); };
    g.groups().forEach(function (gr) {
      var pts = [], far = false;
      gr.cells.forEach(function (c) {
        var p = at(c);
        if (!p) return;
        pts.push(p);
        if (!self.visibleLayer(c)) far = true;
      });
      if (pts.length < 2) return;
      var line = pts.map(xy).join(' '), cl = 'c' + gr.color;
      svg += '<g' + (far ? ' class="far"' : '') + '><polyline class="halo" points="' + line + '"/>' +
        '<polyline class="ln ' + cl + '" points="' + line + '"/>' +
        pts.map(function (p) { return '<circle class="dot ' + cl + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5"/>'; }).join('') + '</g>';
    });
    // 고른 칸에서 마우스를 올린 임시 깃발까지 미리보기 점선
    var s = this.linkSel, h = this.hover;
    if (s >= 0 && h >= 0 && h !== s && g.mark[h] && !g.open[h]) {
      var a = at(s), b = at(h);
      if (a && b) svg += '<line class="pre" x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '"/>';
    }
    if (svg !== this.labels.linksSvg) { this.labels.linksSvg = svg; lk.innerHTML = svg; }
  };

  // 화면 좌표 → 칸. 보이는 정육면체·배지와 광선을 교차시켜 가장 가까운 것을 고른다.
  Renderer.prototype.pick = function (cx, cy) {
    // 판이 바뀐 뒤 아직 그리지 못했으면(탭이 가려져 프레임이 늦을 때) 클릭 대상 목록만 먼저 새로 만든다.
    if (this.stale && this.game && this.colors && !this.lost) this.rebuild(performance.now());
    if (!this.picks || !this.vp) return -1;
    var cv = this.canvas, r = cv.getBoundingClientRect();
    var nx = ((cx - r.left) / r.width) * 2 - 1, ny = 1 - ((cy - r.top) / r.height) * 2;
    var b = this.b || this.basis(), tf = Math.tan(this.cam.fov / 2), aspect = r.width / r.height;
    var dir = norm([b.fwd[0] + (b.right[0] * nx * aspect + b.up[0] * ny) * tf, b.fwd[1] + (b.right[1] * nx * aspect + b.up[1] * ny) * tf, b.fwd[2] + (b.right[2] * nx * aspect + b.up[2] * ny) * tf]);
    var o = this.eye || b.eye, best = -1, bt = Infinity, P = this.picks;
    var inv = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    for (var k = 0; k < P.length; k += 5) {
      var h = P[k + 4], tmin = -Infinity, tmax = Infinity;
      if (h < 0) {
        // 숫자 배지: 광선과 구의 교차
        var cx0 = P[k + 1] - o[0], cy0 = P[k + 2] - o[1], cz0 = P[k + 3] - o[2];
        var tc = cx0 * dir[0] + cy0 * dir[1] + cz0 * dir[2], d2 = cx0 * cx0 + cy0 * cy0 + cz0 * cz0 - tc * tc;
        if (tc > 0 && d2 <= h * h) {
          var th = tc - Math.sqrt(h * h - d2);
          if (th < bt) { bt = th; best = P[k]; }
        }
        continue;
      }
      for (var a = 0; a < 3; a++) {
        var t1 = (P[k + 1 + a] - h - o[a]) * inv[a], t2 = (P[k + 1 + a] + h - o[a]) * inv[a];
        if (t1 > t2) { var s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
      }
      if (tmax >= Math.max(tmin, 0) && tmin < bt) { bt = tmin; best = P[k]; }
    }
    return best;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof window !== 'undefined' ? window : globalThis);
