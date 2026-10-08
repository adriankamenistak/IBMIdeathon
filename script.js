(() => {
'use strict';

/* ═══════════════ Helpers ═══════════════ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const icon = (id, cls = 'i') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

/* Shared model + prompt builder (prompt.js) */
const { PAGE_FILE, TAGS, VPS, FORMATS, esc, trunc, clone,
        describeChanges, suggestedCss, buildPrompt } = window.PP;

/* ═══════════════ State ═══════════════ */
const S = {
  frame: null, doc: null, win: null, host: null, sr: null, L: {}, ro: null,
  inspect: true, broken: false, anns: [], editing: null, nextId: 1, filter: 'all', step: 1,
  vp: 'desktop', title: '', reloads: 0,
  backups: new Map(), pathCache: new WeakMap(), raf: 0, lastMove: null
};

/* ═══════════════ Color utilities ═══════════════ */
const cvs = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function parseColor(str) {
  str = (str || '').trim(); if (!str) return null;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(str);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
  }
  cvs.clearRect(0, 0, 1, 1); cvs.fillStyle = '#000'; cvs.fillStyle = str; cvs.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = cvs.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 };
}
function colorInfo(str) {
  const c = parseColor(str);
  if (!c) return { label: str || '', hex: null };
  if (c.a === 0) return { label: 'transparent', hex: null };
  const hex = '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  return { label: c.a < 1 ? `${hex} @${Math.round(c.a * 100)}%` : hex, hex };
}

