/* 지뢰 큐브 — 논리 풀이기. '추측 없는 판' 생성과 힌트에 쓴다.
   규칙 1: 숫자 하나로 확정(남은 지뢰 0 → 모두 안전, 남은 지뢰 = 닫힌 칸 수 → 모두 지뢰)
   규칙 2: 겹치는 숫자 두 개의 범위 추론
   규칙 3: 전체 남은 지뢰 수 */
(function (root) {
  'use strict';
  var MS = root.MS = root.MS || {};

  // K = { n, s, l, open, num, km(확정 지뢰), mines }
  function rule1(K, safe, mine) {
    var s = K.s, l = K.l, open = K.open, num = K.num, km = K.km, found = 0;
    for (var c = 0; c < K.n; c++) {
      if (!open[c] || !num[c]) continue;
      var u = 0, m = 0, k;
      for (k = s[c]; k < s[c + 1]; k++) {
        var t = l[k];
        if (km[t]) m++; else if (!open[t]) u++;
      }
      if (!u) continue;
      var need = num[c] - m;
      if (need !== 0 && need !== u) continue;
      var mark = need === 0 ? safe : mine;
      for (k = s[c]; k < s[c + 1]; k++) {
        var v = l[k];
        if (!km[v] && !open[v] && !mark[v]) { mark[v] = 1; found++; }
      }
    }
    return found;
  }

  function constraints(K) {
    var s = K.s, l = K.l, open = K.open, num = K.num, km = K.km, list = [], byCell = {};
    for (var c = 0; c < K.n; c++) {
      if (!open[c] || !num[c]) continue;
      var cells = [], need = num[c];
      for (var k = s[c]; k < s[c + 1]; k++) {
        var t = l[k];
        if (km[t]) need--; else if (!open[t]) cells.push(t);
      }
      if (!cells.length) continue;
      var id = list.length;
      list.push({ cells: cells, need: need });
      for (var j = 0; j < cells.length; j++) (byCell[cells[j]] || (byCell[cells[j]] = [])).push(id);
    }
    return { list: list, byCell: byCell };
  }

  function rule2(K, safe, mine) {
    var C = constraints(K), list = C.list, found = 0;
    var stamp = new Int32Array(K.n), done = {};
    for (var a = 0; a < list.length; a++) {
      var A = list[a];
      for (var j = 0; j < A.cells.length; j++) stamp[A.cells[j]] = a + 1;
      var peers = {};
      for (j = 0; j < A.cells.length; j++) {
        var ids = C.byCell[A.cells[j]];
        for (var q = 0; q < ids.length; q++) if (ids[q] !== a) peers[ids[q]] = 1;
      }
      for (var key in peers) {
        var b = +key;
        var pk = a < b ? a * 100003 + b : b * 100003 + a;
        if (done[pk]) continue;
        done[pk] = 1;
        var B = list[b], common = 0;
        for (j = 0; j < B.cells.length; j++) if (stamp[B.cells[j]] === a + 1) common++;
        var onlyA = A.cells.length - common, onlyB = B.cells.length - common;
        var lo = Math.max(0, A.need - onlyA, B.need - onlyB);
        var hi = Math.min(common, A.need, B.need);
        if (lo > hi) continue; // 모순(잘못된 가정) — 건너뛴다
        found += settle(A, onlyA, A.need - hi, A.need - lo, function (v) { return stamp[v] === a + 1 && !inB(B, v); });
        found += settle(B, onlyB, B.need - hi, B.need - lo, function (v) { return stamp[v] !== a + 1; });
        if (lo === hi && common) {
          var mk = lo === 0 ? safe : (lo === common ? mine : null);
          if (mk) for (j = 0; j < B.cells.length; j++) {
            var w = B.cells[j];
            if (stamp[w] === a + 1 && !mk[w]) { mk[w] = 1; found++; }
          }
        }
      }
    }
    return found;

    function inB(B, v) { return B.cells.indexOf(v) >= 0; }
    // only 영역의 지뢰 수가 [minM, maxM]일 때: maxM=0 → 모두 안전, minM=크기 → 모두 지뢰
    function settle(X, size, minM, maxM, pick) {
      if (!size) return 0;
      var mk = maxM === 0 ? safe : (minM === size ? mine : null), f = 0;
      if (!mk) return 0;
      for (var i = 0; i < X.cells.length; i++) {
        var v = X.cells[i];
        if (pick(v) && !mk[v]) { mk[v] = 1; f++; }
      }
      return f;
    }
  }

  function rule3(K, safe, mine) {
    var unknown = [], known = 0, i;
    for (i = 0; i < K.n; i++) {
      if (K.km[i]) known++;
      else if (!K.open[i]) unknown.push(i);
    }
    if (!unknown.length) return 0;
    var left = K.mines - known;
    var mk = left === 0 ? safe : (left === unknown.length ? mine : null);
    if (!mk) return 0;
    for (i = 0; i < unknown.length; i++) mk[unknown[i]] = 1;
    return unknown.length;
  }

  // 한 단계: 가벼운 규칙부터 시도하고, 찾으면 바로 돌려준다.
  function step(K) {
    var safe = new Uint8Array(K.n), mine = new Uint8Array(K.n);
    var f = rule1(K, safe, mine);
    if (!f) f = rule2(K, safe, mine);
    if (!f) f = rule3(K, safe, mine);
    var out = { safe: [], mine: [] };
    if (!f) return out;
    for (var i = 0; i < K.n; i++) {
      if (safe[i] && !mine[i]) out.safe.push(i);
      else if (mine[i] && !safe[i]) out.mine.push(i);
    }
    return out;
  }

  function knowledge(g, open) {
    return { n: g.n, s: g.nbStart, l: g.nbList, open: open, num: g.num, km: new Uint8Array(g.n), mines: g.mines };
  }

  // 실제 판(g.mine/g.num)으로 첫 칸부터 논리만으로 끝까지 열 수 있는지 시뮬레이션한다.
  function solvableFrom(g, first) {
    var open = new Uint8Array(g.n), K = knowledge(g, open), opened = 0, goal = g.n - g.mines;
    var s = g.nbStart, l = g.nbList, q = new Int32Array(g.n);
    function flood(c0) {
      if (open[c0]) return;
      var head = 0, tail = 0;
      open[c0] = 1; q[tail++] = c0;
      while (head < tail) {
        var c = q[head++];
        opened++;
        if (g.num[c]) continue;
        for (var k = s[c]; k < s[c + 1]; k++) {
          var m = l[k];
          if (!open[m]) { open[m] = 1; q[tail++] = m; }
        }
      }
    }
    flood(first);
    while (opened < goal) {
      var r = step(K);
      if (!r.safe.length && !r.mine.length) return false;
      for (var i = 0; i < r.mine.length; i++) K.km[r.mine[i]] = 1;
      for (i = 0; i < r.safe.length; i++) {
        if (g.mine[r.safe[i]]) return false; // 풀이기 오류 방어
        flood(r.safe[i]);
      }
    }
    return true;
  }

  // 플레이어가 보는 정보(열린 숫자)만으로 확정되는 칸을 모두 모은다. 플레이어 깃발은 믿지 않는다.
  function deduce(g) {
    var K = knowledge(g, g.open.slice()), safe = new Uint8Array(g.n), guard = 0;
    for (var i = 0; i < g.n; i++) if (g.open[i] && g.mine[i]) K.open[i] = 0;
    while (guard++ < 400) {
      var r = step(K), fresh = 0;
      for (i = 0; i < r.mine.length; i++) if (!K.km[r.mine[i]]) { K.km[r.mine[i]] = 1; fresh++; }
      for (i = 0; i < r.safe.length; i++) if (!safe[r.safe[i]]) { safe[r.safe[i]] = 1; fresh++; }
      if (!fresh) break;
      // 안전 확정 칸은 아직 숫자를 모르므로 '열림'으로 표시하지 않는다. 대신 다시 후보가 되지 않게 지뢰 아님으로만 기록.
      for (i = 0; i < r.safe.length; i++) K.open[r.safe[i]] = 2;
      // 열림(2)로 둔 칸은 숫자 0인 것처럼 취급되지 않도록 num을 보지 않는다(rule1/2는 num 0이면 건너뜀).
      K.num = maskNum(g, K.open);
    }
    var out = { safe: [], mine: [] };
    for (i = 0; i < g.n; i++) {
      if (safe[i] && !g.open[i]) out.safe.push(i);
      if (K.km[i]) out.mine.push(i);
    }
    return out;
  }

  function maskNum(g, open) {
    var num = new Uint8Array(g.n);
    for (var i = 0; i < g.n; i++) if (open[i] === 1) num[i] = g.num[i];
    return num;
  }

  // 힌트: 틀린 깃발 → 확정 안전 칸 → 확정 지뢰 → (막혔으면) 실제로 안전한 칸 하나
  function hint(g, near) {
    if (g.state !== 'playing') return { type: 'start' };
    var d = deduce(g), i;
    var pickNear = function (arr) {
      if (near == null || near < 0) return arr[0];
      var p = g.xyz(near), best = arr[0], bd = 1e9;
      for (var j = 0; j < arr.length; j++) {
        var q = g.xyz(arr[j]);
        var dist = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) + Math.abs(q[3] - p[3]);
        if (dist < bd) { bd = dist; best = arr[j]; }
      }
      return best;
    };
    var bad = [];
    for (i = 0; i < g.n; i++) if (g.flag[i] && !g.mine[i]) bad.push(i);
    var provenBad = bad.filter(function (c) { return d.safe.indexOf(c) >= 0; });
    if (provenBad.length) return { type: 'badflag', cell: pickNear(provenBad) };
    var safe = d.safe.filter(function (c) { return !g.flag[c]; });
    if (safe.length) return { type: 'safe', cell: pickNear(safe) };
    var mines = d.mine.filter(function (c) { return !g.flag[c]; });
    if (mines.length) return { type: 'mine', cell: pickNear(mines) };
    if (bad.length) return { type: 'badflag', cell: pickNear(bad) };
    // 논리로 더 확정할 수 없다. 열린 칸과 닿아 있는 안전한 칸을 우선 골라 준다.
    var frontier = [], any = [];
    for (i = 0; i < g.n; i++) {
      if (g.open[i] || g.flag[i] || g.mine[i]) continue;
      any.push(i);
      var nb = g.nbs(i);
      for (var k = 0; k < nb.length; k++) if (g.open[nb[k]]) { frontier.push(i); break; }
    }
    var pool = frontier.length ? frontier : any;
    if (!pool.length) return { type: 'none' };
    return { type: 'lucky', cell: pickNear(pool) };
  }

  MS.Solver = { step: step, solvableFrom: solvableFrom, deduce: deduce, hint: hint };
  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof window !== 'undefined' ? window : globalThis);
