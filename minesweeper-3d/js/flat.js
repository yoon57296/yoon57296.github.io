/* 지뢰 큐브 — 층별 펼쳐 보기. 선택한 축의 층마다 2D 판을 하나씩 늘어놓는다.
   마우스를 올리면 위·아래 층까지 이어지는 주변 26칸이 함께 강조된다.
   4D는 W마다 한 줄(그룹)을 만들고, 이웃 80칸은 위아래 W 줄까지 이어서 강조된다. */
(function (root) {
  'use strict';
  var MS = root.MS = root.MS || {};

  var AX = ['X', 'Y', 'Z'];

  function Flat(host, h) {
    this.host = host;
    this.h = h;              // { hover(i), press(i, kind, e), layer(k, w), wfocus(w) }
    this.game = null;
    this.axis = 1;
    this.hover = -1;
    this.hint = null;
    this.linkSel = -1;       // 묶으려고 고른 임시 깃발 칸
    this.opts = { neighbors: true, dim: true, slice: 'all', layer: 0, hideSettled: true, wView: 'all', wFocus: 0 };
    this.cells = [];
    this.prev = [];
    this.bind();
  }
  MS.Flat = Flat;

  // 축별로 패널 안의 가로(col)·세로(row) 좌표 축과 방향
  function frame(g, axis) {
    if (axis === 1) return { cols: g.X, rows: g.Z, layers: g.Y, at: function (c, r, k, w) { return g.idx(c, k, r, w); } };
    if (axis === 0) return { cols: g.Z, rows: g.Y, layers: g.X, at: function (c, r, k, w) { return g.idx(k, g.Y - 1 - r, c, w); } };
    return { cols: g.X, rows: g.Y, layers: g.Z, at: function (c, r, k, w) { return g.idx(c, g.Y - 1 - r, k, w); } };
  }

  Flat.prototype.setGame = function (g) { this.game = g; this.hover = -1; this.hint = null; this.build(); };
  Flat.prototype.setAxis = function (a) { if (a !== this.axis) { this.axis = a; this.build(); } };
  Flat.prototype.setOptions = function (o) { for (var k in o) this.opts[k] = o[k]; this.update(); };
  Flat.prototype.setHover = function (i) { if (i !== this.hover) { this.hover = i; this.update(); } };
  Flat.prototype.setHint = function (cell, type) { this.hint = cell == null ? null : { cell: cell, type: type }; this.update(); };

  Flat.prototype.build = function () {
    var g = this.game;
    if (!g) return;
    var F = this.F = frame(g, this.axis), html = [], axisName = AX[this.axis], four = g.W > 1;
    var colName = this.axis === 0 ? 'Z' : 'X', rowName = this.axis === 1 ? 'Z' : 'Y';
    for (var w = 0; w < g.W; w++) {
      if (four) {
        html.push('<section class="flat-w" data-w="' + w + '"><button type="button" class="flat-whead" data-w="' + w + '" title="3D에서 이 W와 양옆만 보기">' +
          '<b>W ' + (w + 1) + '</b><span>' + (w + 1) + '번째 큐브</span></button><div class="flat-wrow">');
      }
      for (var k = 0; k < F.layers; k++) {
        html.push('<div class="flat-panel" data-layer="' + k + '" data-w="' + w + '">');
        html.push('<button type="button" class="flat-head" data-layer="' + k + '" data-w="' + w + '" title="3D에서 이 층만 보기">' +
          '<b>' + (k + 1) + '층</b><span>' + axisName + ' = ' + (k + 1) + '</span></button>');
        html.push('<div class="flat-grid" style="grid-template-columns:repeat(' + F.cols + ',var(--cs))" aria-label="' +
          (four ? 'W ' + (w + 1) + ', ' : '') + axisName + ' ' + (k + 1) + '층, 가로 ' + colName + ' 세로 ' + rowName + '">');
        for (var r = 0; r < F.rows; r++) for (var c = 0; c < F.cols; c++) {
          html.push('<div class="fc" data-i="' + F.at(c, r, k, w) + '"></div>');
        }
        html.push('</div></div>');
      }
      if (four) html.push('</div></section>');
    }
    this.host.innerHTML = '<div class="flat-wrap' + (four ? ' four' : '') + '">' + html.join('') + '</div>';
    this.wrap = this.host.firstChild;
    this.cs = 0;
    this.cells = new Array(g.n);
    this.prev = new Array(g.n);
    var list = this.host.querySelectorAll('.fc');
    for (var j = 0; j < list.length; j++) this.cells[+list[j].getAttribute('data-i')] = list[j];
    this.panels = Array.prototype.slice.call(this.host.querySelectorAll('.flat-panel'));
    this.groups = Array.prototype.slice.call(this.host.querySelectorAll('.flat-w'));
    this.fit();
    this.update();
  };

  // 패널 열 수를 바꿔 가며 칸이 가장 크게 보이는 배치를 고른다. 4D는 W 그룹마다 줄이 나뉜다.
  // 크기는 CSS(style.css의 .flat-wrap, .flat-w, .flat-panel, .flat-grid)와 똑같이 센다. 조금이라도 모자라게 세면
  // 패널이 한 줄 아래로 밀려 스크롤바가 생기고, 폭이 줄어 다시 맞추고, 스크롤바가 사라지는 일이 끝없이 반복된다.
  // 폭은 스크롤바 자리를 늘 비워 두는 clientWidth(.flat의 scrollbar-gutter: stable), 높이는 가로 스크롤바와
  // 상관없는 offsetHeight로 재서, 스크롤바가 생기고 없어지는 것이 다시 이 계산을 흔들지 않게 한다.
  Flat.prototype.fit = function () {
    if (!this.F || !this.wrap) return;
    var host = this.host, F = this.F, four = this.game && this.game.W > 1, groups = four ? this.game.W : 1;
    // 테두리 1px씩, .flat-wrap 안쪽 여백 12px씩, 소수점 반올림으로 딱 맞는 폭에서 줄이 넘어가지 않게 1px 더
    var W = host.clientWidth - 24 - 1, H = host.offsetHeight - 2 - 24 - 1;
    if (W <= 0 || H <= 0) return;
    var head = this.wrap.querySelector('.flat-head'), whead = this.wrap.querySelector('.flat-whead');
    var headH = head ? Math.ceil(head.getBoundingClientRect().height) : 18, wheadH = whead ? Math.ceil(whead.getBoundingClientRect().height) : 22;
    var gap = four ? 10 : 14;                          // 패널 사이: 3D는 .flat-wrap gap, 4D는 .flat-wrow gap
    if (four) {
      W -= 14;                                         // .flat-w 좌우 여백 6px씩 + 테두리
      H -= groups * (16 + wheadH + 6) + (groups - 1) * 14;   // .flat-w 위아래 여백·테두리, W 제목과 그 아래 간격, 그룹 사이
    }
    var padW = 12 + 2 * (F.cols - 1);                  // 패널 하나: 여백 5px·테두리 1px씩 + 칸 사이 2px
    var padH = headH + 6 + 12 + 2 * (F.rows - 1);
    var best = 0;
    for (var pc = 1; pc <= F.layers; pc++) {
      var pr = Math.ceil(F.layers / pc);
      var cw = (W - (pc - 1) * gap - pc * padW) / (pc * F.cols);
      var ch = (H - groups * ((pr - 1) * gap + pr * padH)) / (groups * pr * F.rows);
      var cs = Math.min(cw, ch);
      if (cs > best) best = cs;
    }
    best = Math.max(22, Math.min(42, Math.floor(best)));
    if (this.cs === best) return;
    this.cs = best;
    this.wrap.style.setProperty('--cs', best + 'px');
    this.wrap.style.setProperty('--fs', Math.max(11, Math.round(best * 0.5)) + 'px');
  };

  Flat.prototype.update = function () {
    var g = this.game;
    if (!g || !this.cells.length) return;
    var o = this.opts, hov = this.hover, mark = {}, lost = g.state === 'lost', k;
    if (hov >= 0 && o.neighbors) for (k = g.nbStart[hov]; k < g.nbStart[hov + 1]; k++) mark[g.nbList[k]] = 1;
    var focus = hov >= 0 && o.neighbors && o.dim;
    for (var i = 0; i < g.n; i++) {
      var cls = 'fc', txt = '';
      if (g.open[i]) {
        if (g.mine[i]) cls += ' boom';
        else if (g.num[i]) {
          cls += ' o n' + Math.min(g.num[i], 9);
          txt = String(g.num[i]);
          if (g.isSettled(i)) cls += ' done';
        } else cls += ' o z';
      } else if (lost && g.mine[i] && !g.flag[i]) cls += ' mine';
      else if (lost && g.flag[i] && !g.mine[i]) cls += ' wrong';
      else cls += g.flag[i] ? ' f' : (g.mark[i] ? ' h t' + (g.grp[i] ? ' g g' + ((g.grpColor[g.grp[i]] || 0) + 1) : '') : ' h');
      if (i === this.linkSel) cls += ' sel';
      if (i === hov) cls += ' hov';
      else if (mark[i]) cls += ' nb';
      else if (focus) cls += ' dim';
      if (this.hint && this.hint.cell === i) cls += ' hint-' + this.hint.type;
      var key = cls + '|' + txt;
      if (this.prev[i] !== key) {
        this.prev[i] = key;
        var el = this.cells[i];
        el.className = cls;
        el.textContent = txt;
      }
    }
    var sl = o.slice, L = o.layer;
    for (k = 0; k < this.panels.length; k++) {
      var lay = +this.panels[k].getAttribute('data-layer');
      var on = sl === 'all' ? false : (sl === 'one' ? lay === L : lay <= L);
      this.panels[k].classList.toggle('active', on);
    }
    var near = g.W > 1 && o.wView === 'near', f = o.wFocus;
    for (k = 0; k < this.groups.length; k++) {
      this.groups[k].classList.toggle('w-on', near && Math.abs(k - f) <= 1);
      this.groups[k].classList.toggle('w-focus', near && k === f);
    }
  };

  // 고른 W 줄이 보이도록 스크롤한다.
  Flat.prototype.reveal = function (w) {
    var el = this.groups && this.groups[w];
    if (el && el.scrollIntoView && !this.host.hidden) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  Flat.prototype.bind = function () {
    var self = this, host = this.host, press = null, LONG = 430;
    function cellOf(e) {
      var el = e.target && e.target.closest ? e.target.closest('.fc') : null;
      return el ? +el.getAttribute('data-i') : -1;
    }
    host.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse') self.h.hover(cellOf(e));
      if (press && (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10)) cancel();
    });
    host.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') self.h.hover(-1); });
    host.addEventListener('pointerdown', function (e) {
      var head = e.target.closest && e.target.closest('.flat-head, .flat-whead');
      if (head) return;
      var i = cellOf(e);
      if (i < 0) return;
      if (e.button === 1) e.preventDefault();   // 휠 클릭 자동 스크롤 막기(임시 깃발로 쓴다)
      press = { i: i, x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType, long: false, timer: 0 };
      if (e.pointerType !== 'mouse') {
        press.timer = setTimeout(function () {
          if (!press) return;
          press.long = true;
          self.h.press(press.i, 'flag', e, true);
        }, LONG);
      }
    });
    host.addEventListener('pointerup', function (e) {
      if (!press) return;
      var p = press;
      clearTimeout(p.timer);
      press = null;
      if (p.long || cellOf(e) !== p.i) return;
      if (p.button === 2) self.h.press(p.i, 'flag', e);
      else if (p.button === 1) self.h.press(p.i, 'mark', e);
      else self.h.press(p.i, 'primary', e);
    });
    host.addEventListener('pointercancel', cancel);
    host.addEventListener('contextmenu', function (e) { if (cellOf(e) >= 0 || press) e.preventDefault(); });
    host.addEventListener('mousedown', function (e) { if (e.button === 1 && cellOf(e) >= 0) e.preventDefault(); });
    host.addEventListener('auxclick', function (e) { if (cellOf(e) >= 0) e.preventDefault(); });
    host.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var head = e.target.closest('.flat-head'), whead = e.target.closest('.flat-whead');
      if (head) self.h.layer(+head.getAttribute('data-layer'), +head.getAttribute('data-w'));
      else if (whead) self.h.wfocus(+whead.getAttribute('data-w'));
    });
    function cancel() { if (press) { clearTimeout(press.timer); press = null; } }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MS;
})(typeof window !== 'undefined' ? window : globalThis);