/* ═══════════════ Toast ═══════════════ */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ═══════════════ DOM identification ═══════════════ */
function labelOf(el) {
  const cls = [...el.classList].slice(0, 3).map(c => '.' + c).join('');
  return el.localName + (el.id ? '#' + el.id : '') + cls;
}
function segOf(el, forceNth) {
  if (el.id && S.doc.querySelectorAll('#' + CSS.escape(el.id)).length === 1)
    return { s: el.localName + '#' + CSS.escape(el.id), stop: true };
  let s = el.localName + [...el.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
  const p = el.parentElement;
  if (p) {
    const sibs = [...p.children].filter(x => x.localName === el.localName);
    if (sibs.length > 1) {
      let need = forceNth;
      if (!need) { try { need = p.querySelectorAll(':scope > ' + s).length > 1; } catch { need = true; } }
      if (need) s += `:nth-of-type(${sibs.indexOf(el) + 1})`;
    }
  }
  return { s, stop: false };
}
function buildPath(el, forceNth) {
  const parts = []; let n = el;
  while (n && n.nodeType === 1 && n !== S.doc.documentElement) {
    const { s, stop } = segOf(n, forceNth); parts.unshift(s); if (stop) break; n = n.parentElement;
  }
  return parts;
}
function selectorOf(el) {
  if (S.pathCache.has(el)) return S.pathCache.get(el);
  let parts = buildPath(el, false);
  const unique = p => { try { return S.doc.querySelectorAll(p.join(' > ')).length === 1; } catch { return false; } };
  if (!unique(parts)) parts = buildPath(el, true);
  if (parts.length > 1 && parts[0] === 'body' && unique(parts.slice(1))) parts = parts.slice(1);
  const r = { selector: parts.join(' > '), path: parts };
  S.pathCache.set(el, r); return r;
}
function getEl(a) {
  if (!S.doc) return null;
  if (a.el && a.el.isConnected && a.el.ownerDocument === S.doc) return a.el;
  try { a.el = S.doc.querySelector(a.selector); } catch { a.el = null; }
  return a.el;
}

/* ═══════════════ Capturing element data ═══════════════ */
function computedTokens(el) {
  const cs = S.win.getComputedStyle(el), g = p => cs.getPropertyValue(p), o = {};
  const add = (k, v) => { if (v && !['normal', 'none', 'auto', '0px', 'transparent', '0px 0px'].includes(v)) o[k] = v; };
  const sides = p => { const [t, r, b, l] = ['top', 'right', 'bottom', 'left'].map(s => g(`${p}-${s}`));
    return t === r && r === b && b === l ? t : t === b && r === l ? `${t} ${r}` : `${t} ${r} ${b} ${l}`; };
  add('display', g('display'));
  if (g('position') !== 'static') add('position', g('position'));
  add('font-family', g('font-family')); add('font-size', g('font-size')); add('font-weight', g('font-weight'));
  add('line-height', g('line-height')); add('letter-spacing', g('letter-spacing')); add('text-align', g('text-align'));
  add('color', colorInfo(g('color')).label); add('background-color', colorInfo(g('background-color')).label);
  add('margin', sides('margin')); add('padding', sides('padding'));
  if (g('border-top-style') !== 'none' && parseFloat(g('border-top-width')) > 0)
    add('border', `${g('border-top-width')} ${g('border-top-style')} ${colorInfo(g('border-top-color')).label}`);
  add('border-radius', g('border-top-left-radius')); add('box-shadow', g('box-shadow'));
  return o;
}
function snippet(el) {
  let h = el.outerHTML.replace(/\s*\n\s*/g, '\n').trim();
  if (h.length > 900) { h = h.slice(0, 900); h = h.slice(0, h.lastIndexOf('>') + 1) + '\n<!-- …truncated -->'; }
  return h;
}
function capture(el, ev) {
  const r = el.getBoundingClientRect(), cs = S.win.getComputedStyle(el);
  const bg = colorInfo(cs.backgroundColor), fg = colorInfo(cs.color), bd = colorInfo(cs.borderTopColor);
  const borderNone = cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0;
  const { selector, path } = selectorOf(el);
  const canText = el.children.length === 0 && el.textContent.trim().length > 0;
  return {
    id: S.nextId++, saved: false, resolved: false, tag: 'design', comment: '',
    el, selector, path, label: labelOf(el),
    size: { w: Math.round(r.width), h: Math.round(r.height) },
    fx: clamp((ev.clientX - r.left) / Math.max(r.width, 1), 0, 1), fy: clamp((ev.clientY - r.top) / Math.max(r.height, 1), 0, 1),
    vp: { name: S.vp, w: S.frame.clientWidth },
    html: snippet(el), computed: computedTokens(el),
    orig: {
      bg: bg.label, bgHex: bg.hex, color: fg.label, colorHex: fg.hex,
      border: borderNone ? 'none' : bd.label, borderHex: borderNone ? '#4f8cff' : bd.hex, borderNone,
      text: canText ? el.textContent : null, transform: cs.transform,
      ml: parseFloat(cs.marginLeft) || 0, mt: parseFloat(cs.marginTop) || 0
    },
    changes: { bg: null, color: null, border: null, text: null, nudge: { x: 0, y: 0, mode: 'transform' } }
  };
}

/* ═══════════════ Live style engine ═══════════════
   Every tweak is re-derived from the annotation list: restore pristine inline styles,
   then re-apply all changes. This keeps original/modified logs exact and revert trivial. */
function restoreAll() {
  S.backups.forEach((b, el) => {
    if (!el.isConnected) return;
    b.style == null ? el.removeAttribute('style') : el.setAttribute('style', b.style);
    if (b.textChanged) { el.textContent = b.text; b.textChanged = false; }
  });
}
function hasChanges(a) {
  const c = a.changes;
  return !!(c.bg || c.color || c.border || c.text !== null || c.nudge.x || c.nudge.y);
}
function applyAnn(a) {
  const el = getEl(a); if (!el || !hasChanges(a)) return;
  const c = a.changes, o = a.orig;
  let b = S.backups.get(el);
  if (!b) { b = { style: el.getAttribute('style'), text: null, textChanged: false }; S.backups.set(el, b); }
  const set = (p, v) => el.style.setProperty(p, v, 'important');
  if (c.bg) set('background-color', c.bg);
  if (c.color) set('color', c.color);
  if (c.border) { set('border-color', c.border); if (o.borderNone) { set('border-style', 'solid'); set('border-width', '1px'); } }
  const n = c.nudge;
  if (n.x || n.y) {
    if (n.mode === 'margin') { set('margin-left', (o.ml + n.x) + 'px'); set('margin-top', (o.mt + n.y) + 'px'); }
    else set('transform', `translate(${n.x}px, ${n.y}px)` + (o.transform && o.transform !== 'none' ? ' ' + o.transform : ''));
  }
  if (c.text !== null) { if (!b.textChanged) { b.text = el.textContent; b.textChanged = true; } el.textContent = c.text; }
}
const applyAll = () => S.anns.forEach(applyAnn);
function reapply() { restoreAll(); applyAll(); }
function pristine(fn) { restoreAll(); try { return fn(); } finally { applyAll(); } }

/* ═══════════════ Inspector layer (shadow DOM inside the target page) ═══════════════ */
const LAYER_CSS = `
:host{all:initial}
[hidden]{display:none!important}
.hl,.sel,.flash{position:absolute;pointer-events:none;box-sizing:border-box}
.hl{outline:1.5px solid #4f8cff;outline-offset:-1px;background:rgba(79,140,255,.10)}
.sel{outline:2px solid #4f8cff;outline-offset:-1px;background:rgba(79,140,255,.05)}
.flash{outline:2px solid #4f8cff;outline-offset:-1px;animation:fl 1.4s ease-out forwards}
@keyframes fl{0%{box-shadow:0 0 0 0 rgba(79,140,255,.6);background:rgba(79,140,255,.22)}100%{box-shadow:0 0 0 18px rgba(79,140,255,0);background:rgba(79,140,255,0)}}
.badge{position:absolute;pointer-events:none;max-width:min(520px,92vw);padding:5px 8px;border-radius:6px;background:#141417;border:1px solid #2c2c32;color:#ececef;box-shadow:0 8px 24px rgba(0,0,0,.45);font:11px/1.45 "JetBrains Mono","SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.b1{display:flex;gap:4px;align-items:baseline;white-space:nowrap}
.b1 b{color:#74a5ff;font-weight:600}.b1 i{color:#a1a1aa;font-style:normal;overflow:hidden;text-overflow:ellipsis}.b1 span{margin-left:auto;padding-left:12px;color:#71717a}
.b2{color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pins{position:absolute;left:0;top:0}
.pin{position:absolute;box-sizing:border-box;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;pointer-events:auto;cursor:pointer;border:2px solid #fff;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .12s cubic-bezier(.2,.8,.2,1)}
.pin:hover{transform:rotate(-45deg) scale(1.12)}
.pin span{transform:rotate(45deg);font:600 10.5px/1 Inter,ui-sans-serif,system-ui,sans-serif}
.pin.draft{border-style:dashed}
.pin.active{box-shadow:0 0 0 3px rgba(79,140,255,.55),0 2px 8px rgba(0,0,0,.35)}
.pin.resolved{opacity:.55;filter:saturate(.3)}
`;
function mountLayer() {
  const d = S.doc;
  const st = d.createElement('style'); st.id = '__vwi_style';
  st.textContent = '[data-vwi-inspect],[data-vwi-inspect] *{cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important}';
  d.head.appendChild(st);
  S.host = d.createElement('div'); S.host.id = '__vwi_host';
  S.host.setAttribute('style', 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none');
  d.documentElement.appendChild(S.host);
  S.sr = S.host.attachShadow({ mode: 'open' });
  S.sr.innerHTML = `<style>${LAYER_CSS}</style><div class="hl" hidden></div><div class="sel" hidden></div><div class="flash" hidden></div><div class="badge" hidden></div><div class="pins"></div>`;
  const q = s => S.sr.querySelector(s);
  S.L = { hl: q('.hl'), sel: q('.sel'), flash: q('.flash'), badge: q('.badge'), pins: q('.pins') };
}
function place(box, r) {
  const sx = S.win.scrollX, sy = S.win.scrollY;
  box.style.left = (r.left + sx) + 'px'; box.style.top = (r.top + sy) + 'px';
  box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
}
const validTarget = t => !!(t && t.nodeType === 1 && t !== S.host && t !== S.doc.documentElement);

function showHover(t) {
  const { L } = S, r = t.getBoundingClientRect();
  place(L.hl, r); L.hl.hidden = false;
  const { path } = selectorOf(t);
  const cls = (t.id ? '#' + t.id : '') + [...t.classList].slice(0, 3).map(c => '.' + c).join('');
  const shown = path.length > 4 ? '… > ' + path.slice(-4).join(' > ') : path.join(' > ');
  L.badge.innerHTML = `<div class="b1"><b>${esc(t.localName)}</b><i>${esc(cls)}</i><span>${Math.round(r.width)} × ${Math.round(r.height)}</span></div><div class="b2">${esc(shown)}</div>`;
  L.badge.hidden = false;
  const sx = S.win.scrollX, sy = S.win.scrollY, vw = S.doc.documentElement.clientWidth;
  const bw = L.badge.offsetWidth, bh = L.badge.offsetHeight;
  let top = r.top - bh - 6;
  if (top < 4) top = r.bottom + 6;
  if (top + bh > S.doc.documentElement.clientHeight - 4) top = Math.max(4, r.top + 6);
  const left = clamp(r.left, 4, Math.max(4, vw - bw - 4));
  L.badge.style.left = (left + sx) + 'px'; L.badge.style.top = (top + sy) + 'px';
}
function hideHover() { if (!S.L.hl) return; S.L.hl.hidden = true; S.L.badge.hidden = true; }
function flashEl(el) {
  const f = S.L.flash; f.hidden = true; place(f, el.getBoundingClientRect());
  void f.offsetWidth; f.hidden = false;
  clearTimeout(flashEl.t); flashEl.t = setTimeout(() => f.hidden = true, 1500);
}

/* Pins */
const savedList = () => S.anns.filter(a => a.saved);
const indexOf = a => a.saved ? savedList().indexOf(a) + 1 : savedList().length + 1;
function renderPins() {
  if (!S.sr) return;
  const box = S.L.pins; box.textContent = '';
  const sx = S.win.scrollX, sy = S.win.scrollY;
  S.anns.forEach(a => {
    const el = getEl(a); if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + sx + a.fx * r.width, y = r.top + sy + a.fy * r.height;
    const p = S.doc.createElement('div');
    p.className = 'pin' + (a.saved ? '' : ' draft') + (a.resolved ? ' resolved' : '') + (S.editing === a ? ' active' : '');
    p.style.cssText = `left:${x - 12}px;top:${y - 29}px;background:${TAGS[a.tag].color}`;
    p.innerHTML = `<span>${indexOf(a)}</span>`; p.title = `#${indexOf(a)} · ${TAGS[a.tag].label}`;
    p.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (S.editing !== a) openEditor(a); });
    p.addEventListener('mouseenter', () => { place(S.L.hl, el.getBoundingClientRect()); S.L.hl.hidden = false; });
    p.addEventListener('mouseleave', hideHover);
    box.appendChild(p);
  });
  const ed = S.editing && getEl(S.editing);
  if (ed) { place(S.L.sel, ed.getBoundingClientRect()); S.L.sel.hidden = false; } else S.L.sel.hidden = true;
}

