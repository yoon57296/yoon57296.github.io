/* 지뢰 큐브 — 화면과 입력. 게임(MS.Game), 3D(MS.Renderer), 층별 보기(MS.Flat)를 묶는다. */
(function () {
  'use strict';
  var MS = window.MS;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'ms3d.v1';
  var HINT_PENALTY = 20000;
  var FONT = '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';
  var AXN = ['X', 'Y', 'Z'];
  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 무시 */ }

  // ---------- 저장 ----------
  var store = {};
  try { store = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { store = {}; }
  if (typeof store !== 'object') store = {};
  store.records = store.records && typeof store.records === 'object' ? store.records : {};
  // 오늘의 판 기록: { 'YYYY-MM-DD': { 난이도: { tries, first, best } } }. first는 첫 도전 결과(ms, 실패면 -1)
  store.daily = store.daily && typeof store.daily === 'object' ? store.daily : {};
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 무시 */ }
  }

  var DEFAULTS = {
    level: 'easy', custom: { X: 5, Y: 5, Z: 5, mines: 12 }, view: null, axis: 1, slice: 'all', layer: 0, explode: 0,
    hideSettled: true, hideNumbers: false, hideFlags: false, neighbors: true, dim: true, autoRotate: false,
    noGuess: true, mode: 'open', daily: false,
    level3: 'easy', level4: 'h4', wView: 'all', wFocus: 0,  // 3D/4D를 오갈 때 돌아갈 난이도, 4D W 보기
    nbColor: '',                                            // 주변 칸 강조 색. 빈 값이면 테마 기본색
    theme: 'auto'                                           // auto(기기 설정) · light · dark
  };
  var HIDES = [
    { key: 'hideSettled', hotkey: '1', name: '다 푼 숫자 숨기기' },
    { key: 'hideNumbers', hotkey: '2', name: '숫자 칸 모두 숨기기' },
    { key: 'hideFlags', hotkey: '3', name: '깃발 칸 윤곽만' }
  ];
  var prefs = {};
  function loadPrefs(src) {
    var p = {}, k;
    for (k in DEFAULTS) p[k] = DEFAULTS[k];
    src = src && typeof src === 'object' ? src : {};
    for (k in DEFAULTS) if (src[k] !== undefined && typeof src[k] === typeof DEFAULTS[k]) p[k] = src[k];
    if (src.view === '3d' || src.view === 'split' || src.view === 'flat') p.view = src.view;
    if (!MS.PRESETS[p.level] && p.level !== 'custom') p.level = 'easy';
    if (p.level3 !== 'custom' && !(MS.PRESETS[p.level3] && MS.PRESETS[p.level3].W === 1)) p.level3 = 'easy';
    if (!(MS.PRESETS[p.level4] && MS.PRESETS[p.level4].W > 1)) p.level4 = 'h4';
    if (p.wView !== 'near') p.wView = 'all';
    if (!/^#[0-9a-f]{6}$/i.test(p.nbColor)) p.nbColor = '';
    p.wFocus = Math.max(0, Math.round(p.wFocus) || 0);
    if ([0, 1, 2].indexOf(p.axis) < 0) p.axis = 1;
    if (['all', 'one', 'upto'].indexOf(p.slice) < 0) p.slice = 'all';
    if (p.mode !== 'flag') p.mode = 'open';
    if (['auto', 'light', 'dark'].indexOf(p.theme) < 0) p.theme = 'auto';
    var c = p.custom, L = MS.LIMITS;
    if (!c || [c.X, c.Y, c.Z, c.mines].some(function (v) { return typeof v !== 'number' || !isFinite(v); })) c = p.custom = { X: 5, Y: 5, Z: 5, mines: 12 };
    c.X = clampInt(c.X, L.min, L.max); c.Y = clampInt(c.Y, L.min, L.max); c.Z = clampInt(c.Z, L.min, L.max);
    c.mines = clampInt(c.mines, 1, MS.maxMines(c.X, c.Y, c.Z));
    p.explode = Math.max(0, Math.min(1.5, p.explode));
    return p;
  }
  function savePrefs() { store.prefs = prefs; save(); }
  function clampInt(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }

  // ---------- 상태 ----------
  var game = null, renderer = null, flat = null, hover = -1, hint = null, lastCell = -1;
  var linkSel = -1;   // 묶으려고 고른 임시 깃발 칸
  var els = {};
  // W A S D, Q E: 누르고 있는 동안 카메라를 옮긴다. 한글 입력 상태에서도 되도록 e.key 대신 e.code로 본다.
  var MOVE_KEYS = { KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyE: [0, 1, 0], KeyQ: [0, -1, 0] };
  var held = {}, camKeyAt = -1e9;

  function cfgFor(level) {
    if (level === 'custom') {
      var c = prefs.custom;
      return { key: 'c-' + c.X + 'x' + c.Y + 'x' + c.Z + '-' + c.mines, name: '사용자', X: c.X, Y: c.Y, Z: c.Z, W: 1, mines: c.mines };
    }
    var p = MS.PRESETS[level];
    return { key: p.key, name: p.name, X: p.X, Y: p.Y, Z: p.Z, W: p.W || 1, mines: p.mines };
  }
  function spaceOf(level) { return level !== 'custom' && MS.PRESETS[level] && MS.PRESETS[level].W > 1 ? 4 : 3; }
  function dims() { return [game.X, game.Y, game.Z]; }
  function layerCount() { return dims()[prefs.axis]; }
  function nbTotal() { return game && game.W > 1 ? 80 : 26; }

  function fmt(ms, tenths) {
    var s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60;
    var sec = tenths ? r.toFixed(1) : String(Math.floor(r));
    if (+sec < 10) sec = '0' + sec;
    return m + ':' + sec;
  }

  // ---------- 새 게임 ----------
  // daily: 오늘의 판을 켜거나(true) 끈다(false). 빼면 지금 설정을 따른다.
  function newGame(level, restore, daily) {
    if (game && game.state === 'playing') netPlay('quit');   // 끝내지 않은 판을 두고 새 판을 연다
    if (level) prefs.level = level;
    if (daily != null) prefs.daily = !!daily;
    if (prefs.level === 'custom') prefs.daily = false;   // 오늘의 판은 정해진 난이도에만 있다
    var cfg = cfgFor(prefs.level);
    if (restore) game = MS.Game.restore(restore);
    else if (prefs.daily) {
      var day = MS.dayKey();
      game = new MS.Game({ X: cfg.X, Y: cfg.Y, Z: cfg.Z, W: cfg.W, mines: cfg.mines, key: cfg.key, noGuess: true, daily: day, seed: MS.dailySeed(day, cfg.key) });
      game.prepareDaily();
    } else game = new MS.Game({ X: cfg.X, Y: cfg.Y, Z: cfg.Z, W: cfg.W, mines: cfg.mines, key: cfg.key, noGuess: prefs.noGuess });
    if (restore) { prefs.level = MS.PRESETS[game.key] ? game.key : 'custom'; prefs.daily = !!game.daily; }
    game.tele = teleStart();
    if (game.W > 1) prefs.level4 = prefs.level; else prefs.level3 = prefs.level;
    if (renderer && renderer.ok) renderer.linkSel = -1;
    flat.linkSel = -1;
    // 4D 기본 보기: 큐브가 4개까지는 모두, 그보다 많으면 가운데 W와 양옆만
    if (!restore && game.W > 1) {
      prefs.wView = game.W >= 5 ? 'near' : 'all';
      prefs.wFocus = Math.floor((game.W - 1) / 2);
    }
    prefs.wFocus = Math.max(0, Math.min(game.W - 1, prefs.wFocus));
    hover = -1; hint = null; lastCell = -1; linkSel = -1;
    prefs.layer = Math.max(0, Math.min(layerCount() - 1, prefs.layer));
    if (renderer && renderer.ok) {
      var vo = viewOpts();
      for (var k in vo) renderer.opts[k] = vo[k];
      renderer.setGame(game, !!restore);
    }
    flat.setAxis(prefs.axis);
    flat.setGame(game);
    flat.setOptions(viewOpts());
    if (game.daily && game.state === 'ready') showStart();
    syncControls();
    refresh();
    savePrefs();
    if (daily != null && !restore) toast(game.daily ? '오늘의 판 ' + dayText(game.daily) + ' · 오늘은 누구나 같은 판이에요. 빛나는 칸에서 시작하세요.' : '일반 판으로 돌아왔어요.', 3600);
  }

  function inProgress() { return game && game.state === 'playing'; }

  function requestNewGame(level, daily) {
    level = level || prefs.level;
    if (!inProgress()) { newGame(level, null, daily); return; }
    var name = level === 'custom' ? '사용자 설정' : MS.PRESETS[level].name;
    var toDaily = (daily != null ? daily : prefs.daily) && level !== 'custom';
    openDialog(
      '<h2 id="dialog-title">진행 중인 판을 그만둘까요?</h2>' +
      '<p class="lead">지금 판은 기록 없이 끝나고 ' + (toDaily ? '오늘의 판(' + name + ')을' : name + ' 새 판을') + ' 시작해요.</p>' +
      '<div class="actions"><button type="button" class="btn" data-close data-autofocus>계속 플레이</button>' +
      '<button type="button" class="btn primary" id="dlg-go">새 판 시작</button></div>',
      function (d) { d.querySelector('#dlg-go').onclick = function () { closeDialog(); newGame(level, null, daily); }; }
    );
  }

  // ---------- 오늘의 판 ----------
  function dayText(day) {
    var m = /^\d+-(\d+)-(\d+)$/.exec(day || '');
    return m ? (+m[1]) + '월 ' + (+m[2]) + '일' : '';
  }
  // 오늘의 판 켜기/끄기. 사용자 설정 판에서 켜면 중급으로 연다.
  function toggleDaily() {
    var on = !prefs.daily, level = prefs.level;
    if (on && level === 'custom') level = 'normal';
    requestNewGame(level, on);
  }
  // 시작 칸을 계속 빛나게 표시한다. 첫 동작에서 다른 힌트처럼 지워진다.
  function showStart() {
    hint = { cell: game.start, type: 'safe' };
    if (renderer && renderer.ok) renderer.setHint(game.start, 'safe', true);
    flat.setHint(game.start, 'safe');
  }
  // 이 판의 오늘의 판 기록. create가 없으면 없을 때 null
  function dailyRec(create) {
    if (!game || !game.daily) return null;
    var d = store.daily[game.daily];
    if (!d) { if (!create) return null; d = store.daily[game.daily] = {}; }
    if (!d[game.key]) { if (!create) return null; d[game.key] = { tries: 0, first: null, best: null }; }
    return d[game.key];
  }
  // 오늘의 판 기록은 최근 14일치만 둔다.
  function pruneDaily() {
    Object.keys(store.daily).sort().reverse().slice(14).forEach(function (k) { delete store.daily[k]; });
  }

  // ---------- 플레이 ----------
  var generating = false;
  function act(i, kind, isLong, noDefer) {
    if (i == null || i < 0 || !game || game.ended() || generating) return null;
    var wasReady = game.state === 'ready', primary = kind === 'primary';
    if (kind === 'primary') kind = game.open[i] ? 'chord' : (prefs.mode === 'flag' ? 'flag' : 'open');
    if ((kind === 'open' || kind === 'mark') && game.open[i]) kind = 'chord';
    // 오늘의 판은 모두 같은 칸에서 시작한다. 빛나는 시작 칸을 열기 전에는 다른 동작을 받지 않는다.
    if (wasReady && game.daily) {
      if (i === game.start && (kind === 'open' || primary)) kind = 'open';
      else { toast('오늘의 판은 빛나는 칸을 열어서 시작해요.'); return null; }
    }
    // 임시 깃발 칸은 지뢰로 의심하는 칸이라 열지 않는다. 대신 누르면 다른 임시 깃발과 잇는 데 쓴다.
    if (kind === 'open' && game.mark[i]) { pickLink(i); return null; }
    // 다른 동작을 하면 고르기를 푼다. 다른 칸에 임시 깃발을 새로 꽂는 건 이을 칸을 만드는 중이라 그대로 둔다.
    if (linkSel >= 0 && (kind !== 'mark' || i === linkSel)) setLinkSel(-1);
    // 큰 판에 지뢰가 촘촘하면 '추측 없는 판'을 찾는 데 1초 넘게 걸릴 수 있다. 안내를 먼저 그린 뒤 만든다.
    if (!noDefer && wasReady && !game.laid && kind === 'open' && !game.flag[i] && game.noGuess && game.n >= 400 && game.mines / game.n > 0.14) {
      generating = true;
      toast('논리만으로 풀리는 배치를 찾는 중…', 1800);
      var gRef = game;
      setTimeout(function () {
        generating = false;
        if (game === gRef) act(i, 'open', isLong, true);
      }, 60);
      return null;
    }
    var res = null;
    if (kind === 'open') {
      if (game.flag[i]) { toast('깃발이 꽂힌 칸이에요. 깃발을 먼저 빼야 열 수 있어요.'); return null; }
      res = game.reveal(i);
    } else if (kind === 'flag') {
      if (game.open[i]) return null;
      res = game.toggleFlag(i);
      if (res && isLong) buzz();
    } else if (kind === 'mark') {
      res = game.toggleMark(i);
    } else if (kind === 'chord') {
      res = game.chord(i);
      if (res && res.blocked) {
        showInfo(i, '깃발 ' + res.flags + ' / ' + res.need + ' — 숫자만큼 깃발을 꽂아야 한 번에 열려요');
        return res;
      }
    }
    lastCell = i;
    if (!res) { refresh(); return null; }
    noteAct(i, kind);
    if (hint) clearHint();
    if (wasReady && game.state !== 'ready') onBegin();
    if (res.cells && res.cells.length && renderer && renderer.ok && !reduced) renderer.animateReveal(res);
    if (game.state === 'lost') onLose();
    else if (game.state === 'won') onWin();
    refresh();
    return res;
  }

  // ---------- 임시 깃발 묶기 ----------
  // 임시 깃발 하나를 누르면 골라 두고, 다른 임시 깃발을 누르면 둘을 같은 묶음으로 잇는다. 같은 칸을 다시 누르면 취소.
  function pickLink(i) {
    if (linkSel < 0 || !game.mark[linkSel]) { setLinkSel(i); return; }
    if (linkSel === i) { setLinkSel(-1); return; }
    var res = game.linkMarks(linkSel, i);
    setLinkSel(-1);
    lastCell = i;
    if (res && res.same) toast('이미 같은 묶음이에요.', 1600);
    else if (res) toast('임시 깃발 ' + res.size + '칸을 한 묶음으로 이었어요.', 1800);
    refresh();
  }

  function setLinkSel(i) {
    linkSel = i;
    if (renderer && renderer.ok) renderer.setLinkSel(i);
    flat.linkSel = i;
    refresh();
  }

  function updateLinkbar() {
    var bar = els.linkbar, i = linkSel;
    if (!bar) return;
    bar.hidden = i < 0;
    els.stage.classList.toggle('linking', i >= 0);
    if (i < 0) return;
    var g = game.grp[i], size = g ? game.groupCells(g).length : 0;
    els.linkbarText.textContent = (size ? '묶음 ' + size + '칸 중 하나 · ' : '') + '이을 임시 깃발을 누르세요';
    els.lbCut.hidden = !size;
    els.lbDissolve.hidden = size < 3;
    // 칸 정보 상자를 막대 아래로 내린다(막대가 두 줄로 접히는 좁은 화면도 맞게).
    els.stage.style.setProperty('--lbh', bar.offsetHeight + 'px');
  }

  // 고른 칸을 묶음에서 빼기 / 묶음 통째로 풀기 / 임시 깃발 빼기
  function linkAction(what) {
    var i = linkSel;
    if (i < 0 || !game) return;
    if (what === 'cut') { game.unlinkMark(i); toast('연결을 끊었어요.', 1400); }
    else if (what === 'dissolve') { var n = game.dissolveGroup(game.grp[i]).cells.length; toast('묶음 ' + n + '칸을 풀었어요.', 1400); }
    else if (what === 'unmark') game.toggleMark(i);
    setLinkSel(-1);
  }

  // 길게 눌러 깃발을 꽂을 때 짧은 진동. 사용자 조작 전이나 iframe(아티팩트 뷰어) 안에서는 브라우저가 막고 콘솔에 경고를 남기므로 부르지 않는다.
  function buzz() {
    var ua = navigator.userActivation;
    var framed = true;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (!navigator.vibrate || framed || (ua && !ua.hasBeenActive)) return;
    try { navigator.vibrate(18); } catch (e) { /* 무시 */ }
  }

  function onBegin() {
    if (game.daily) {
      var d = dailyRec(true);
      if (d.tries && d.first == null) d.first = -1;   // 첫 도전을 끝내지 않고 다시 시작했다
      d.tries++;
      pruneDaily();
      save();
      return;
    }
    var cfg = cfgFor(prefs.level);
    var r = store.records[game.key] || (store.records[game.key] = { best: null, wins: 0, plays: 0 });
    r.plays = (r.plays || 0) + 1;
    r.label = cfg.name + ' ' + game.dimsText() + ' · 지뢰 ' + game.mines;
    r.last = Date.now();
    save();
    if (game.noGuess && game.gen && !game.gen.noGuess) {
      toast('시간 안에 추측 없는 배치를 찾지 못했어요. 이번 판은 추측이 필요할 수 있어요.', 4200);
    }
  }

  function onLose() {
    netPlay('lost');
    if (renderer && renderer.ok && !reduced) renderer.shake();
    var v = els.view3d;
    if (!reduced) { v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash'); }
    var right = 0;
    for (var i = 0; i < game.n; i++) if (game.flag[i] && game.mine[i]) right++;
    var d = dailyRec(false);
    if (d && d.first == null) { d.first = -1; save(); }
    setTimeout(function () {
      if (game.state !== 'lost') return;
      openDialog(
        '<h2 id="dialog-title">지뢰를 건드렸어요</h2>' +
        '<p class="lead">' + (d ? '오늘의 판(' + dayText(game.daily) + ') · ' : '') + coordText(game.exploded) + ' 칸이 지뢰였어요. 판을 둘러보며 어디서 갈렸는지 확인해 보세요.</p>' +
        statsHtml([['걸린 시간', fmt(game.elapsedMs(), true)], ['연 칸', game.opened + ' / ' + game.safeCells()], ['맞힌 깃발', right + ' / ' + game.mines]]) +
        '<div class="actions"><button type="button" class="btn" data-close>판 살펴보기</button>' +
        '<button type="button" class="btn primary" id="dlg-again" data-autofocus>' + (d ? '같은 판 다시 도전' : '다시 하기') + '</button></div>',
        function (d) { d.querySelector('#dlg-again').onclick = function () { closeDialog(); newGame(prefs.level); }; }
      );
    }, reduced ? 50 : 750);
  }

  function onWin() {
    netPlay('won');
    if (game.daily) { onDailyWin(); return; }
    var t = game.elapsedMs();
    var r = store.records[game.key] || (store.records[game.key] = { best: null, wins: 0, plays: 1 });
    r.wins = (r.wins || 0) + 1;
    var isBest = r.best == null || t < r.best;
    if (isBest) { r.best = t; r.date = new Date().toISOString().slice(0, 10); }
    save();
    var ticket = netWin(t, {});
    setTimeout(function () {
      if (game.state !== 'won') return;
      openDialog(
        '<h2 id="dialog-title">' + (game.W > 1 ? '4차원 판을 모두 열었어요' : '큐브를 모두 열었어요') + (isBest ? '<span class="badge-new">새 기록</span>' : '') + '</h2>' +
        '<p class="lead">' + cfgFor(prefs.level).name + ' ' + game.dimsText() + ' 판에서 지뢰 ' + game.mines + '개를 모두 피했어요.</p>' +
        statsHtml([['기록', fmt(t, true)], ['최고 기록', fmt(r.best, true)], ['클릭 · 힌트', game.clicks + ' · ' + game.hints]]) +
        netLine(ticket) +
        '<div class="actions"><button type="button" class="btn" data-close>판 살펴보기</button>' +
        '<button type="button" class="btn primary" id="dlg-again" data-autofocus>다음 판</button></div>',
        function (d) {
          d.querySelector('#dlg-again').onclick = function () { closeDialog(); newGame(prefs.level); };
          if (ticket) MS.net.mount(d.querySelector('#net-line'), ticket);
        }
      );
    }, reduced ? 50 : 600);
  }

  // 오늘의 판은 일반 기록과 따로 남긴다. 다시 도전하면 판을 이미 알고 하므로 첫 도전 결과를 같이 보여 준다.
  function onDailyWin() {
    var t = game.elapsedMs(), d = dailyRec(true);
    if (!d.tries) d.tries = 1;
    var first = d.first == null;
    if (first) d.first = t;
    var isBest = d.best == null || t < d.best;
    if (isBest) d.best = t;
    save();
    var ticket = netWin(t, { daily: game.daily, first: first });
    var name = cfgFor(prefs.level).name;
    setTimeout(function () {
      if (game.state !== 'won') return;
      openDialog(
        '<h2 id="dialog-title">오늘의 판을 풀었어요' + (isBest && d.tries > 1 ? '<span class="badge-new">새 기록</span>' : '') + '</h2>' +
        '<p class="lead">' + dayText(game.daily) + ' ' + name + ' ' + game.dimsText() + ' 판이에요. 오늘은 누구나 같은 판이라 기록을 그대로 견줄 수 있어요.</p>' +
        statsHtml([['기록', fmt(t, true)], ['첫 도전', d.first < 0 ? '실패' : fmt(d.first, true)], ['도전 · 힌트', d.tries + '번째 · ' + game.hints]]) +
        netLine(ticket) +
        '<div class="actions"><button type="button" class="btn" data-close>판 살펴보기</button>' +
        '<button type="button" class="btn primary" id="dlg-again" data-autofocus>같은 판 다시 도전</button></div>',
        function (dl) {
          dl.querySelector('#dlg-again').onclick = function () { closeDialog(); newGame(prefs.level); };
          if (ticket) MS.net.mount(dl.querySelector('#net-line'), ticket);
        }
      );
    }, reduced ? 50 : 600);
  }

  // 같은 네트워크 순위표. 순위표 서버(server/board.js)가 띄운 게임에서만 MS.net이 있고, 정해진 난이도만 올린다.
  function netWin(t, extra) {
    if (!MS.net || !MS.PRESETS[game.key]) return null;
    var rec = { level: game.key, ms: Math.round(t), hints: game.hints, clicks: game.clicks, noGuess: !!game.noGuess, tele: teleSummary(),
      seed: game.seed, first: game.firstCell, attempts: game.gen ? game.gen.attempts : 1, moves: moveLog() };   // 서버가 다시 돌려 검증한다
    for (var k in extra) rec[k] = extra[k];
    return MS.net.win(rec);
  }
  function netLine(ticket) { return ticket ? '<div class="net-line" id="net-line"></div>' : ''; }
  // 판 하나의 결과(이긴 판·진 판·그만둔 판)를 사용 데이터로 남긴다. 시드·처음 연 칸·깐 횟수가 있으면 같은 판을 다시 만들 수 있다.
  // beacon: 창을 닫는 중이라 sendBeacon으로 보낸다.
  function netPlay(result, beacon) {
    if (!MS.net || !game || game.logged || game.firstCell < 0) return;
    game.logged = true;
    var d = game.daily ? dailyRec(false) : null;
    MS.net.play({
      result: result, level: MS.PRESETS[game.key] ? game.key : 'custom',
      x: game.X, y: game.Y, z: game.Z, w: game.W, mines: game.mines,
      seed: game.seed, first: game.firstCell, attempts: game.gen ? game.gen.attempts : 1,
      noGuess: !!game.noGuess, genNoGuess: !!(game.gen && game.gen.noGuess),
      daily: game.daily, dailyTry: d ? d.tries : null,
      ms: Math.round(game.elapsedMs()), hints: game.hints, clicks: game.clicks,
      opened: game.opened, flags: game.flags, boom: game.exploded, tele: teleSummary(), moves: moveLog(), ui: uiSnapshot()
    }, beacon);
  }
  // 판이 끝날 때의 화면·설정. 어떤 보기와 기능을 실제로 쓰는지 보려고 판 기록에 같이 남긴다.
  function uiSnapshot() {
    var mq = function (q) { try { return matchMedia(q).matches; } catch (e) { return false; } };
    return {
      view: prefs.view, axis: AXN[prefs.axis], slice: prefs.slice, explode: prefs.explode, mode: prefs.mode,
      hideSettled: prefs.hideSettled, hideNumbers: prefs.hideNumbers, hideFlags: prefs.hideFlags,
      neighbors: prefs.neighbors, dim: prefs.dim, autoRotate: prefs.autoRotate, nbColor: !!prefs.nbColor,
      wView: game.W > 1 ? prefs.wView : null, groups: game.groups().length,
      theme: document.documentElement.getAttribute('data-theme') || (mq('(prefers-color-scheme: dark)') ? 'dark' : 'light'),
      w: innerWidth, h: innerHeight, dpr: Math.round(devicePixelRatio * 100) / 100, touch: mq('(pointer: coarse)'),
      gl: !!(renderer && renderer.ok), genMs: game.gen ? game.gen.ms : null
    };
  }

  // ---------- 입력 기록(자동 입력 의심 점수) ----------
  // 순위표 서버가 점수를 매기는 데 쓴다. 판마다 동작이 진짜 입력(isTrusted)에서 왔는지, 동작 사이에 마우스가 움직였는지,
  // 동작 간격이 어땠는지를 센다. 플레이를 막지는 않는다.
  var inp = { t: -1e9, type: 'mouse', moves: 0, dist: 0, drags: 0, mx: null, my: null };
  function onRawInput(e) {
    if (!e.isTrusted) return;   // 페이지 스크립트가 만든 가짜 이벤트는 세지 않는다
    if (e.type === 'pointermove') {
      if (e.pointerType !== 'mouse') return;
      if (inp.mx != null) inp.dist += Math.hypot(e.clientX - inp.mx, e.clientY - inp.my);
      inp.mx = e.clientX; inp.my = e.clientY; inp.moves++;
      return;
    }
    inp.t = performance.now();
    inp.type = e.type === 'keydown' ? 'key' : e.pointerType === 'mouse' ? 'mouse' : 'touch';
  }
  function teleStart() {
    return { acts: 0, noInput: 0, mouse: 0, touch: 0, key: 0, teleports: 0, m0: inp.moves, d0: inp.dist, g0: inp.drags, lastMoves: inp.moves, last: 0, iv: [],
      c0: performance.now(), log: [] };
  }
  // 클릭 순서 기록: [판을 연 뒤 ms, 칸 번호, 동작]. 동작은 o 열기, f 깃발, m 임시 깃발, c 코드 열기, h 힌트.
  // 서버가 같은 판을 다시 만들어 이 순서대로 돌려 보고, 진짜 이긴 판인지 확인한다.
  var MOVE_CODE = { open: 'o', flag: 'f', mark: 'm', chord: 'c', hint: 'h' };
  function logMove(i, kind) {
    var T = game.tele || (game.tele = teleStart());
    if (T.log.length < 5000) T.log.push([Math.round(performance.now() - T.c0), i, MOVE_CODE[kind]]);
  }
  function moveLog() { return (game && game.tele && game.tele.log) || []; }
  function noteAct(i, kind) {
    logMove(i, kind);
    var T = game.tele, t = performance.now();
    T.acts++;
    // 1.5초 안에 진짜 입력이 없었다: 콘솔에서 부른 함수나 가짜 이벤트(길게 누르기 깃발은 0.43초 뒤라 괜찮다)
    if (t - inp.t > 1500) T.noInput++;
    else {
      T[inp.type]++;
      // 앞 동작 뒤로 마우스가 거의 안 움직였는데 눌렀다: 좌표를 계산해 바로 누르는 자동 조작의 특징
      if (inp.type === 'mouse' && inp.moves - T.lastMoves < 2) T.teleports++;
    }
    T.lastMoves = inp.moves;
    if (T.last) T.iv.push(t - T.last);
    T.last = t;
  }
  function teleSummary() {
    var T = (game && game.tele) || teleStart();
    var iv = T.iv.filter(function (x) { return x < 60000; });   // 1분 넘게 쉰 간격은 뺀다
    var mean = iv.length ? iv.reduce(function (a, b) { return a + b; }, 0) / iv.length : 0;
    var sd = iv.length ? Math.sqrt(iv.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / iv.length) : 0;
    return {
      acts: T.acts, noInput: T.noInput, mouse: T.mouse, touch: T.touch, key: T.key, teleports: T.teleports,
      moves: inp.moves - T.m0, dist: Math.round(inp.dist - T.d0), drags: inp.drags - T.g0,
      ivN: iv.length, ivMean: Math.round(mean), ivCv: mean ? Math.round(sd / mean * 100) / 100 : 0, webdriver: !!navigator.webdriver
    };
  }

  function statsHtml(rows) {
    return '<div class="stats">' + rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>';
  }
  function coordText(i) {
    var c = game.xyz(i);
    return '(' + (c[0] + 1) + ', ' + (c[1] + 1) + ', ' + (c[2] + 1) + (game.W > 1 ? ', ' + (c[3] + 1) : '') + ')';
  }

  function useHint() {
    if (!game) return;
    if (game.state === 'ready' && game.daily) { toast('오늘의 판은 빛나는 칸을 열어서 시작해요.'); return; }
    if (game.state === 'ready') { toast('아무 칸이나 눌러 시작하세요. 첫 칸과 그 주변 ' + nbTotal() + '칸은 항상 안전해요.'); return; }
    if (game.ended()) return;
    var h = MS.Solver.hint(game, hover >= 0 ? hover : lastCell);
    if (!h.cell && h.cell !== 0) { toast('알려 줄 칸이 없어요.'); return; }
    game.penaltyMs += HINT_PENALTY;
    game.hints++;
    logMove(h.cell, 'hint');
    hint = h;
    if (renderer && renderer.ok) renderer.setHint(h.cell, h.type);
    flat.setHint(h.cell, h.type);
    var where = coordText(h.cell) + ' ';
    var msg = {
      safe: where + '칸은 논리로 안전이 확정돼요.',
      mine: where + '칸은 지뢰로 확정돼요. 깃발을 꽂아 두세요.',
      badflag: where + '칸의 깃발은 잘못 꽂혔어요.',
      lucky: '지금은 논리로 확정되는 칸이 없어요. ' + where + '칸은 실제로 안전해요.'
    }[h.type];
    toast(msg + ' (+20초)', 4200);
    // 단면으로 보고 있다면 힌트 칸이 보이는 층으로 옮긴다.
    var hc = game.xyz(h.cell), L = hc[prefs.axis];
    if (prefs.slice === 'one' && L !== prefs.layer) { prefs.layer = L; applyView(); }
    if (prefs.slice === 'upto' && L > prefs.layer) { prefs.layer = L; applyView(); }
    // 4D에서 이웃 W만 보고 있다면 힌트 칸의 W로 옮긴다.
    if (game.W > 1 && prefs.wView === 'near' && hc[3] !== prefs.wFocus) setW(hc[3]);
    refresh();
  }
  function clearHint() {
    hint = null;
    if (renderer && renderer.ok) renderer.setHint(null);
    flat.setHint(null);
  }

  // ---------- 화면 갱신 ----------
  function refresh() {
    if (renderer && renderer.ok) renderer.invalidate();
    flat.update();
    updateHud();
    updateInfo();
    updateLinkbar();
  }

  function updateHud() {
    if (!game) return;
    els.minesLeft.textContent = String(game.mines - game.flags);
    els.face.setAttribute('data-state', game.state);
    els.face.setAttribute('aria-label', game.state === 'won' ? '승리 — 새 게임' : game.state === 'lost' ? '패배 — 새 게임' : '새 게임');
    updateTimer();
    var n = game.n;
    els.boardLine.textContent = (game.daily ? '오늘의 판 ' + dayText(game.daily) + ' · ' : '') +
      game.dimsText() + ' · 지뢰 ' + game.mines + ' · ' + n + '칸 · 밀도 ' + (game.mines / n * 100).toFixed(1) + '%';
    var r = game.daily ? dailyRec(false) : store.records[game.key];
    els.bestK.textContent = game.daily ? '오늘의 판 최고' : '최고 기록';
    els.best.textContent = r && r.best != null ? fmt(r.best, true) : '—';
  }
  function updateTimer() {
    if (game) els.timer.textContent = fmt(game.elapsedMs());
  }

  function setHover(i) {
    if (i === hover) return;
    hover = i;
    if (renderer && renderer.ok) renderer.setHover(i);
    flat.setHover(i);
    updateInfo();
  }

  function showInfo(i, warn) { updateInfo(warn, i); }

  function updateInfo(warn, at) {
    var el = els.cellinfo, i = at != null ? at : hover;
    if (!game) return;
    if (i == null || i < 0) {
      el.innerHTML = game.state !== 'ready' ? ''
        : game.daily ? '<span>오늘의 판 · ' + dayText(game.daily) + '</span><span class="k">빛나는 칸을 열어 시작하세요 · 오늘은 누구나 같은 판</span>'
        : '<span>아무 칸이나 눌러 시작하세요</span><span class="k">첫 칸과 주변 ' + nbTotal() + '칸은 안전</span>';
      return;
    }
    var c = game.xyz(i), a = game.around(i), parts = [];
    parts.push('<span class="xyz">x' + (c[0] + 1) + ' y' + (c[1] + 1) + ' z' + (c[2] + 1) + (game.W > 1 ? ' w' + (c[3] + 1) : '') + '</span>');
    if (game.open[i] && game.mine[i]) parts.push('<span class="warn">터진 지뢰</span>');
    else if (game.open[i] && game.num[i]) {
      var left = game.num[i] - a.flags;
      parts.push('<span>숫자 <b>' + game.num[i] + '</b></span>');
      parts.push('<span class="k">깃발</span><b>' + a.flags + '</b>');
      parts.push('<span class="k">닫힌 이웃</span><b>' + a.hidden + '</b>');
      if (a.marks) parts.push('<span class="k">임시 깃발</span><b>' + a.marks + '</b>');
      if (left < 0) parts.push('<span class="warn">깃발이 ' + (-left) + '개 많아요</span>');
      else if (left === 0 && a.hidden) parts.push('<span class="okay">나머지는 안전 — 눌러서 한 번에 열기</span>');
      else if (left === a.hidden && a.hidden) parts.push('<span class="okay">닫힌 이웃이 모두 지뢰</span>');
      else if (a.hidden) parts.push('<span class="k">남은 지뢰</span><b>' + left + '</b>');
    } else if (game.open[i]) parts.push('<span class="k">빈 칸 (0)</span>');
    else if (game.flag[i]) parts.push('<span>깃발</span><span class="k">이웃 ' + a.total + '칸</span>');
    else if (game.mark[i]) {
      var gsz = game.grp[i] ? game.groupCells(game.grp[i]).length : 0;
      parts.push('<span>임시 깃발</span>');
      if (gsz) parts.push('<span class="k">묶음</span><b>' + gsz + '칸</b>');
      parts.push('<span class="k">' + (linkSel >= 0 && linkSel !== i ? '누르면 고른 칸과 묶기'
        : '눌러서 다른 임시 깃발과 잇기 · 휠 클릭 빼기 · 오른쪽 클릭 깃발로') + '</span>');
    }
    else parts.push('<span>닫힌 칸</span><span class="k">이웃 ' + a.total + '칸 · 열린 ' + a.open + ' · 깃발 ' + a.flags + '</span>');
    if (warn) parts.push('<span class="warn">' + warn + '</span>');
    el.innerHTML = parts.join('');
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = els.toast;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  // ---------- 보기 설정 ----------
  function viewOpts() {
    return {
      axis: prefs.axis, slice: prefs.slice, layer: prefs.layer, explode: prefs.explode,
      hideSettled: prefs.hideSettled, hideNumbers: prefs.hideNumbers, hideFlags: prefs.hideFlags,
      neighbors: prefs.neighbors, dim: prefs.dim, autoRotate: prefs.autoRotate,
      wView: prefs.wView, wFocus: prefs.wFocus
    };
  }

  function applyView() {
    if (!game) return;
    prefs.layer = Math.max(0, Math.min(layerCount() - 1, prefs.layer));
    prefs.wFocus = Math.max(0, Math.min(game.W - 1, prefs.wFocus));
    if (renderer && renderer.ok) renderer.setOptions(viewOpts());
    flat.setAxis(prefs.axis);
    flat.setOptions(viewOpts());
    syncControls();
    savePrefs();
  }

  // 숨기기 옵션 하나를 켜고 끈다(빠른 버튼, 키 1·2·3, 보기 도구 체크박스가 같은 값을 쓴다).
  function toggleHide(key, announce) {
    prefs[key] = !prefs[key];
    applyView();
    refresh();
    if (announce) {
      var h = HIDES.filter(function (x) { return x.key === key; })[0];
      toast(h.name + (prefs[key] ? ' 켬' : ' 끔'), 1400);
    }
  }

  // 주변 칸 강조 색: :root의 --nb-pick을 바꾸면 CSS(층별 보기)와 3D 렌더러가 함께 따라온다.
  function setNbColor(c) {
    prefs.nbColor = /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '';
    applyNbColor();
    syncControls();
    savePrefs();
  }
  function applyNbColor() {
    var st = document.documentElement.style;
    if (prefs.nbColor) st.setProperty('--nb-pick', prefs.nbColor);
    else st.removeProperty('--nb-pick');
    readTheme();
    refresh();
  }

  // 4D: W 고르기. '모든 W'에서 W를 옮기면 '이 W와 양옆' 보기로 바뀐다.
  function setW(w) {
    if (!game || game.W < 2) return;
    prefs.wFocus = Math.max(0, Math.min(game.W - 1, w));
    prefs.wView = 'near';
    applyView();
    flat.reveal(prefs.wFocus);
  }
  function stepW(d) {
    if (!game || game.W < 2) return;
    setW(prefs.wView === 'all' ? prefs.wFocus : prefs.wFocus + d);
  }

  function setView(v) {
    if (!renderer || !renderer.ok) v = 'flat';
    prefs.view = v;
    els.main.setAttribute('data-view', v);
    els.view3d.hidden = v === 'flat';
    els.flat.hidden = v === '3d';
    syncControls();
    savePrefs();
    requestAnimationFrame(function () {
      flat.fit();
      if (renderer && renderer.ok) renderer.invalidate();
    });
  }

  function stepLayer(d) {
    if (!game) return;
    if (prefs.slice === 'all') prefs.slice = 'one';
    else prefs.layer = Math.max(0, Math.min(layerCount() - 1, prefs.layer + d));
    applyView();
  }

  function setChecked(group, attr, val) {
    var list = group.querySelectorAll('[' + attr + ']');
    for (var k = 0; k < list.length; k++) list[k].setAttribute('aria-checked', String(list[k].getAttribute(attr) === String(val)));
  }

  function syncControls() {
    if (!game) return;
    var space = game.W > 1 ? 4 : 3;
    setChecked(els.spacesw, 'data-space', space);
    var lv = els.levels.querySelectorAll('[data-level]');
    for (var j = 0; j < lv.length; j++) lv[j].hidden = +lv[j].getAttribute('data-space') !== space;
    setChecked(els.levels, 'data-level', prefs.level);
    els.daily.setAttribute('aria-pressed', String(!!game.daily));
    els.daily.title = game.daily ? '오늘의 판 ' + dayText(game.daily) + ' — 눌러서 일반 판으로' : '오늘의 판: 오늘은 누구나 같은 판';
    els.tgW.hidden = space === 3;
    els.dockW.hidden = space === 3;
    els.dock.classList.toggle('four', space === 4);
    if (space === 4) {
      setChecked(els.segWview, 'data-wview', prefs.wView);
      els.wfocus.max = String(game.W - 1);
      els.wfocus.value = String(prefs.wFocus);
      var near = prefs.wView === 'near', f = prefs.wFocus;
      els.wOut.textContent = 'W ' + (f + 1) + ' / ' + game.W;
      els.dockWOut.textContent = near ? 'W ' + Math.max(1, f) + '·' + (f + 1) + '·' + Math.min(game.W, f + 2) : '모든 W';
      els.dockWOut.title = near ? 'W ' + (f + 1) + '와 양옆 큐브만 보는 중 · 눌러서 모든 W 보기' : '−/+로 W 하나와 양옆만 보기';
    }
    var c = prefs.custom;
    els.customDims.textContent = prefs.level === 'custom' ? c.X + '×' + c.Y + '×' + c.Z : '직접 설정';
    setChecked(els.segView, 'data-view', prefs.view);
    setChecked(els.segTheme, 'data-tm', prefs.theme);
    setChecked(els.segAxis, 'data-axis', prefs.axis);
    setChecked(els.segSlice, 'data-slice', prefs.slice);
    setChecked(els.dock, 'data-mode', prefs.mode);
    var N = layerCount();
    els.layer.max = String(N - 1);
    els.layer.value = String(prefs.layer);
    els.layerOut.textContent = (prefs.slice === 'all' ? '전체' : (prefs.layer + 1) + ' / ' + N + '층');
    els.dockLayerOut.textContent = prefs.slice === 'all' ? '모든 층' : AXN[prefs.axis] + ' ' + (prefs.layer + 1) + '/' + N + (prefs.slice === 'upto' ? '↓' : '');
    els.dockLayerOut.title = prefs.slice === 'all' ? '−/+로 한 층씩 잘라 보기, 눌러서 단면 방식 바꾸기' : (prefs.slice === 'one' ? '한 층만 보는 중' : '이 층까지 보는 중') + ' · 눌러서 단면 방식 바꾸기';
    els.explode.value = String(prefs.explode);
    els.explodeOut.textContent = Math.round(prefs.explode * 100) + '%';
    els.optSettled.checked = prefs.hideSettled;
    els.optNumbers.checked = prefs.hideNumbers;
    els.optFlags.checked = prefs.hideFlags;
    var qh = els.quickhide.querySelectorAll('[data-hide]');
    for (var q = 0; q < qh.length; q++) qh[q].setAttribute('aria-pressed', String(!!prefs[qh[q].getAttribute('data-hide')]));
    setChecked(els.nbSwatches, 'data-color', prefs.nbColor);
    var preset = !prefs.nbColor || !!els.nbSwatches.querySelector('[data-color="' + prefs.nbColor + '"]');
    els.nbCustom.parentNode.classList.toggle('on', !preset);
    var nbNow = (getComputedStyle(document.documentElement).getPropertyValue('--nb') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(nbNow)) els.nbCustom.value = nbNow;
    els.optNb.checked = prefs.neighbors;
    els.optDim.checked = prefs.dim;
    els.optDim.disabled = !prefs.neighbors;
    els.optRotate.checked = prefs.autoRotate;
    els.optNoguess.checked = prefs.noGuess;
    var no3d = !renderer || !renderer.ok;
    els.segView.querySelector('[data-view="3d"]').disabled = no3d;
    els.segView.querySelector('[data-view="split"]').disabled = no3d;
  }

  // ---------- 대화상자 ----------
  var lastFocus = null;
  function openDialog(html, bind) {
    lastFocus = document.activeElement;
    els.dialog.innerHTML = html;
    els.dialog.hidden = false;
    els.scrim.hidden = false;
    var closers = els.dialog.querySelectorAll('[data-close]');
    for (var k = 0; k < closers.length; k++) closers[k].onclick = closeDialog;
    if (bind) bind(els.dialog);
    var f = els.dialog.querySelector('[data-autofocus]') || els.dialog.querySelector('button, input');
    if (f) f.focus();
  }
  function closeDialog() {
    if (els.dialog.hidden) return;
    els.dialog.hidden = true;
    els.scrim.hidden = true;
    els.dialog.innerHTML = '';
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function dialogOpen() { return !els.dialog.hidden; }

  function openCustom() {
    var c = prefs.custom, L = MS.LIMITS;
    openDialog(
      '<h2 id="dialog-title">판 크기 직접 정하기</h2>' +
      '<p>한 변은 ' + L.min + '~' + L.max + '칸, 지뢰는 전체 칸의 30%까지 넣을 수 있어요.' + (inProgress() ? ' 진행 중인 판은 기록 없이 끝나요.' : '') + '</p>' +
      '<div class="form-grid">' +
      '<label for="cx">X 가로<input id="cx" type="number" inputmode="numeric" min="' + L.min + '" max="' + L.max + '" value="' + c.X + '"></label>' +
      '<label for="cy">Y 높이<input id="cy" type="number" inputmode="numeric" min="' + L.min + '" max="' + L.max + '" value="' + c.Y + '"></label>' +
      '<label for="cz">Z 깊이<input id="cz" type="number" inputmode="numeric" min="' + L.min + '" max="' + L.max + '" value="' + c.Z + '"></label>' +
      '<label for="cm">지뢰<input id="cm" type="number" inputmode="numeric" min="1" value="' + c.mines + '"></label>' +
      '</div><p class="form-note" id="cnote"></p>' +
      '<div class="actions"><button type="button" class="btn" data-close>취소</button>' +
      '<button type="button" class="btn primary" id="cgo">이 크기로 시작</button></div>',
      function (d) {
        var ids = ['cx', 'cy', 'cz', 'cm'], go = d.querySelector('#cgo'), note = d.querySelector('#cnote');
        function read() {
          var v = ids.map(function (id) { return Math.round(+d.querySelector('#' + id).value); });
          var err = '';
          if (v.slice(0, 3).some(function (x) { return !isFinite(x) || x < L.min || x > L.max; })) err = '한 변은 ' + L.min + '~' + L.max + ' 사이 정수로 정해 주세요.';
          var n = v[0] * v[1] * v[2], mx = err ? 0 : MS.maxMines(v[0], v[1], v[2]);
          if (!err && (!isFinite(v[3]) || v[3] < 1 || v[3] > mx)) err = '이 크기에서는 지뢰를 1~' + mx + '개 넣을 수 있어요.';
          note.className = 'form-note' + (err ? ' err' : '');
          note.textContent = err || ('총 ' + n + '칸 · 밀도 ' + (v[3] / n * 100).toFixed(1) + '% · 최대 ' + mx + '개');
          go.disabled = !!err;
          return err ? null : v;
        }
        ids.forEach(function (id) { d.querySelector('#' + id).addEventListener('input', read); });
        read();
        go.onclick = function () {
          var v = read();
          if (!v) return;
          prefs.custom = { X: v[0], Y: v[1], Z: v[2], mines: v[3] };
          closeDialog();
          newGame('custom');
        };
        d.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.onclick(); });
      }
    );
  }

  function openRecords() {
    var rows = [], keys = Object.keys(store.records);
    ['easy', 'normal', 'hard', 'h4', 'h6'].forEach(function (k) {
      var p = MS.PRESETS[k], r = store.records[k] || {};
      var size = p.X + '×' + p.Y + '×' + p.Z + (p.W > 1 ? '×' + p.W : '');
      rows.push([p.name + ' <small>' + size + ' · ' + p.mines + '</small>', r.best != null ? fmt(r.best, true) : '—', (r.wins || 0) + ' / ' + (r.plays || 0)]);
    });
    keys.filter(function (k) { return k.indexOf('c-') === 0; })
      .sort(function (a, b) { return (store.records[b].last || 0) - (store.records[a].last || 0); })
      .slice(0, 6)
      .forEach(function (k) {
        var r = store.records[k], m = /^c-(\d+)x(\d+)x(\d+)-(\d+)$/.exec(k);
        if (!m) return;
        rows.push(['사용자 <small>' + m[1] + '×' + m[2] + '×' + m[3] + ' · ' + m[4] + '</small>', r.best != null ? fmt(r.best, true) : '—', (r.wins || 0) + ' / ' + (r.plays || 0)]);
      });
    var today = MS.dayKey(), td = store.daily[today] || {};
    var drows = ['easy', 'normal', 'hard', 'h4', 'h6'].map(function (k) {
      var r = td[k] || {};
      return [MS.PRESETS[k].name, r.first == null ? '—' : r.first < 0 ? '실패' : fmt(r.first, true), r.best != null ? fmt(r.best, true) : '—', r.tries || 0];
    });
    openDialog(
      '<h2 id="dialog-title">기록</h2>' +
      '<p>이 브라우저에만 저장돼요. 힌트를 쓰면 1회당 20초가 더해진 시간이 남아요.</p>' +
      '<div class="table-wrap"><table class="rec"><thead><tr><th>난이도</th><th class="num">최고 기록</th><th class="num">승 / 판</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<h3 class="rec-h">오늘의 판 · ' + dayText(today) + '</h3>' +
      '<div class="table-wrap"><table class="rec"><thead><tr><th>난이도</th><th class="num">첫 도전</th><th class="num">최고</th><th class="num">도전</th></tr></thead><tbody>' +
      drows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn" id="rec-clear">기록 지우기</button>' +
      (MS.net ? '<button type="button" class="btn" id="rec-net">순위표</button>' : '') +
      '<button type="button" class="btn primary" data-close data-autofocus>닫기</button></div>',
      function (d) {
        if (MS.net) d.querySelector('#rec-net').onclick = function () { MS.net.openBoard(); };
        var b = d.querySelector('#rec-clear'), armed = false;
        b.onclick = function () {
          if (!armed) { armed = true; b.textContent = '한 번 더 누르면 지워져요'; b.classList.add('danger'); return; }
          store.records = {};
          store.daily = {};
          save();
          closeDialog();
          updateHud();
          toast('기록을 모두 지웠어요.');
        };
      }
    );
  }

  function openHelp() {
    openDialog(
      '<h2 id="dialog-title">지뢰 큐브 하는 법</h2>' +
      '<div class="help">' +
      '<h3>규칙</h3><ul>' +
      '<li>판은 X×Y×Z개의 정육면체 칸이에요. 숫자는 그 칸을 둘러싼 <b>26칸</b>(3×3×3에서 자기 자신을 뺀 칸)에 숨은 지뢰 수예요.</li>' +
      '<li>첫 칸과 그 주변 26칸에는 지뢰가 없어요. 0인 칸을 열면 주변이 연쇄로 열려요.</li>' +
      '<li>지뢰가 아닌 칸을 모두 열면 이겨요.</li></ul>' +
      '<h3>마우스·키보드</h3><ul>' +
      '<li><b>왼쪽 클릭</b> 열기 · <b>오른쪽 클릭</b>이나 <b>F</b> 깃발</li>' +
      '<li><b>휠(가운데) 클릭</b>이나 <b>T</b> 임시 깃발: 확신이 없을 때 표시해 두는 메모예요. 남은 지뢰 수와 코드 열기에는 들어가지 않고, 오른쪽 클릭하면 진짜 깃발로 바뀌어요. 열린 숫자 칸에서 휠 클릭하면 코드 열기예요.</li>' +
      '<li><b>임시 깃발 묶기</b>: 임시 깃발 칸은 눌러도 열리지 않아요. 하나를 누르고 다른 임시 깃발을 누르면 같은 색으로 묶이고 선으로 이어져요("이 중 하나가 지뢰" 같은 메모). 고른 칸의 연결을 끊거나 묶음을 풀려면 위에 뜨는 막대의 버튼을 쓰세요. 코드 열기도 임시 깃발 칸은 건너뛰어요.</li>' +
      '<li>열린 숫자 칸을 누르면 <b>코드 열기</b>: 주변 깃발 수가 숫자와 같을 때 나머지 이웃을 한 번에 열어요.</li>' +
      '<li><b>드래그</b> 회전 · <b>오른쪽/Shift 드래그</b> 이동 · <b>휠</b> 확대·축소</li>' +
      '<li>W A S D 앞뒤·옆 이동 · Q E 아래·위 이동 (누르고 있는 동안)</li>' +
      '<li>방향키 회전 · + − 확대 · [ ] 층 이동 · , . W 이동(4D) · R 시점 초기화 · H 힌트 · V 화면 전환 · N 새 판 · Space 열기</li>' +
      '<li><b>1 2 3</b> 숨기기 전환: 다 푼 숫자 · 숫자 칸 모두 · 깃발 칸 윤곽만 (3D 화면 왼쪽 아래 버튼과 같아요)</li></ul>' +
      '<h3>터치</h3><ul>' +
      '<li><b>탭</b> 열기(아래 도크에서 깃발 모드로 바꾸면 깃발) · <b>길게 누르기</b> 깃발</li>' +
      '<li>한 손가락 드래그 회전 · 두 손가락 확대와 이동 · 숫자 칸을 탭하면 주변 칸이 강조돼요.</li></ul>' +
      '<h3>4D 모드</h3><ul>' +
      '<li>칸에 네 번째 좌표 <b>W</b>가 붙어요. W값마다 3D 큐브가 하나씩 있고, 화면에 W1, W2… 순서로 나란히 놓여요.</li>' +
      '<li>숫자는 <b>80칸</b>(3×3×3×3에서 자기 자신을 뺀 칸)의 지뢰 수예요. 같은 큐브의 3×3×3 칸과 바로 옆 W 큐브 두 개의 같은 자리 3×3×3 칸이 이웃이에요.</li>' +
      '<li>‘이 W와 양옆’ 보기는 고른 W와 양옆 큐브만 남겨요. 이웃 80칸이 모두 이 세 큐브 안에 있어요.</li></ul>' +
      '<h3>안쪽 칸 보기</h3><ul>' +
      '<li><b>층 단면</b>: 축을 고르고 ‘한 층만’이나 ‘이 층까지’로 잘라 봐요. 잘린 칸은 윤곽만 남아요.</li>' +
      '<li><b>층 사이 벌리기</b>: 층 사이를 띄워 틈으로 들여다봐요.</li>' +
      '<li><b>층별·나란히</b>: 모든 층을 2D 판으로 펼쳐요. 마우스를 올리면 위아래 층의 이웃까지 강조돼요.</li>' +
      '<li><b>다 푼 숫자 숨기기</b>와 <b>깃발 윤곽만</b>으로 끝난 칸을 치워 시야를 넓혀요.</li>' +
      '<li>숫자에 마우스를 올리면 영향을 주고받는 주변 칸이 강조돼요. 그 색은 보기 도구의 <b>주변 칸 색</b>에서 바꿀 수 있어요.</li></ul>' +
      '<h3>힌트</h3><ul><li>논리로 확정되는 칸 하나를 알려 줘요. 쓸 때마다 시간에 20초가 더해져요.</li></ul>' +
      '<h3>오늘의 판</h3><ul>' +
      '<li>위의 <b>오늘의 판</b> 버튼을 켜면 날짜와 난이도로 정해진 판이 열려요. 같은 날 같은 난이도면 누구나 똑같은 판이라 친구와 기록을 견줄 수 있어요(날짜는 기기 시간 기준).</li>' +
      '<li>모두 빛나는 같은 칸에서 시작하고, 그 칸을 열 때부터 시간이 흘러요. 항상 논리만으로 풀리는 판이에요.</li>' +
      '<li>몇 번이든 다시 도전할 수 있어요. 기록 화면에 첫 도전 결과와 최고 기록이 따로 남아요.</li></ul>' +
      '</div>' +
      '<div class="actions"><button type="button" class="btn primary" data-close data-autofocus>알겠어요</button></div>'
    );
  }

  // ---------- 3D 입력 ----------
  function bindCanvas(cv) {
    var pts = {}, count = 0, press = null, pinch = null, LONG = 430, mouseAt = null, camSig = '';
    function list() { return Object.keys(pts).map(function (k) { return pts[k]; }); }
    // 마우스를 그대로 둔 채 키보드로 카메라를 움직이면 커서 아래 칸이 바뀐다.
    // 그때 다시 골라 두어야 Space·F·T가 엉뚱한 칸에 눌리지 않는다.
    renderer.onFrame = function () {
      var c = renderer.cam, sig = [c.yaw, c.pitch, c.dist, c.tgt[0], c.tgt[1], c.tgt[2]].join();
      if (sig === camSig) return;
      camSig = sig;
      if (!mouseAt || count || (!moveHeld() && performance.now() - camKeyAt > 700)) return;
      var i = renderer.pick(mouseAt.x, mouseAt.y);
      setHover(i);
      cv.classList.toggle('on-cell', i >= 0);
    };
    function cancelPress() { if (press) { clearTimeout(press.timer); press = null; } }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button === 1) e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (!pts[e.pointerId]) count++;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count === 1) {
        press = {
          id: e.pointerId, x0: e.clientX, y0: e.clientY, button: e.button, type: e.pointerType,
          moved: false, long: false, shift: e.shiftKey, cell: renderer.pick(e.clientX, e.clientY), timer: 0
        };
        if (e.pointerType !== 'mouse' && press.cell >= 0) {
          var p = press;
          p.timer = setTimeout(function () {
            if (press !== p || p.moved) return;
            p.long = true;
            setHover(p.cell);
            act(p.cell, 'flag', true);
          }, LONG);
        }
      } else if (count === 2) {
        cancelPress();
        var a = list();
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
      }
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId];
      if (!p) {
        if (e.pointerType === 'mouse') {
          mouseAt = { x: e.clientX, y: e.clientY };
          var c = renderer.pick(e.clientX, e.clientY);
          setHover(c);
          cv.classList.toggle('on-cell', c >= 0);
        }
        return;
      }
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (count >= 2 && pinch) {
        var a = list(), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        var mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        if (d > 0 && pinch.d > 0) renderer.zoom(pinch.d / d);
        renderer.pan(mx - pinch.mx, my - pinch.my);
        pinch.d = d; pinch.mx = mx; pinch.my = my;
        return;
      }
      if (!press || press.id !== e.pointerId) return;
      var thr = press.type === 'mouse' ? 4 : 10;
      if (!press.moved && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > thr) {
        press.moved = true;
        inp.drags++;
        clearTimeout(press.timer);
        cv.classList.add('dragging');
        if (press.type !== 'mouse') setHover(-1);
      }
      if (press.moved) {
        if (press.button === 2 || press.button === 1 || press.shift || e.shiftKey) renderer.pan(dx, dy);
        else renderer.rotate(dx, dy);
      }
    });
    function end(e, cancelled) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      count--;
      if (count < 2) pinch = null;
      cv.classList.remove('dragging');
      if (!press || press.id !== e.pointerId) return;
      var p = press;
      press = null;
      clearTimeout(p.timer);
      if (cancelled || p.moved || p.long) return;
      var cell = renderer.pick(e.clientX, e.clientY);
      if (cell < 0) {
        if (p.type !== 'mouse') setHover(-1);
        if (linkSel >= 0 && p.button === 0) setLinkSel(-1);   // 빈 곳을 누르면 묶기 취소
        return;
      }
      if (p.type !== 'mouse') setHover(cell);
      if (p.button === 2) act(cell, 'flag');
      else if (p.button === 1) act(cell, 'mark');
      else act(cell, 'primary');
    }
    cv.addEventListener('pointerup', function (e) { end(e, false); });
    cv.addEventListener('pointercancel', function (e) { end(e, true); });
    cv.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      mouseAt = null;
      if (!count) { setHover(-1); cv.classList.remove('on-cell'); }
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('auxclick', function (e) { e.preventDefault(); });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      renderer.zoom(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0013));
    }, { passive: false });
  }

  // ---------- 컨트롤 연결 ----------
  function bindControls() {
    els.levels.addEventListener('click', function (e) {
      var b = e.target.closest('[data-level]');
      if (!b) return;
      var lv = b.getAttribute('data-level');
      if (lv === 'custom') openCustom();
      else requestNewGame(lv);
    });
    els.spacesw.addEventListener('click', function (e) {
      var b = e.target.closest('[data-space]');
      if (!b) return;
      var sp = +b.getAttribute('data-space');
      if (sp === (game.W > 1 ? 4 : 3)) return;
      if (sp === 3 && prefs.level3 === 'custom') { openCustom(); return; }
      requestNewGame(sp === 4 ? prefs.level4 : prefs.level3);
    });
    els.face.addEventListener('click', function () { requestNewGame(); });
    $('btn-records').addEventListener('click', function () { if (MS.net) MS.net.openBoard(); else openRecords(); });
    els.daily.addEventListener('click', toggleDaily);
    $('btn-help').addEventListener('click', openHelp);
    els.scrim.addEventListener('click', closeDialog);

    els.dock.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (!b) return;
      prefs.mode = b.getAttribute('data-mode');
      syncControls();
      savePrefs();
    });
    $('dock-layer-dn').addEventListener('click', function () { stepLayer(-1); });
    $('dock-layer-up').addEventListener('click', function () { stepLayer(1); });
    els.dockLayerOut.addEventListener('click', function () {
      var order = ['all', 'one', 'upto'];
      prefs.slice = order[(order.indexOf(prefs.slice) + 1) % 3];
      applyView();
    });
    els.quickhide.addEventListener('click', function (e) {
      var b = e.target.closest('[data-hide]');
      if (b) toggleHide(b.getAttribute('data-hide'), false);
    });
    els.linkbar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-link]');
      if (!b) return;
      var what = b.getAttribute('data-link');
      if (what === 'cancel') setLinkSel(-1); else linkAction(what);
    });
    els.nbSwatches.addEventListener('click', function (e) {
      var b = e.target.closest('[data-color]');
      if (b) setNbColor(b.getAttribute('data-color'));
    });
    els.nbCustom.addEventListener('input', function () { setNbColor(els.nbCustom.value); });
    $('dock-w-dn').addEventListener('click', function () { stepW(-1); });
    $('dock-w-up').addEventListener('click', function () { stepW(1); });
    els.dockWOut.addEventListener('click', function () {
      if (prefs.wView === 'near') { prefs.wView = 'all'; applyView(); } else setW(prefs.wFocus);
    });
    els.segWview.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wview]');
      if (!b) return;
      if (b.getAttribute('data-wview') === 'near') setW(prefs.wFocus);
      else { prefs.wView = 'all'; applyView(); }
    });
    els.wfocus.addEventListener('input', function () { setW(+els.wfocus.value); });
    $('w-dn').addEventListener('click', function () { stepW(-1); });
    $('w-up').addEventListener('click', function () { stepW(1); });
    $('btn-hint').addEventListener('click', useHint);
    $('btn-view').addEventListener('click', function () { if (renderer && renderer.ok) renderer.resetView(false); });
    $('btn-tools').addEventListener('click', function () { toggleTools(); });
    $('tools-close').addEventListener('click', function () { toggleTools(false); });

    els.segView.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b && !b.disabled) setView(b.getAttribute('data-view'));
    });
    els.segTheme.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tm]');
      if (!b) return;
      prefs.theme = b.getAttribute('data-tm');
      applyTheme();
      syncControls();
      savePrefs();
    });
    els.segAxis.addEventListener('click', function (e) {
      var b = e.target.closest('[data-axis]');
      if (!b) return;
      prefs.axis = +b.getAttribute('data-axis');
      applyView();
    });
    els.segSlice.addEventListener('click', function (e) {
      var b = e.target.closest('[data-slice]');
      if (!b) return;
      prefs.slice = b.getAttribute('data-slice');
      applyView();
    });
    els.layer.addEventListener('input', function () {
      prefs.layer = +els.layer.value;
      if (prefs.slice === 'all') prefs.slice = 'one';
      applyView();
    });
    $('layer-dn').addEventListener('click', function () { stepLayer(-1); });
    $('layer-up').addEventListener('click', function () { stepLayer(1); });
    els.explode.addEventListener('input', function () { prefs.explode = +els.explode.value; applyView(); });
    [['optSettled', 'hideSettled'], ['optNumbers', 'hideNumbers'], ['optFlags', 'hideFlags'], ['optNb', 'neighbors'], ['optDim', 'dim'], ['optRotate', 'autoRotate']].forEach(function (p) {
      els[p[0]].addEventListener('change', function () { prefs[p[1]] = els[p[0]].checked; applyView(); refresh(); });
    });
    els.optNoguess.addEventListener('change', function () {
      prefs.noGuess = els.optNoguess.checked;
      savePrefs();
      toast(prefs.noGuess ? '다음 판부터 논리만으로 풀리는 배치를 만들어요.' : '다음 판부터 완전히 무작위로 배치해요.');
    });

    document.addEventListener('keydown', onKey);
    ['pointermove', 'pointerdown', 'pointerup', 'keydown'].forEach(function (t) { document.addEventListener(t, onRawInput, true); });
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseMove);
    window.addEventListener('resize', updateLinkbar);   // 막대 줄 수가 바뀌면 칸 정보 상자 위치도 다시 맞춘다
    els.dialog.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = els.dialog.querySelectorAll('button:not([disabled]), input');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function toggleTools(open) {
    var t = els.tools, on = open == null ? !t.classList.contains('open') : open;
    t.classList.toggle('open', on);
    $('btn-tools').setAttribute('aria-expanded', String(on));
    if (on) { var f = t.querySelector('button, input'); if (f) f.focus(); }
    // 시트가 닫히며 안에 있던 포커스가 사라지면(아티팩트 iframe에서는 포커스가 페이지 밖으로 나가 단축키가 멈춘다)
    // 시트를 연 '도구' 버튼으로 포커스를 돌려준다.
    else if (t.contains(document.activeElement)) {
      var opener = $('btn-tools');
      if (opener.offsetParent) opener.focus(); else document.activeElement.blur();
    }
  }

  function onKey(e) {
    if (dialogOpen()) { if (e.key === 'Escape') closeDialog(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && e.key !== 'Escape') return;
    var r = renderer && renderer.ok ? renderer : null, k = e.key, used = true;
    // 한글 입력 상태에서는 e.key가 'ㄱ' 같은 자모(IME에 따라 'Process')로 온다. 영문 글자가 아니면 자판 위치(e.code)로 읽는다.
    if (!/^[a-z]$/i.test(k) && /^Key[A-Z]$/.test(e.code || '')) k = e.code.charAt(3).toLowerCase();
    if (MOVE_KEYS[e.code]) {
      if (r && !held[e.code]) { held[e.code] = 1; applyMove(); }
      return;
    }
    if (k.indexOf('Arrow') === 0 || k === '+' || k === '=' || k === '-' || k === '_' || k === 'r' || k === 'R') camKeyAt = performance.now();
    if (k === 'ArrowLeft' && r) r.rotate(-36, 0);
    else if (k === 'ArrowRight' && r) r.rotate(36, 0);
    else if (k === 'ArrowUp' && r) r.rotate(0, -30);
    else if (k === 'ArrowDown' && r) r.rotate(0, 30);
    else if ((k === '+' || k === '=') && r) r.zoom(0.85);
    else if ((k === '-' || k === '_') && r) r.zoom(1.18);
    else if ((k === 'r' || k === 'R') && r) r.resetView(false);
    else if (k === 'f' || k === 'F') { if (hover >= 0) act(hover, 'flag'); }
    else if (k === 't' || k === 'T') { if (hover >= 0) act(hover, 'mark'); }
    else if (k === ' ') { if (hover >= 0) act(hover, 'open'); }
    else if (k === '[') stepLayer(-1);
    else if (k === ']') stepLayer(1);
    else if (k === '1' || k === '2' || k === '3') toggleHide(HIDES[+k - 1].key, true);
    else if (k === ',' && game.W > 1) stepW(-1);
    else if (k === '.' && game.W > 1) stepW(1);
    else if (k === 'h' || k === 'H') useHint();
    else if (k === 'n' || k === 'N') requestNewGame();
    else if (k === 'v' || k === 'V') {
      var order = r ? ['3d', 'split', 'flat'] : ['flat'];
      setView(order[(order.indexOf(prefs.view) + 1) % order.length]);
    } else if (k === 'Escape') { if (linkSel >= 0) setLinkSel(-1); else toggleTools(false); }
    else used = false;
    if (used && (k === ' ' || k.indexOf('Arrow') === 0)) e.preventDefault();
  }

  function moveHeld() { for (var c in held) return true; return false; }
  function applyMove() {
    var v = [0, 0, 0];
    for (var c in held) for (var a = 0; a < 3; a++) v[a] += MOVE_KEYS[c][a];
    camKeyAt = performance.now();
    if (renderer && renderer.ok) renderer.setMove(v[0], v[1], v[2]);
  }
  function onKeyUp(e) {
    if (held[e.code]) { delete held[e.code]; applyMove(); }
  }
  // 키를 누른 채 창을 떠나면 keyup이 오지 않으니, 포커스를 잃을 때 모두 놓는다.
  function releaseMove() {
    if (!moveHeld()) return;
    held = {};
    applyMove();
  }

  function readTheme() {
    if (renderer && renderer.ok) renderer.setTheme(getComputedStyle(document.documentElement));
  }
  // 테마: 자동이면 기기 설정을 따른다(아티팩트 뷰어처럼 바깥이 data-theme를 정해 두었으면 그 값). 밝게·어둡게는 직접 정한다.
  // data-theme가 바뀌면 위의 MutationObserver가 readTheme로 3D 색도 바꾼다.
  var hostTheme = null;
  function applyTheme() {
    var t = prefs.theme === 'auto' ? hostTheme : prefs.theme, root = document.documentElement;
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  }

  // ---------- 시작 ----------
  function start(data) {
    data = data || {};
    var saved = store.prefs;
    if (data.prefs) saved = data.prefs;
    prefs = loadPrefs(saved);
    if (!prefs.view) prefs.view = window.innerWidth >= 1280 ? 'split' : '3d';
    hostTheme = document.documentElement.getAttribute('data-theme');
    applyTheme();

    els = {
      main: $('main'), view3d: $('view3d'), flat: $('flat'), cellinfo: $('cellinfo'), toast: $('toast'),
      minesLeft: $('mines-left'), timer: $('timer'), face: $('btn-new'), boardLine: $('board-line'), best: $('best'), bestK: $('best-k'),
      daily: $('btn-daily'),
      levels: $('levels'), customDims: $('custom-dims'), dock: $('dock'), dockLayerOut: $('dock-layer-out'),
      segView: $('seg-view'), segAxis: $('seg-axis'), segSlice: $('seg-slice'), segTheme: $('seg-theme'), layer: $('layer'), layerOut: $('layer-out'),
      explode: $('explode'), explodeOut: $('explode-out'), optSettled: $('opt-settled'), optNumbers: $('opt-numbers'),
      optFlags: $('opt-flags'), optNb: $('opt-nb'), optDim: $('opt-dim'), optRotate: $('opt-rotate'), optNoguess: $('opt-noguess'),
      dialog: $('dialog'), scrim: $('scrim'), tools: $('tools'),
      spacesw: $('spacesw'), tgW: $('tg-w'), segWview: $('seg-wview'), wfocus: $('wfocus'), wOut: $('w-out'),
      dockW: $('dock-w'), dockWOut: $('dock-w-out'),
      quickhide: $('quickhide'), nbSwatches: $('nb-swatches'), nbCustom: $('nb-custom'),
      stage: $('stage'), linkbar: $('linkbar'), linkbarText: $('linkbar-text'), lbCut: $('lb-cut'), lbDissolve: $('lb-dissolve')
    };

    if (prefs.nbColor) document.documentElement.style.setProperty('--nb-pick', prefs.nbColor);
    try { renderer = new MS.Renderer($('gl'), $('overlay')); } catch (e) { renderer = { ok: false }; if (window.console) console.warn('WebGL 초기화 실패', e); }
    if (renderer.ok) {
      renderer.uploadAtlas(FONT);
      readTheme();
      bindCanvas($('gl'));
      if (document.fonts && document.fonts.load) {
        document.fonts.load('800 64px "JetBrains Mono"').then(function () { renderer.uploadAtlas(FONT); }, function () { /* 기본 글꼴 유지 */ });
      }
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme); } catch (e) { /* 구형 브라우저 */ }
      try { new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }); } catch (e) { /* 무시 */ }
    } else {
      $('nogl').hidden = false;
    }
    flat = new MS.Flat(els.flat, {
      hover: function (i) { setHover(i); },
      press: function (i, kind, e, isLong) {
        if (e && e.pointerType && e.pointerType !== 'mouse') setHover(i);
        act(i, kind, isLong);
      },
      layer: function (k, w) {
        // 같은 층 머리글을 다시 누르면 단면을 풀고 전체를 본다. 4D의 다른 W 줄이면 그 W로 옮긴다.
        var sameW = !(game.W > 1) || prefs.wView !== 'near' || prefs.wFocus === w;
        prefs.slice = prefs.slice === 'one' && prefs.layer === k && sameW ? 'all' : 'one';
        prefs.layer = k;
        if (game.W > 1 && !sameW) prefs.wFocus = w;
        applyView();
      },
      wfocus: function (w) {
        if (prefs.wView === 'near' && prefs.wFocus === w) { prefs.wView = 'all'; applyView(); } else setW(w);
      }
    });
    bindControls();
    setView(prefs.view);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { if (renderer.ok) { renderer.invalidate(); } }).observe(els.view3d);
      new ResizeObserver(function () { flat.fit(); }).observe(els.flat);
    } else {
      window.addEventListener('resize', function () { flat.fit(); if (renderer.ok) renderer.invalidate(); });
    }

    var restore = null;
    if (data.game && data.game.X) restore = data.game;
    try { newGame(null, restore); } catch (e) { newGame(null, null); }
    setInterval(function () { if (game && game.state === 'playing') updateTimer(); }, 200);

    MS.app = {
      get game() { return game; }, get prefs() { return prefs; }, renderer: renderer, flat: flat,
      act: act, newGame: newGame, useHint: useHint, setView: setView, setHover: setHover, applyView: applyView,
      requestNewGame: requestNewGame, openDialog: openDialog, closeDialog: closeDialog, toast: toast,
      openCustom: openCustom, openRecords: openRecords, openHelp: openHelp,
      stepLayer: stepLayer, setW: setW, stepW: stepW, toggleHide: toggleHide, setNbColor: setNbColor, toggleDaily: toggleDaily,
      get linkSel() { return linkSel; }, get store() { return store; },
      quitPlay: function () { if (game && game.state === 'playing') netPlay('quit', true); }
    };
  }

  function snapshot() { return { game: game ? game.serialize() : null, prefs: prefs }; }
  var hot = window.claude && window.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(snapshot); } catch (e) { /* 뷰어 밖 */ }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
