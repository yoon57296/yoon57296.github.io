/* Turns data/resume.json into DOM. Used by the monitor panel in the room (index.html) and by the full page (resume/).
   Empty fields and empty sections are skipped, so the JSON only needs what you have. */
(function () {
  'use strict';
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const link = (href, text) => { const a = h('a', '', text); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return a; };
  const paras = (text, cls) => String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(s => h('p', cls, s));

  function entry(it) {
    const box = h('div', 'rs-entry');
    const head = h('div', 'rs-head');
    const title = h('b', 'rs-title');
    if (it.href) title.append(link(it.href, it.title || '')); else title.textContent = it.title || '';
    head.append(title);
    if (it.period) head.append(h('span', 'rs-period', it.period));
    box.append(head);
    if (it.org) box.append(h('div', 'rs-org', it.org));
    if (it.desc) box.append(...paras(it.desc, 'rs-desc'));
    if (it.points && it.points.length) { const ul = h('ul', 'rs-points'); it.points.forEach(p => ul.append(h('li', '', p))); box.append(ul); }
    return box;
  }
  function section(title, items) {
    if (!items || !items.length) return null;
    const s = h('section', 'rs-sec');
    s.append(h('h3', 'rs-h', title), ...items.map(entry));
    return s;
  }

  window.renderResume = function (r, opts) {
    opts = opts || {};
    const f = document.createDocumentFragment();
    if (r.example) f.append(h('p', 'rs-example', '예시 내용이에요. data/resume.json을 고치면 여기 바로 반영돼요.'));
    const top = h('header', 'rs-top');
    if (opts.heading !== false) top.append(h(opts.headingTag || 'h1', 'rs-name', r.name || ''));
    if (r.role) top.append(h('div', 'rs-role', r.role));
    const meta = h('div', 'rs-links');
    if (r.location) meta.append(h('span', '', r.location));
    (r.links || []).forEach(l => l && l.href && meta.append(link(l.href, (l.label || l.href) + ' ↗')));
    if (r.pdf) { const a = link(opts.base ? opts.base + r.pdf : r.pdf, 'PDF 이력서 ↓'); a.setAttribute('download', ''); meta.append(a); }
    if (meta.childNodes.length) top.append(meta);
    f.append(top);
    f.append(...paras(r.summary, 'rs-summary'));
    [section('경력', r.experience), section('프로젝트', r.projects), section('학력', r.education)].forEach(s => s && f.append(s));
    if (r.skills && r.skills.length) {
      const s = h('section', 'rs-sec'), ul = h('ul', 'rs-skills');
      r.skills.forEach(k => ul.append(h('li', '', k)));
      s.append(h('h3', 'rs-h', '기술'), ul); f.append(s);
    }
    const etc = section('그 밖에', r.etc); if (etc) f.append(etc);
    return f;
  };
})();