/* ═══════════════ Page event handlers ═══════════════ */
function onMove(e) {
  if (!S.inspect) return;
  S.lastMove = e.target;
  if (S.raf) return;
  S.raf = requestAnimationFrame(() => {
    S.raf = 0; const t = S.lastMove;
    validTarget(t) ? showHover(t) : hideHover();
  });
}
function onPageClick(e) {
  const t = e.target;
  if (t === S.host) return;                      // a pin handled it
  if (!S.inspect) {
    const a = t.closest && t.closest('a[href]');
    if (a && !(a.getAttribute('href') || '').startsWith('#')) { e.preventDefault(); toast('Link navigation is disabled in the preview'); }
    return;
  }
  if (!validTarget(t)) return;
  e.preventDefault(); e.stopPropagation();
  closeEditor('auto');
  openDraft(t, e);
}
function onKey(e) {
  const t = e.target;
  const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ||
    (t.tagName === 'INPUT' && !['color', 'checkbox', 'radio', 'file'].includes(t.type)));
  if (e.key === 'Escape') {
    if ($('.modal.open')) { closeModals(); return; }
    if (S.editing) { e.preventDefault(); closeEditor('discard'); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && S.editing) { e.preventDefault(); saveEditor(); return; }
  if (typing || e.altKey || e.ctrlKey || e.metaKey || $('.modal.open')) return;
  const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (S.editing && dir) {
    e.preventDefault(); const k = S.step * (e.shiftKey ? 10 : 1); nudge(dir[0] * k, dir[1] * k); return;
  }
  const k = e.key.toLowerCase();
  if (k === 'i') toggleInspect();
  else if (k === 'r') loadPage();
}

