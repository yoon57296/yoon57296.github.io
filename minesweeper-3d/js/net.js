/* 지뢰 큐브 — 순위표 연결. 순위표를 켠 빌드에만 실린다.
     같은 네트워크: 순위표 서버(server/board.js)가 게임 페이지에 끼워 넣는다. 서버 주소 = 게임 주소
     인터넷: github.io용 빌드(dev/build_pages.js)가 끼워 넣는다. 서버는 Cloudflare Worker(worker/index.js), 주소는 MS_BOARD.api
   ui.js는 MS.net이 있을 때만 이긴 기록을 넘기고, '기록' 버튼을 '순위표'로 쓴다. itch.io·아티팩트에서는 이 파일이 없다. */
(function () {
  'use strict';
  var MS = window.MS;
  var CFG = window.MS_BOARD || {};
  // 순위표 서버가 게임과 다른 주소에 있으면(인터넷) 그 주소 앞에 붙인다. 끝은 /로 맞춘다.
  var API = CFG.api ? String(CFG.api).replace(/\/*$/, '/') : '';
  var REMOTE = !!API;
  var KEY = 'ms3d.net';
  var LEVELS = ['easy', 'normal', 'hard', 'h4', 'h6'];
  var NAME_MAX = 12;

  // me: { name, pending: [아직 못 올린 기록] } — 이름을 정하기 전에 이긴 판은 이름을 정하는 대로 올린다.
  var me = {};
  try { me = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { me = {}; }
  if (typeof me.name !== 'string') me.name = '';
  var pending = (Array.isArray(me.pending) ? me.pending : []).map(function (rec) { return { rec: rec, state: 'noname', el: null }; });
  function saveMe() {
    me.pending = pending.map(function (t) { return t.rec; });
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* 저장 불가 — 이번 창에서만 기억 */ }
  }
  // 브라우저 번호: 처음 들어올 때 무작위로 정해 두고 판·방문 기록에 같이 보낸다. 같은 브라우저의 기록을 묶어 보려는 것으로,
  // 개인 정보에서 만든 값이 아니다. 저장소를 지우거나 시크릿 창을 쓰면 새로 정해진다.
  if (!/^b-[0-9a-f]{16}$/.test(me.bid || '')) {
    var hex = '', k;
    try {
      var rnd = new Uint8Array(8);
      crypto.getRandomValues(rnd);
      for (k = 0; k < 8; k++) hex += (rnd[k] < 16 ? '0' : '') + rnd[k].toString(16);
    } catch (e) { hex = ''; for (k = 0; k < 16; k++) hex += Math.floor(Math.random() * 16).toString(16); }
    me.bid = 'b-' + hex;
    saveMe();
  }

  function fmt(ms) {
    var s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = (s - m * 60).toFixed(1);
    return m + ':' + (+r < 10 ? '0' : '') + r;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function cleanName(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function nameError(n) {
    var len = Array.from(n).length;
    return len < 1 || len > NAME_MAX ? '이름은 1~' + NAME_MAX + '자로 정해 주세요.' : '';
  }
  function dayText(day) {
    var m = /^\d+-(\d+)-(\d+)$/.exec(day || '');
    return m ? (+m[1]) + '월 ' + (+m[2]) + '일' : '';
  }

  // 다른 주소의 서버로 보낼 때는 text/plain으로 보낸다. 그래야 브라우저가 보내기 전에 따로 묻는 요청(preflight)을 하지 않는다.
  var POST_TYPE = REMOTE ? 'text/plain;charset=UTF-8' : 'application/json';
  function api(url, body) {
    var init = body ? { method: 'POST', headers: { 'Content-Type': POST_TYPE }, body: JSON.stringify(body) } : { cache: 'no-store' };
    // 서버 컴퓨터가 꺼져 있으면 응답 없이 오래 기다리게 되므로 8초에서 끊는다.
    if (window.AbortController) { var ac = new AbortController(); init.signal = ac.signal; setTimeout(function () { ac.abort(); }, 8000); }
    return fetch(API + url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (o) {
        if (!r.ok || o.ok === false) throw new Error(o.error || '서버가 ' + r.status + '로 답했어요.');
        return o;
      });
    }, function () { throw new Error(REMOTE ? '순위표 서버에 닿지 않아요. 잠시 뒤에 다시 해 주세요.' : '순위표 서버에 닿지 않아요. 서버 컴퓨터가 켜져 있는지 확인해 주세요.'); });
  }

  // ---------- 이긴 기록 올리기 ----------
  // 이긴 판 하나를 맡은 표. 결과 창에 붙이면(mount) 올리는 중·결과·이름 입력을 그 자리에 그린다.
  function win(rec) {
    var t = { rec: rec, state: 'noname', el: null };
    if (me.name) send(t);
    else { pending.push(t); if (pending.length > 3) pending.shift(); saveMe(); }
    return t;
  }
  function send(t) {
    t.state = 'sending'; t.err = '';
    draw(t);
    var body = {}, k;
    for (k in t.rec) body[k] = t.rec[k];
    body.name = me.name;
    body.bid = me.bid;
    return api('api/scores', body).then(function (o) { t.state = 'done'; t.res = o; draw(t); return t; },
      function (e) { t.state = 'error'; t.err = e.message; draw(t); return t; });
  }
  function setName(n) {
    me.name = n;
    var list = pending.splice(0);
    saveMe();
    list.forEach(send);
    return list;
  }
  function mount(el, t) { t.el = el; draw(t); }

  // ---------- 판 기록(사용 데이터) ----------
  // 이긴 판·진 판·그만둔 판 모두, 이름이 없어도 보낸다. 창을 닫는 중이면 sendBeacon으로 보낸다(text/plain로 가지만 서버는 본문만 본다).
  function postData(url, obj, beacon) {
    var body = JSON.stringify(obj);
    url = API + url;
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url, body)) return; } catch (e) { /* 아래 fetch로 */ }
    }
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': POST_TYPE }, body: body, keepalive: true })
        .catch(function () { /* 사용 기록은 놓쳐도 게임에는 지장이 없다 */ });
    } catch (e) { /* 무시 */ }
  }
  var counts = { plays: 0, wins: 0 };
  function play(rec, beacon) {
    rec.name = me.name || '';
    rec.bid = me.bid;
    counts.plays++;
    if (rec.result === 'won') counts.wins++;
    postData('api/plays', rec, beacon);
  }

  // ---------- 방문·오류 기록 ----------
  // visit 들어옴(화면 크기 등), leave 나감(머문 시간·판 수), error 게임 오류, nogl 3D를 못 띄움. 오류는 페이지마다 10개까지만 보낸다.
  function event(type, data, beacon) { postData('api/events', { type: type, bid: me.bid, data: data || {} }, beacon); }
  var errorsSent = 0;
  window.addEventListener('error', function (e) {
    if (errorsSent >= 10 || !e || !e.message) return;   // 이미지가 안 열린 경우 같은 것은 message가 없다
    errorsSent++;
    event('error', {
      msg: String(e.message).slice(0, 300), src: String(e.filename || '').replace(location.origin, '').slice(0, 200),
      line: e.lineno || 0, col: e.colno || 0, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1500) : ''
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (errorsSent >= 10) return;
    errorsSent++;
    var r = e && e.reason;
    event('error', { msg: ('promise: ' + String((r && r.message) || r)).slice(0, 300), stack: r && r.stack ? String(r.stack).slice(0, 1500) : '' });
  });
  // 창을 닫거나 다른 주소로 떠나면 하던 판을 '그만둠'으로 남기고, 머문 시간과 판 수를 남긴다.
  window.addEventListener('pagehide', function () {
    if (MS.app && MS.app.quitPlay) MS.app.quitPlay();
    event('leave', { sec: Math.round(performance.now() / 1000), plays: counts.plays, wins: counts.wins }, true);
  });

  // ---------- 업데이트 알림 ----------
  // 서버의 게임 파일이 바뀌면 이 페이지는 옛 코드라 기록이 순위표에 제대로 안 올라갈 수 있다.
  // 30초마다(그리고 창으로 돌아올 때) 버전을 물어, 받은 버전과 다르면 화면 위에 새로고침 안내를 띄운다. 플레이는 막지 않는다.
  // github.io 빌드는 서버가 게임 파일을 모르므로 게임 옆의 version.json(verUrl)을 묻는다.
  var myVer = CFG.v || '', updateBar = null;
  function checkVersion() {
    if (!myVer || updateBar) return Promise.resolve(!!updateBar);
    return fetch(CFG.verUrl ? CFG.verUrl + '?t=' + Date.now() : 'api/version', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) {
      if (o && o.v && o.v !== myVer) showUpdate();
      return !!updateBar;
    }, function () { return false; });
  }
  function showUpdate() {
    if (updateBar) return;
    updateBar = document.createElement('div');
    updateBar.className = 'net-update';
    updateBar.setAttribute('role', 'alert');
    updateBar.innerHTML = '<p><b>게임이 업데이트됐어요.</b> 새로고침해야 기록이 순위표에 제대로 올라가요. 하던 판은 끝내고 눌러도 돼요.</p>' +
      '<button type="button" class="btn">새로고침</button>';
    updateBar.querySelector('button').onclick = function () { location.reload(); };
    document.body.appendChild(updateBar);
  }
  setInterval(checkVersion, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(); });
  window.addEventListener('focus', function () { checkVersion(); });

  function resultText(t) {
    var o = t.res, lv = MS.PRESETS[t.rec.level].name;
    if (o.board === 'daily') return '오늘의 판 ' + lv + ' 첫 도전 <b>' + o.rank + '위</b> / ' + o.total + '명';
    if (o.board === 'suspect') return '이번 기록은 자동 입력이 의심돼 순위에 넣지 않았어요. 직접 플레이한 기록이라면 ' + (REMOTE ? '게임을 공유한 사람' : '서버를 연 사람') + '에게 알려 주세요.';
    if (o.board === 'retry') return '오늘의 판 순위는 하루 첫 도전만 세요. 이번 기록은 \'방금 클리어\'에만 올라가요.';
    if (o.board === 'best') return lv + ' 순위 <b>' + o.rank + '위</b> / ' + o.total + '명 · ' + (o.isBest ? '내 최고 기록이에요' : '내 최고 ' + fmt(o.best));
    return '기록을 순위표 서버에 남겼어요.';   // 이 페이지가 모르는 새 답(서버만 새로 바뀐 경우)
  }
  function draw(t) {
    var el = t.el;
    if (!el || !document.contains(el)) return;
    var who = me.name ? '<span class="net-who">' + esc(me.name) + '</span> ' : '';
    if (t.state === 'sending') el.innerHTML = '<p class="net-msg">' + who + '순위표에 올리는 중…</p>';
    else if (t.state === 'done') {
      el.innerHTML = '<p class="net-msg ok">' + who + resultText(t) + '</p>' +
        '<button type="button" class="btn net-open">순위표 보기</button>';
      el.querySelector('.net-open').onclick = function () { openBoard(t.rec.level); };
    } else if (t.state === 'error') {
      el.innerHTML = '<p class="net-msg err">' + esc(t.err) + '</p><button type="button" class="btn net-retry">다시 올리기</button>';
      el.querySelector('.net-retry').onclick = function () { send(t); };
    } else {
      // 이름이 아직 없다: 결과 창 안에서 바로 정하고 올린다.
      el.innerHTML = '<label class="net-name">순위표에 올릴 이름<span class="net-row">' +
        '<input type="text" maxlength="' + NAME_MAX + '" autocomplete="nickname" placeholder="예: 22반 김싸피">' +
        '<button type="button" class="btn net-send">올리기</button></span></label><p class="net-msg"></p>';
      var input = el.querySelector('input'), msg = el.querySelector('.net-msg');
      var go = function () {
        var n = cleanName(input.value), err = nameError(n);
        if (err) { msg.textContent = err; msg.className = 'net-msg err'; input.focus(); return; }
        setName(n);   // 이 판(과 앞서 못 올린 판)을 올린다
        syncLabel();
      };
      el.querySelector('.net-send').onclick = go;
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) go(); });
    }
  }

  // ---------- 순위표 창 ----------
  var cache = null, tab = null;
  function openBoard(level) {
    var app = MS.app, g = app.game;
    tab = LEVELS.indexOf(level) >= 0 ? level : g && LEVELS.indexOf(g.key) >= 0 ? g.key : tab || 'easy';
    app.openDialog(
      '<h2 id="dialog-title">순위표</h2>' +
      '<p>' + (REMOTE ? '이 게임 주소로 들어온 사람끼리' : '이 서버로 들어온 사람끼리') + ' 기록을 나눠요. 힌트를 쓰면 1회당 20초가 더해진 시간이에요.</p>' +
      '<p class="net-note">순위표 서버는 판마다 결과·시간·클릭 순서·판 정보(크기·시드)·화면 설정과 접속한 컴퓨터 주소(IP)·브라우저 정보·브라우저 번호를 기록해요. 이름을 정하면 이름도 함께 남아요. 자동 입력이 의심되는 기록은 순위에 넣지 않아요.</p>' +
      '<div class="net-me"><label class="net-name">내 이름<span class="net-row">' +
      '<input type="text" id="net-name" maxlength="' + NAME_MAX + '" autocomplete="nickname" placeholder="순위표에 보일 이름" value="' + esc(me.name) + '">' +
      '<button type="button" class="btn" id="net-save">저장</button></span></label><p class="net-msg" id="net-name-msg"></p></div>' +
      '<div class="seg net-tabs" role="radiogroup" aria-label="난이도" id="net-tabs">' +
      LEVELS.map(function (k) { return '<button type="button" role="radio" data-k="' + k + '">' + MS.PRESETS[k].name + '</button>'; }).join('') +
      '</div><div id="net-body"><p class="net-msg">불러오는 중…</p></div>' +
      '<div class="actions"><button type="button" class="btn" id="net-local">이 브라우저 기록</button>' +
      '<button type="button" class="btn primary" data-close data-autofocus>닫기</button></div>',
      function (d) {
        var input = d.querySelector('#net-name'), msg = d.querySelector('#net-name-msg');
        var save = function () {
          var n = cleanName(input.value), err = nameError(n);
          if (err) { msg.textContent = err; msg.className = 'net-msg err'; return; }
          var sent = setName(n);
          syncLabel();
          msg.className = 'net-msg ok';
          msg.textContent = '이름을 저장했어요.' + (sent.length ? ' 못 올렸던 기록 ' + sent.length + '개를 올렸어요.' : '');
          if (sent.length) Promise.all(sent.map(function (t) { return t.state === 'sending' ? waitFor(t) : t; })).then(function () { load(d); });
          else render(d);
        };
        d.querySelector('#net-save').onclick = save;
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) save(); });
        d.querySelector('#net-tabs').onclick = function (e) {
          var b = e.target.closest('button[data-k]');
          if (b) { tab = b.getAttribute('data-k'); render(d); }
        };
        d.querySelector('#net-local').onclick = function () { app.openRecords(); };
        render(d);
        load(d);
      }
    );
  }
  function waitFor(t) {
    return new Promise(function (ok) { var iv = setInterval(function () { if (t.state !== 'sending') { clearInterval(iv); ok(t); } }, 100); });
  }
  function load(d) {
    api('api/board?n=10').then(function (o) { cache = o; render(d); }, function (e) {
      var body = d.querySelector('#net-body');
      if (body && document.contains(body)) body.innerHTML = '<p class="net-msg err">' + esc(e.message) + '</p>';
    });
  }
  function table(list, empty) {
    if (!list.length) return '<p class="net-empty">' + empty + '</p>';
    var mine = me.name.toLowerCase();
    return '<div class="table-wrap"><table class="rec net-rank"><thead><tr><th class="num">순위</th><th>이름</th><th class="num">기록</th></tr></thead><tbody>' +
      list.map(function (r, i) {
        return '<tr' + (mine && r.name.toLowerCase() === mine ? ' class="me"' : '') + '><td class="num">' + (i + 1) + '</td><td>' + esc(r.name) +
          (r.hints ? ' <small>힌트 ' + r.hints + '</small>' : '') + '</td><td class="num">' + fmt(r.ms) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function render(d) {
    if (!d || !document.contains(d)) return;
    var bs = d.querySelectorAll('#net-tabs button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-checked', String(bs[i].getAttribute('data-k') === tab));
    var body = d.querySelector('#net-body');
    if (!cache) return;
    var lv = cache.levels.filter(function (l) { return l.key === tab; })[0];
    // 서버 컴퓨터(localhost)에서 열었으면 다른 컴퓨터가 들어올 내부망 주소를, 아니면 지금 주소를 알려 준다.
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var addr = local ? cache.addrs && cache.addrs[0] : location.origin;
    var foot = '<p class="net-foot">큰 화면 순위표 <a href="board" target="_blank" rel="noopener">' + esc(location.origin) + '/board</a> · ' +
      (addr ? '다른 컴퓨터에서는 <b>' + esc(addr) + '</b>로 들어오면 같이 할 수 있어요.' : '지금은 이 컴퓨터에서만 들어올 수 있게 켜져 있어요.') + '</p>';
    if (REMOTE) {
      // 인터넷: 이 게임 주소를 알려 주면 누구나 같이 한다. 플레이어는 이 창에서 순위를 보고, board.html은 관리용으로만 둔다(링크하지 않음).
      var game = location.href.split(/[?#]/)[0].replace(/index\.html$/, '');
      foot = '<p class="net-foot">이 주소를 알려 주면 누구나 같이 할 수 있어요: <b>' + esc(game) + '</b></p>';
    }
    body.innerHTML =
      '<h3 class="rec-h">오늘의 판 · ' + dayText(cache.day) + ' · 첫 도전 <small>' + lv.dailyCount + '명</small></h3>' +
      table(lv.daily, '아직 아무도 오늘의 판 ' + lv.name + '을 풀지 않았어요. 첫 기록의 주인공이 되어 보세요.') +
      '<h3 class="rec-h">역대 최고 · 일반 판 <small>' + lv.bestCount + '명</small></h3>' +
      table(lv.best, '아직 기록이 없어요.') + foot;
  }

  // '기록' 버튼 이름을 '순위표'로 바꾸고, 이름이 없으면 한 번 알려 준다.
  function syncLabel() {
    var b = document.getElementById('btn-records');
    if (!b) return;
    b.textContent = '순위표';
    b.title = me.name ? '순위표 · ' + me.name : '순위표 · 이름을 정하면 기록이 올라가요';
  }
  // 처음 들어온 브라우저에는 무엇을 기록하는지 한 번 알린다. 확인을 누르면 다시 띄우지 않는다.
  function showNotice() {
    var bar = document.createElement('div');
    bar.className = 'net-notice';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<p><b>이 게임은 플레이 기록을 모아요.</b> 판마다 결과·시간·클릭 순서·화면 설정과 접속한 컴퓨터 주소(IP)·브라우저 정보·브라우저 번호를 남기고, ' +
      '이름을 정하면 이름도 함께 남아요. 순위표와 게임을 고치는 데만 써요. 이기면 이름을 정해 순위표에 올릴 수 있어요.</p>' +
      '<button type="button" class="btn">확인</button>';
    bar.querySelector('button').onclick = function () { me.noticed = 1; saveMe(); bar.parentNode.removeChild(bar); };
    document.body.appendChild(bar);
  }
  window.addEventListener('DOMContentLoaded', function () {
    syncLabel();
    if (!me.noticed) showNotice();
    else if (!me.name && MS.app && MS.app.toast) MS.app.toast((REMOTE ? '순위표에' : '이 컴퓨터 순위표 서버에') + ' 연결된 게임이에요. 이기면 이름을 정해 기록을 올릴 수 있어요.', 4200);
    var mq = function (q) { try { return matchMedia(q).matches; } catch (e) { return false; } };
    event('visit', { w: innerWidth, h: innerHeight, dpr: Math.round(devicePixelRatio * 100) / 100, touch: mq('(pointer: coarse)'),
      lang: navigator.language || '', ref: document.referrer ? String(document.referrer).split('/')[2] || '' : '' });
    if (MS.app && MS.app.renderer && !MS.app.renderer.ok) event('nogl', {});
  });

  MS.net = { win: win, mount: mount, openBoard: openBoard, play: play, checkVersion: checkVersion, get bid() { return me.bid; }, get name() { return me.name; }, get pending() { return pending.length; } };
})();
