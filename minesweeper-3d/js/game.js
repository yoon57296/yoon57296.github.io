/* 지뢰 큐브 — 게임 규칙. DOM을 쓰지 않아 Node에서도 그대로 돌아간다. */
(function (root) {
  'use strict';
  var MS = root.MS = root.MS || {};

  // 3D에서는 칸마다 이웃이 26개라 숫자가 빨리 커진다. 2D 지뢰찾기(12~20%)보다 밀도를 낮게 잡았다.
  // 4D(W축 추가)는 이웃이 80개라 밀도를 5% 안팎으로 더 낮춘다.
  MS.PRESETS = {
    easy:   { key: 'easy',   name: '초급', X: 4, Y: 4, Z: 4, W: 1, mines: 6 },
    normal: { key: 'normal', name: '중급', X: 6, Y: 6, Z: 6, W: 1, mines: 24 },
    hard:   { key: 'hard',   name: '고급', X: 8, Y: 8, Z: 8, W: 1, mines: 56 },
    h4:     { key: 'h4',     name: '4D 초급', X: 4, Y: 4, Z: 4, W: 4, mines: 16 },
    h6:     { key: 'h6',     name: '4D 고급', X: 6, Y: 6, Z: 6, W: 6, mines: 72 }
  };
  MS.LIMITS = { min: 3, max: 12 };
  MS.maxMines = function (X, Y, Z) { return Math.max(1, Math.floor(X * Y * Z * 0.3)); };

  function now() { return Date.now(); }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  MS.rng = mulberry32;

  // ---------- 오늘의 판 ----------
  // 기기의 현지 날짜와 난이도로 시드를 정해, 같은 날 같은 난이도면 누구나 같은 판과 같은 시작 칸을 받는다.
  MS.dayKey = function (d) {
    d = d || new Date();
    var p = function (v) { return (v < 10 ? '0' : '') + v; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  MS.dailySeed = function (day, key) {
    var s = 'ms3d-daily|' + day + '|' + key, h = 0x811c9dc5;   // FNV-1a
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };

  // 이웃 목록을 CSR 형태(시작 위치 + 평평한 배열)로 만든다. 3D 판은 W = 1인 4D 판으로 다룬다.
  // 12³에서 4.5만 개, 6⁴에서 9만 개 정도.
  var nbCache = {};
  function neighbors(X, Y, Z, W) {
    W = W || 1;
    var key = X + 'x' + Y + 'x' + Z + 'x' + W;
    if (nbCache[key]) return nbCache[key];
    var n = X * Y * Z * W, start = new Int32Array(n + 1), list = [];
    for (var w = 0; w < W; w++) for (var z = 0; z < Z; z++) for (var y = 0; y < Y; y++) for (var x = 0; x < X; x++) {
      start[x + X * (y + Y * (z + Z * w))] = list.length;
      for (var dw = -1; dw <= 1; dw++) for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz && !dw) continue;
        var a = x + dx, b = y + dy, c = z + dz, d = w + dw;
        if (a < 0 || b < 0 || c < 0 || d < 0 || a >= X || b >= Y || c >= Z || d >= W) continue;
        list.push(a + X * (b + Y * (c + Z * d)));
      }
    }
    start[n] = list.length;
    return (nbCache[key] = { start: start, list: Int32Array.from(list) });
  }
  MS.neighbors = neighbors;

  function Game(cfg) {
    this.X = cfg.X; this.Y = cfg.Y; this.Z = cfg.Z; this.W = cfg.W || 1;
    this.n = this.X * this.Y * this.Z * this.W;
    this.mines = Math.max(1, Math.min(cfg.mines, this.n - 1));
    this.key = cfg.key || 'custom';
    this.noGuess = !!cfg.noGuess;
    this.seed = cfg.seed != null ? cfg.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    this.daily = cfg.daily || null;   // 오늘의 판이면 날짜(YYYY-MM-DD)
    this.start = cfg.start != null ? cfg.start : -1;   // 오늘의 판 시작 칸
    this.laid = false;                // 지뢰를 이미 깔았는지(오늘의 판은 첫 클릭 전에 깐다)
    this.firstCell = cfg.firstCell != null ? cfg.firstCell : -1;   // 처음 연 칸. 지뢰는 이 칸과 이웃을 피해 깐다
    var nb = neighbors(this.X, this.Y, this.Z, this.W);
    this.nbStart = nb.start; this.nbList = nb.list;
    this.mine = new Uint8Array(this.n);
    this.num = new Uint8Array(this.n);
    this.open = new Uint8Array(this.n);
    this.flag = new Uint8Array(this.n);
    this.mark = new Uint8Array(this.n);   // 임시 깃발: 메모일 뿐 남은 지뢰 수·코드 열기에 들어가지 않는다. 눌러도 열리지 않는다
    // 임시 깃발 묶음: "이 칸들 중 지뢰가 하나" 같은 메모. grp는 칸마다 묶음 번호(0이면 없음), grpAt은 묶인 순서.
    this.grp = new Int32Array(this.n);
    this.grpAt = new Int32Array(this.n);
    this.grpTick = 0; this.grpNext = 1; this.grpColor = {};
    this.state = 'ready';          // ready → playing → won | lost
    this.opened = 0; this.flags = 0; this.exploded = -1;
    this.startedAt = 0; this.endedAt = 0; this.penaltyMs = 0;
    this.hints = 0; this.clicks = 0;
    this.gen = null;               // 판 생성 결과 { noGuess, attempts, ms }
  }
  MS.Game = Game;

  Game.prototype.idx = function (x, y, z, w) { return x + this.X * (y + this.Y * (z + this.Z * (w || 0))); };
  // [x, y, z, w] — 3D 판에서는 w가 항상 0
  Game.prototype.xyz = function (i) {
    var X = this.X, Y = this.Y, Z = this.Z;
    return [i % X, Math.floor(i / X) % Y, Math.floor(i / (X * Y)) % Z, Math.floor(i / (X * Y * Z))];
  };
  Game.prototype.is4D = function () { return this.W > 1; };
  Game.prototype.dimsText = function () { return this.X + '×' + this.Y + '×' + this.Z + (this.W > 1 ? '×' + this.W : ''); };
  Game.prototype.nbs = function (i) {
    return Array.prototype.slice.call(this.nbList, this.nbStart[i], this.nbStart[i + 1]);
  };
  Game.prototype.safeCells = function () { return this.n - this.mines; };
  Game.prototype.ended = function () { return this.state === 'won' || this.state === 'lost'; };

  Game.prototype.elapsedMs = function () {
    if (this.state === 'ready') return 0;
    var end = this.ended() ? this.endedAt : now();
    return Math.max(0, end - this.startedAt) + this.penaltyMs;
  };

  // 첫 칸과 그 이웃(3D 26칸, 4D 80칸)에는 지뢰를 두지 않는다. 칸이 모자라는 작은 판에서는 첫 칸만 비운다.
  Game.prototype.layMines = function (first, rand) {
    var n = this.n, banned = new Uint8Array(n), zone = [first].concat(this.nbs(first)), i;
    if (n - zone.length < this.mines) zone = [first];
    for (i = 0; i < zone.length; i++) banned[zone[i]] = 1;
    var pool = [];
    for (i = 0; i < n; i++) if (!banned[i]) pool.push(i);
    for (i = 0; i < this.mines; i++) {
      var j = i + Math.floor(rand() * (pool.length - i));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    this.mine.fill(0);
    for (i = 0; i < this.mines; i++) this.mine[pool[i]] = 1;
    this.countNumbers();
  };

  Game.prototype.countNumbers = function () {
    var s = this.nbStart, l = this.nbList;
    for (var i = 0; i < this.n; i++) {
      var c = 0;
      for (var k = s[i]; k < s[i + 1]; k++) c += this.mine[l[k]];
      this.num[i] = c;
    }
  };

  // fixed: 시간 제한 없이 시도 횟수로만 끊는다. 기기 속도와 상관없이 같은 판이 나와야 하는 오늘의 판에 쓴다.
  Game.prototype.generate = function (first, fixed) {
    var rand = mulberry32(this.seed), t0 = now(), attempts = 0, ok = false;
    var budget = this.n > 400 ? 1600 : 900;
    do {
      this.layMines(first, rand);
      attempts++;
      if (!this.noGuess || !MS.Solver) break;
      ok = MS.Solver.solvableFrom(this, first);
    } while (!ok && attempts < 4000 && (fixed || now() - t0 < budget));
    this.gen = { noGuess: this.noGuess ? ok : false, attempts: attempts, ms: now() - t0 };
  };

  // 기록해 둔 판 다시 만들기. generate는 다시 깔 때마다 같은 난수열을 이어 쓰므로,
  // 같은 시드·처음 연 칸·깐 횟수(gen.attempts)면 같은 지뢰 배치가 나온다. o: { X, Y, Z, W, mines, seed, first, attempts }
  MS.rebuild = function (o) {
    var g = new Game({ X: o.X, Y: o.Y, Z: o.Z, W: o.W || 1, mines: o.mines, seed: o.seed, firstCell: o.first });
    var rand = mulberry32(g.seed);
    for (var k = 0; k < Math.max(1, o.attempts || 1); k++) g.layMines(o.first, rand);
    g.laid = true;
    return g;
  };

  // 오늘의 판: 시드로 시작 칸을 고르고 첫 클릭 전에 판을 깐다.
  // 시작 칸은 맨 윗층(y가 가장 큰 층)에서 모서리를 뺀 칸이라 처음 시점에서 바로 보인다.
  Game.prototype.prepareDaily = function () {
    this.start = this.dailyStart();
    this.generate(this.start, true);
    this.laid = true;
  };
  // 시드만으로 정해지는 오늘의 판 시작 칸(판을 깔지 않아도 알 수 있다)
  Game.prototype.dailyStart = function () {
    var rand = mulberry32(this.seed ^ 0x9E3779B9);
    var pick = function (n) { return n >= 3 ? 1 + Math.floor(rand() * (n - 2)) : Math.floor(rand() * n); };
    var x = pick(this.X), z = pick(this.Z), w = Math.floor(rand() * this.W);
    return this.idx(x, this.Y - 1, z, w);
  };

  // 0인 칸에서 퍼져 나가는 BFS. 열린 순서와 거리(애니메이션 물결용)를 돌려준다.
  Game.prototype.flood = function (seeds) {
    var cells = [], depth = [], seen = new Uint8Array(this.n), q = [], d = [], head = 0;
    var s = this.nbStart, l = this.nbList, i;
    for (i = 0; i < seeds.length; i++) {
      var c0 = seeds[i];
      if (seen[c0] || this.open[c0] || this.flag[c0]) continue;
      seen[c0] = 1; q.push(c0); d.push(0);
    }
    while (head < q.length) {
      var c = q[head], dc = d[head]; head++;
      if (this.open[c]) continue;
      this.open[c] = 1; this.opened++;
      if (this.mark[c]) this.dropMark(c);   // 0 칸에서 번져 열린 임시 깃발(안전이 확실한 칸)
      cells.push(c); depth.push(dc);
      if (this.num[c] !== 0 || this.mine[c]) continue;
      for (var k = s[c]; k < s[c + 1]; k++) {
        var m = l[k];
        if (seen[m] || this.open[m] || this.flag[m]) continue;
        seen[m] = 1; q.push(m); d.push(dc + 1);
      }
    }
    return { cells: cells, depth: depth };
  };

  Game.prototype.begin = function (first) {
    if (!this.laid) this.generate(first);
    this.firstCell = first;
    this.laid = true;
    this.state = 'playing';
    this.startedAt = now();
  };

  // 깃발과 임시 깃발 칸은 열지 않는다(임시 깃발은 지뢰로 의심하는 칸이라 실수로 터지지 않게).
  Game.prototype.reveal = function (i) {
    if (this.ended() || this.open[i] || this.flag[i] || this.mark[i]) return null;
    if (this.state === 'ready') this.begin(i);
    this.clicks++;
    if (this.mine[i]) return this.boom(i);
    var out = this.flood([i]);
    this.checkWin();
    out.state = this.state;
    return out;
  };

  // 숫자 칸 주변 깃발 수가 숫자와 같으면 나머지 닫힌 이웃을 한꺼번에 연다. 임시 깃발 칸은 건너뛴다.
  Game.prototype.chord = function (i) {
    if (this.state !== 'playing' || !this.open[i] || this.num[i] === 0) return null;
    var s = this.nbStart, l = this.nbList, f = 0, targets = [], k;
    for (k = s[i]; k < s[i + 1]; k++) {
      var m = l[k];
      if (this.flag[m]) f++;
      else if (!this.open[m] && !this.mark[m]) targets.push(m);
    }
    if (f !== this.num[i]) return { blocked: true, flags: f, need: this.num[i] };
    if (!targets.length) return null;
    this.clicks++;
    for (k = 0; k < targets.length; k++) if (this.mine[targets[k]]) return this.boom(targets[k]);
    var out = this.flood(targets);
    this.checkWin();
    out.state = this.state;
    return out;
  };

  Game.prototype.toggleFlag = function (i) {
    if (this.ended() || this.open[i]) return null;
    if (this.mark[i]) this.dropMark(i);   // 임시 깃발 칸에 깃발을 꽂으면 진짜 깃발로 바뀐다(묶음에서도 빠진다)
    this.flag[i] ^= 1;
    this.flags += this.flag[i] ? 1 : -1;
    return { flagged: !!this.flag[i] };
  };

  // 임시 깃발(휠 클릭). 진짜 깃발 칸이면 임시 깃발로 바꾼다.
  Game.prototype.toggleMark = function (i) {
    if (this.ended() || this.open[i]) return null;
    if (this.flag[i]) { this.flag[i] = 0; this.flags--; this.mark[i] = 1; }
    else if (this.mark[i]) this.dropMark(i);
    else this.mark[i] = 1;
    return { marked: !!this.mark[i] };
  };

  Game.prototype.dropMark = function (i) {
    this.mark[i] = 0;
    if (this.grp[i]) this.unlinkMark(i);
  };

  // ---------- 임시 깃발 묶음 ----------
  MS.GROUP_COLORS = 6;   // 묶음 색 수(--grp1 … --grp6)

  // 임시 깃발 둘을 같은 묶음으로 잇는다. 한쪽만 묶음에 있으면 다른 쪽이 들어가고, 둘 다 다른 묶음이면 합친다.
  Game.prototype.linkMarks = function (a, b) {
    if (this.ended() || a === b || !this.mark[a] || !this.mark[b]) return null;
    var ga = this.grp[a], gb = this.grp[b], i;
    if (ga && ga === gb) return { same: true, group: ga, size: this.groupCells(ga).length };
    if (!ga && !gb) {
      ga = this.grpNext++;
      this.grpColor[ga] = this.freeColor();
      this.joinGroup(a, ga);
      this.joinGroup(b, ga);
    } else if (!ga) {
      ga = gb;
      this.joinGroup(a, ga);
    } else if (!gb) {
      this.joinGroup(b, ga);
    } else {
      // 묶인 순서를 지키며 b 묶음을 a 묶음 뒤에 붙인다.
      var moved = this.groupCells(gb);
      for (i = 0; i < moved.length; i++) this.joinGroup(moved[i], ga);
      delete this.grpColor[gb];
    }
    return { group: ga, size: this.groupCells(ga).length };
  };
  Game.prototype.joinGroup = function (i, g) { this.grp[i] = g; this.grpAt[i] = ++this.grpTick; };

  // 칸 하나를 묶음에서 뺀다. 한 칸만 남으면 그 묶음은 없앤다.
  Game.prototype.unlinkMark = function (i) {
    var g = this.grp[i];
    if (!g) return null;
    this.grp[i] = 0;
    var rest = this.groupCells(g);
    if (rest.length === 1) { this.grp[rest[0]] = 0; rest = []; }
    if (!rest.length) delete this.grpColor[g];
    return { left: rest.length };
  };

  // 묶음을 통째로 푼다.
  Game.prototype.dissolveGroup = function (g) {
    var cells = this.groupCells(g);
    for (var k = 0; k < cells.length; k++) this.grp[cells[k]] = 0;
    delete this.grpColor[g];
    return { cells: cells };
  };

  // 묶음의 칸들(묶인 순서대로)
  Game.prototype.groupCells = function (g) {
    var out = [];
    if (!g) return out;
    for (var i = 0; i < this.n; i++) if (this.grp[i] === g) out.push(i);
    var at = this.grpAt;
    return out.sort(function (p, q) { return at[p] - at[q]; });
  };

  // 지금 있는 묶음 목록 [{ id, color, cells }] — 먼저 만든 묶음이 앞
  Game.prototype.groups = function () {
    var ids = [], seen = {}, i;
    for (i = 0; i < this.n; i++) { var g = this.grp[i]; if (g && !seen[g]) { seen[g] = 1; ids.push(g); } }
    ids.sort(function (p, q) { return p - q; });
    var self = this;
    return ids.map(function (g) { return { id: g, color: self.grpColor[g] || 0, cells: self.groupCells(g) }; });
  };

  // 지금 묶음들이 가장 적게 쓰는 색(같으면 앞 번호)
  Game.prototype.freeColor = function () {
    var use = [], k;
    for (k = 0; k < MS.GROUP_COLORS; k++) use.push(0);
    for (var g in this.grpColor) use[this.grpColor[g]]++;
    var best = 0;
    for (k = 1; k < use.length; k++) if (use[k] < use[best]) best = k;
    return best;
  };

  Game.prototype.boom = function (i) {
    this.open[i] = 1;
    this.exploded = i;
    this.state = 'lost';
    this.endedAt = now();
    return { boom: i, cells: [], depth: [], state: 'lost' };
  };

  Game.prototype.checkWin = function () {
    if (this.state !== 'playing' || this.opened !== this.n - this.mines) return;
    this.state = 'won';
    this.endedAt = now();
    for (var i = 0; i < this.n; i++) if (this.mine[i] && !this.flag[i]) { this.flag[i] = 1; this.flags++; if (this.mark[i]) this.dropMark(i); }
  };

  // 숫자 칸이 다 풀렸는지: 닫힌 이웃이 모두 깃발이면 더 볼 필요가 없다.
  Game.prototype.isSettled = function (i) {
    if (!this.open[i] || this.mine[i]) return false;
    var s = this.nbStart, l = this.nbList;
    for (var k = s[i]; k < s[i + 1]; k++) {
      var m = l[k];
      if (!this.open[m] && !this.flag[m]) return false;
    }
    return true;
  };

  // 이웃 요약: 닫힘, 깃발, 열림 수
  Game.prototype.around = function (i) {
    var s = this.nbStart, l = this.nbList, r = { hidden: 0, flags: 0, marks: 0, open: 0, total: s[i + 1] - s[i] };
    for (var k = s[i]; k < s[i + 1]; k++) {
      var m = l[k];
      if (this.open[m]) r.open++;
      else if (this.flag[m]) r.flags++;
      else { r.hidden++; if (this.mark[m]) r.marks++; }
    }
    return r;
  };

  Game.prototype.serialize = function () {
    var pack = function (a) { return Array.prototype.join.call(a, ''); };
    return {
      X: this.X, Y: this.Y, Z: this.Z, W: this.W, mines: this.mines, key: this.key, noGuess: this.noGuess, seed: this.seed,
      daily: this.daily, start: this.start, laid: this.laid, firstCell: this.firstCell,
      state: this.state, mine: pack(this.mine), open: pack(this.open), flag: pack(this.flag), mark: pack(this.mark),
      exploded: this.exploded, elapsed: this.elapsedMs() - this.penaltyMs, penaltyMs: this.penaltyMs,
      hints: this.hints, clicks: this.clicks, gen: this.gen,
      groups: this.groups().map(function (g) { return { color: g.color, cells: g.cells }; })
    };
  };

  Game.restore = function (o) {
    var g = new Game(o);
    if (!o.mine || o.mine.length !== g.n) return g;
    var unpack = function (str, arr) { for (var i = 0; i < arr.length; i++) arr[i] = str.charCodeAt(i) === 49 ? 1 : 0; };
    unpack(o.mine, g.mine); unpack(o.open, g.open); unpack(o.flag, g.flag);
    if (o.mark && o.mark.length === g.n) unpack(o.mark, g.mark);
    g.countNumbers();
    g.state = o.state; g.exploded = o.exploded; g.penaltyMs = o.penaltyMs || 0;
    g.laid = !!o.laid || g.state !== 'ready';
    g.hints = o.hints || 0; g.clicks = o.clicks || 0; g.gen = o.gen || null;
    for (var i = 0; i < g.n; i++) { if (g.open[i] && !g.mine[i]) g.opened++; if (g.flag[i]) g.flags++; }
    (Array.isArray(o.groups) ? o.groups : []).forEach(function (gr) {
      var cells = (gr && Array.isArray(gr.cells) ? gr.cells : []).filter(function (c) { return c >= 0 && c < g.n && g.mark[c] && !g.grp[c]; });
      if (cells.length < 2) return;
      var id = g.grpNext++;
      g.grpColor[id] = gr.color >= 0 && gr.color < MS.GROUP_COLORS ? gr.color | 0 : g.freeColor();
      cells.forEach(function (c) { g.joinGroup(c, id); });
    });
    var t = now();
    g.startedAt = t - (o.elapsed || 0);
    if (g.ended()) g.endedAt = t;
    return g;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof window !== 'undefined' ? window : globalThis);