function attach() {
  setLoading(false);
  let doc = null;
  try { doc = S.frame.contentDocument; } catch { doc = null; }
  if (!doc || !doc.documentElement || !doc.body) return showError('The page loaded but its DOM is not readable.');
  if (doc.URL === 'about:blank' && !doc.body.children.length) return;
  S.broken = false;
  S.title = doc.title || '';
  if (S.ro) S.ro.disconnect();
  S.doc = doc; S.win = S.frame.contentWindow; S.backups.clear();
  mountLayer();
  doc.addEventListener('mousemove', onMove, true);
  doc.documentElement.addEventListener('mouseleave', hideHover);
  doc.addEventListener('click', onPageClick, true);
  doc.addEventListener('submit', e => e.preventDefault(), true);
  doc.addEventListener('keydown', onKey, true);
  S.win.addEventListener('scroll', () => { hideHover(); requestAnimationFrame(positionPopover); }, { passive: true });
  S.win.addEventListener('resize', () => { renderPins(); positionPopover(); });
  S.win.addEventListener('load', () => renderPins());
  S.ro = new S.win.ResizeObserver(() => { renderPins(); positionPopover(); });
  S.ro.observe(doc.documentElement);
  applyInspectState();
  reapply(); renderAll(); updateDims(); updateStatus();
}

/* ═══════════════ Annotation lifecycle ═══════════════ */
function openDraft(el, ev) {
  const a = pristine(() => capture(el, ev));
  S.anns.push(a);
  openEditor(a);
  setTimeout(() => $('#popComment').focus(), 30);
}
function openEditor(a) {
  if (S.editing && S.editing !== a) closeEditor('auto');
  S.editing = a;
  a.snapshot = a.saved ? { tag: a.tag, comment: a.comment, changes: clone(a.changes) } : null;
  fillPopover(a);
  $('#popover').hidden = false;
  positionPopover(); renderAll();
}
const hasContent = a => !!a.comment.trim() || hasChanges(a);
function closeEditor(mode) {
  const a = S.editing; if (!a) return;
  if (mode === 'auto') mode = (a.saved || hasContent(a)) ? 'save' : 'discard';
  S.editing = null; $('#popover').hidden = true;
  if (mode === 'save') {
    const wasSaved = a.saved; a.saved = true; delete a.snapshot;
    if (!wasSaved) toast(`Comment #${indexOf(a)} saved`);
  } else if (!a.saved) {
    S.anns.splice(S.anns.indexOf(a), 1);
  } else if (a.snapshot) {
    a.tag = a.snapshot.tag; a.comment = a.snapshot.comment; a.changes = a.snapshot.changes; delete a.snapshot;
  }
  reapply(); renderAll();
}
function saveEditor() {
  const a = S.editing; if (!a) return;
  if (!hasContent(a)) { toast('Add a comment or a visual tweak first'); $('#popComment').focus(); return; }
  closeEditor('save');
}
function deleteAnn(a) {
  if (S.editing === a) { S.editing = null; $('#popover').hidden = true; }
  const i = S.anns.indexOf(a); if (i > -1) S.anns.splice(i, 1);
  reapply(); renderAll(); toast('Pin deleted');
}
function resetAnns() {
  S.editing = null; $('#popover').hidden = true; S.anns = []; S.backups.clear(); renderSidebar(); updateCounts(); persist();
}
/* ═══════════════ Persistence (shared with annotations.html) ═══════════════ */
function persist() { window.PP.save(savedList(), { file: PAGE_FILE, title: S.title }); }
function restore() {
  const d = window.PP.load();
  if (!d.annotations.length) return;
  S.anns = d.annotations.map(a => ({ ...a, el: null, saved: true }));
  S.nextId = Math.max(0, ...S.anns.map(a => a.id)) + 1;
}
function focusAnn(a) {
  const el = getEl(a); if (!el) { toast('That element is no longer on the page'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  flashEl(el); renderPins();
}
function afterChange() { reapply(); renderPins(); positionPopover(); syncPopover(); }
function nudge(dx, dy) { const a = S.editing; if (!a) return; a.changes.nudge.x += dx; a.changes.nudge.y += dy; afterChange(); }

/* ═══════════════ Popover UI ═══════════════ */
const COLOR_KEYS = ['bg', 'color', 'border'];
function buildChips() {
  $('#tagChips').innerHTML = Object.entries(TAGS).map(([k, t]) =>
    `<button class="chip" type="button" data-tag="${k}" style="--c:${t.color}" aria-pressed="false"><i></i>${t.label}</button>`).join('');
}
function fillPopover(a) {
  $('#popNum').textContent = indexOf(a);
  $('#popEl').textContent = a.label;
  $('#popEl').title = a.label;
  $('#popSize').textContent = `${a.size.w}×${a.size.h}`;
  $('#popSel').innerHTML = `<bdi>${esc(a.path.join(' › '))}</bdi>`;
  $('#popSel').title = a.selector;
  $('#popComment').value = a.comment;
  const tf = $('#textField'); tf.hidden = a.orig.text === null;
  if (a.orig.text !== null) $('#popText').value = a.changes.text !== null ? a.changes.text : a.orig.text;
  $('#popSaveLabel').textContent = a.saved ? 'Update' : 'Save';
  $('#popDelete').hidden = !a.saved;
  if (hasChanges(a)) $('#tweaks').open = true;
  syncPopover();
}
function syncPopover() {
  const a = S.editing; if (!a) return;
  $$('#tagChips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.tag === a.tag)));
  $('#popNum').style.background = TAGS[a.tag].color;
  COLOR_KEYS.forEach(k => {
    const row = $(`.crow[data-k="${k}"]`), inp = $('input', row), val = $('.cval', row), rst = $('.mini', row), ch = a.changes[k];
    inp.value = ch || a.orig[k + 'Hex'] || '#ffffff';
    val.textContent = ch ? `${a.orig[k]} → ${ch}` : a.orig[k]; val.classList.toggle('chg', !!ch);
    val.title = val.textContent; rst.hidden = !ch;
  });
  const n = a.changes.nudge;
  $('#nudgeRead').textContent = `x ${n.x} · y ${n.y}`;
  const nc = describeChanges(a).filter(c => c.prop !== 'text').length;
  $('#tweakCount').textContent = nc ? `${nc} change${nc > 1 ? 's' : ''}` : '';
  $$('#stepSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.step === S.step)));
  $$('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === n.mode)));
}
function positionPopover() {
  const a = S.editing, pop = $('#popover'); if (!a || pop.hidden) return;
  const el = getEl(a); if (!el) return;
  const r = el.getBoundingClientRect(), fr = S.frame.getBoundingClientRect(), st = $('#stage').getBoundingClientRect();
  const ax = fr.left - st.left + r.left + a.fx * r.width, ay = fr.top - st.top + r.top + a.fy * r.height;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = ax + 22; if (left + pw > st.width - 10) left = ax - pw - 22;
  left = clamp(left, 10, Math.max(10, st.width - pw - 10));
  const top = clamp(ay - 40, 10, Math.max(10, st.height - ph - 10));
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}
function bindPopover() {
  buildChips();
  $('#tagChips').addEventListener('click', e => {
    const b = e.target.closest('[data-tag]'); if (!b || !S.editing) return;
    S.editing.tag = b.dataset.tag; syncPopover(); renderPins();
  });
  $('#popComment').addEventListener('input', e => { if (S.editing) S.editing.comment = e.target.value; });
  $('#popComment').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeEditor('discard'); } });
  $('#popText').addEventListener('input', e => {
    const a = S.editing; if (!a) return;
    a.changes.text = e.target.value === a.orig.text ? null : e.target.value;
    if (a.changes.text !== null && a.tag === 'design') { a.tag = 'text'; }
    afterChange();
  });
  COLOR_KEYS.forEach(k => {
    $(`.crow[data-k="${k}"] input`).addEventListener('input', e => {
      const a = S.editing; if (!a) return;
      a.changes[k] = e.target.value === a.orig[k + 'Hex'] ? null : e.target.value; afterChange();
    });
  });
  $$('[data-reset]').forEach(b => b.addEventListener('click', () => { if (S.editing) { S.editing.changes[b.dataset.reset] = null; afterChange(); } }));
  $$('.pad [data-dx]').forEach(b => b.addEventListener('click', () => nudge(+b.dataset.dx * S.step, +b.dataset.dy * S.step)));
  $('[data-reset-nudge]').addEventListener('click', () => { const a = S.editing; if (a) { a.changes.nudge.x = a.changes.nudge.y = 0; afterChange(); } });
  $('#stepSeg').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) { S.step = +b.dataset.step; syncPopover(); } });
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b && S.editing) { S.editing.changes.nudge.mode = b.dataset.mode; afterChange(); } });
  $('#popClose').addEventListener('click', () => closeEditor('discard'));
  $('#popCancel').addEventListener('click', () => closeEditor('discard'));
  $('#popSave').addEventListener('click', saveEditor);
  $('#popDelete').addEventListener('click', () => S.editing && deleteAnn(S.editing));
}

/* ═══════════════ Sidebar ═══════════════ */
function updateCounts() {
  const n = savedList().length;
  const b = $('#countBadge'); b.textContent = n; b.classList.toggle('zero', !n);
  $('#sbCount').textContent = n;
  $('#btnClear').disabled = !n;
}
function shortChange(c) {
  if (c.prop === 'text') return 'text';
  if (c.prop === 'transform' || c.prop === 'margin') return c.text;
  return (c.prop === 'background-color' ? 'fill ' : c.prop === 'color' ? 'color ' : 'border ') + c.sw;
}
function renderSidebar() {
  const saved = savedList();
  const shown = saved.filter(a => S.filter === 'all' || (S.filter === 'open' ? !a.resolved : a.resolved));
  const list = $('#list'); list.innerHTML = '';
  if (!shown.length) {
    list.innerHTML = saved.length
      ? `<div class="empty"><b>Nothing here</b><p>No ${S.filter} comments.</p></div>`
      : `<div class="empty"><span class="es-icon">${icon('pin')}</span><b>No comments yet</b><p>Click any element in the preview to pin feedback.</p></div>`;
    return;
  }
  shown.forEach(a => {
    const t = TAGS[a.tag], card = document.createElement('article');
    card.className = 'card' + (a.resolved ? ' resolved' : '') + (S.editing === a ? ' active' : '');
    card.style.setProperty('--c', t.color); card.dataset.id = a.id; card.tabIndex = 0;
    const ch = describeChanges(a), note = a.comment.trim();
    card.innerHTML = `
      <span class="num">${a.resolved ? icon('check') : saved.indexOf(a) + 1}</span>
      <div class="card-top"><span class="tag">${t.label}</span><span class="vpb">${a.vp.w}px</span></div>
      <p class="preview${note ? '' : ' muted'}">${esc(note ? trunc(note, 200) : 'Style tweak only')}</p>
      <div class="crumb" title="${esc(a.selector)}"><bdi>${esc(a.path.join(' › '))}</bdi></div>
      ${ch.length ? `<div class="chgs">${ch.map(c => `<span class="chg">${c.sw ? `<i style="background:${esc(c.sw)}"></i>` : ''}${esc(trunc(shortChange(c), 28))}</span>`).join('')}</div>` : ''}
      <div class="card-actions">
        <button class="ib xs" data-act="resolve" aria-label="${a.resolved ? 'Reopen' : 'Resolve'}" title="${a.resolved ? 'Reopen' : 'Resolve'}">${icon(a.resolved ? 'undo' : 'check')}</button>
        <button class="ib xs" data-act="edit" aria-label="Edit" title="Edit">${icon('pencil')}</button>
        <button class="ib xs" data-act="del" aria-label="Delete" title="Delete">${icon('trash')}</button>
      </div>`;
    list.appendChild(card);
  });
}
function bindSidebar() {
  $('#list').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const a = S.anns.find(x => x.id === +card.dataset.id); if (!a) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') return deleteAnn(a);
    if (act === 'resolve') { a.resolved = !a.resolved; renderAll(); return; }
    focusAnn(a);
    if (act === 'edit') openEditor(a);
  });
  $('#list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('card')) e.target.click(); });
  $('#filterSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    S.filter = b.dataset.f; $$('#filterSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderSidebar();
  });
  $('#btnClear').addEventListener('click', () => {
    if (!savedList().length) return;
    if (confirm('Delete all comments and revert every style tweak?')) { S.anns = []; S.editing = null; $('#popover').hidden = true; reapply(); renderAll(); window.PP.clear(); }
  });
  $('#sidebarToggle').addEventListener('click', () => {
    const sb = $('#sidebar'), c = sb.classList.toggle('collapsed');
    $('#sidebarToggle').setAttribute('aria-expanded', String(!c));
    $('#sidebarToggle').setAttribute('aria-pressed', String(!c));
  });
}
function renderAll() { renderSidebar(); renderPins(); updateCounts(); persist(); }

/* ═══════════════ Toolbar: viewport, inspect, loading ═══════════════ */
function setViewport(vp) {
  S.vp = vp; $('#frameWrap').dataset.vp = vp;
  $$('#viewportSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vp === vp)));
  $('#frameLabel').textContent = VPS[vp];
}
function updateDims() { $('#dims').textContent = `${S.frame.clientWidth} × ${S.frame.clientHeight}`; }
function applyInspectState() {
  const on = S.inspect && !S.broken;
  $('#inspectToggle').setAttribute('aria-pressed', String(on));
  if (S.doc) on ? S.doc.documentElement.setAttribute('data-vwi-inspect', '') : S.doc.documentElement.removeAttribute('data-vwi-inspect');
  if (!on) hideHover();
  updateStatus();
}
function toggleInspect() {
  if (S.broken) return;
  S.inspect = !S.inspect; applyInspectState();
}
function setLoading(on) { $('#fileChip').classList.toggle('loading', on); }
function updateStatus() {
  $('#emptyStage').hidden = !S.broken;
  $('#frameWrap').style.visibility = S.broken ? 'hidden' : '';
  $('#inspectToggle').disabled = S.broken;
  $('#stDot').className = 'dot' + (S.broken ? ' warn' : S.doc ? ' ok' : '');
  $('#stSource').textContent = S.broken ? 'webpage.html — not loaded' : PAGE_FILE + (S.title ? ' · ' + S.title : '');
  $('#fileTitle').textContent = S.title || '';
  $('#stMode').textContent = S.broken ? '' : S.inspect ? 'Inspect mode' : 'Interact mode';
}
function showError(text) {
  S.broken = true; S.doc = null; S.sr = null; S.title = '';
  $('#esText').textContent = text;
  setLoading(false); updateStatus();
}
/* The target page is always ./webpage.html — same origin, so the DOM is fully readable.
   Saved comments survive a reload: they re-bind to elements by selector in attach(). */
async function loadPage() {
  setLoading(true);
  try {
    const r = await fetch(PAGE_FILE, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    return showError(location.protocol === 'file:'
      ? 'Open this folder over HTTP (e.g. python3 -m http.server) — browsers block file:// iframes from being inspected.'
      : `${PAGE_FILE} could not be fetched (${e.message}). Make sure it sits next to index.html.`);
  }
  S.broken = false; $('#emptyStage').hidden = true;
  S.frame.src = PAGE_FILE + '?r=' + (++S.reloads);
}

/* ═══════════════ Modals ═══════════════ */
const openModal = id => { $(id).classList.add('open'); };
function closeModals() { $$('.modal.open').forEach(m => m.classList.remove('open')); }
function bindModals() {
  $$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModals(); }));
  $$('[data-close]').forEach(b => b.addEventListener('click', closeModals));
}
function genPrompt() {
  const o = {
    target: $('input[name=target]:checked').value, html: $('#oHtml').checked, css: $('#oCss').checked,
    mods: $('#oMods').checked, resolved: $('#oResolved').checked, wrap: $('#oWrap').checked, notes: $('#oNotes').value.trim()
  };
  const text = buildPrompt(savedList(), o), box = $('#output');
  box.value = text;
  $('#fmtDesc').textContent = FORMATS[o.target];
  $('#btnCopy').disabled = $('#btnDownload').disabled = !text;
  $('#outStats').textContent = text ? `${text.length.toLocaleString()} chars · ~${Math.ceil(text.length / 4).toLocaleString()} tokens` : 'Nothing to export yet';
}
function bindExport() {
  const open = () => { closeEditor('auto'); genPrompt(); openModal('#exportModal'); };
  $('#btnExport').addEventListener('click', open);
  $$('#exportModal input').forEach(i => i.addEventListener('change', genPrompt));
  $('#oNotes').addEventListener('input', genPrompt);
  $('#btnCopy').addEventListener('click', async () => {
    const box = $('#output'), btn = $('#btnCopy'); if (!box.value) return;
    try { await navigator.clipboard.writeText(box.value); }
    catch { box.focus(); box.select(); document.execCommand('copy'); }
    btn.classList.add('ok'); $('span', btn).textContent = 'Copied';
    $('use', btn).setAttribute('href', '#i-check');
    clearTimeout(btn._t); btn._t = setTimeout(() => { btn.classList.remove('ok'); $('span', btn).textContent = 'Copy prompt'; $('use', btn).setAttribute('href', '#i-copy'); }, 1600);
  });
  $('#btnDownload').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$('#output').value], { type: 'text/markdown' }));
    a.download = 'pinpoint-feedback.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

/* ═══════════════ Init ═══════════════ */
function init() {
  S.frame = $('#frame');
  S.frame.addEventListener('load', attach);
  bindPopover(); bindSidebar(); bindModals(); bindExport();
  $('#viewportSeg').addEventListener('click', e => { const b = e.target.closest('[data-vp]'); if (b) setViewport(b.dataset.vp); });
  $('#inspectToggle').addEventListener('click', toggleInspect);
  $('#btnReload').addEventListener('click', () => loadPage());
  $('#esRetry').addEventListener('click', () => loadPage());
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', positionPopover);
  $('#tweaks').addEventListener('toggle', () => requestAnimationFrame(positionPopover));
  $$('[data-mod]').forEach(k => k.textContent = MOD + '↵');
  $$('[data-mod-key]').forEach(k => k.textContent = MOD);
  new ResizeObserver(() => { updateDims(); renderPins(); positionPopover(); }).observe(S.frame);
  // keep the raw view in sync if it edits/clears the store in another tab
  window.addEventListener('storage', e => { if (e.key === window.PP.STORE_KEY && !e.newValue) { S.anns = []; S.editing = null; $('#popover').hidden = true; reapply(); renderSidebar(); renderPins(); updateCounts(); } });
  setViewport('desktop'); restore(); renderSidebar(); updateCounts(); updateStatus();
  loadPage();
}
init();
})();