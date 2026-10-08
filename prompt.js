/* ═══════════════════════════════════════════════════════════════
   Pinpoint — shared model, storage and prompt builder.
   Loaded by both the inspector (index.html) and the raw view
   (annotations.html), so both always agree on the data shape.
   ═══════════════════════════════════════════════════════════════ */
window.PP = (() => {
'use strict';

const PAGE_FILE = 'webpage.html';
const STORE_KEY = 'pinpoint.v2';

const TAGS = {
  bug:     { label: 'Bug',     color: '#f26464' },
  design:  { label: 'Design',  color: '#9b87f5' },
  text:    { label: 'Text',    color: '#3fb5f0' },
  layout:  { label: 'Layout',  color: '#f5a524' },
  feature: { label: 'Feature', color: '#3ecf8e' }
};
const VPS = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
const FORMATS = {
  cursor: 'For repo-aware agents like Cursor, Claude Code or Aider. Edits files directly.',
  chat:   'For chat models. Asks for the files it needs and replies with diffs.',
  report: 'A readable Markdown review for humans and tickets.'
};
const DEFAULT_OPTS = { target: 'cursor', html: true, css: true, mods: true, resolved: false, wrap: true, notes: '' };

/* ─── helpers ─── */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const code = s => '`' + s + '`';
const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';
const clone = o => JSON.parse(JSON.stringify(o));

/* ─── storage ─── */
// Only serialisable fields: the live DOM node and edit snapshot are dropped.
const SER_KEYS = ['id', 'saved', 'resolved', 'tag', 'comment', 'selector', 'path', 'label',
                  'size', 'fx', 'fy', 'vp', 'html', 'computed', 'orig', 'changes'];
const serialize = a => SER_KEYS.reduce((o, k) => (o[k] = a[k], o), {});

function save(anns, source) {
  const payload = {
    version: 2,
    file: PAGE_FILE,
    updatedAt: new Date().toISOString(),
    source,
    annotations: anns.map(serialize)
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch {}
  return payload;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (d && Array.isArray(d.annotations)) return d;
  } catch {}
  return { version: 2, file: PAGE_FILE, updatedAt: null, source: null, annotations: [] };
}
const clear = () => { try { localStorage.removeItem(STORE_KEY); } catch {} };

/* ─── change descriptions ─── */
function nudgeWords(n) {
  const p = [];
  if (n.x) p.push(`${Math.abs(n.x)}px ${n.x > 0 ? 'right' : 'left'}`);
  if (n.y) p.push(`${Math.abs(n.y)}px ${n.y > 0 ? 'down' : 'up'}`);
  return p.join(' and ');
}
function describeChanges(a) {
  const c = a.changes, o = a.orig, n = c.nudge, out = [];
  if (c.bg) out.push({ prop: 'background-color', from: o.bg, to: c.bg, sw: c.bg, text: `bg ${o.bg} → ${c.bg}` });
  if (c.color) out.push({ prop: 'color', from: o.color, to: c.color, sw: c.color, text: `text ${o.color} → ${c.color}` });
  if (c.border) out.push({ prop: o.borderNone ? 'border' : 'border-color', from: o.border, to: o.borderNone ? `1px solid ${c.border}` : c.border, sw: c.border,
    text: `border ${o.border} → ${c.border}` });
  if (n.x || n.y) out.push({ prop: n.mode === 'margin' ? 'margin' : 'transform',
    from: n.mode === 'margin' ? `${o.mt}px 0 0 ${o.ml}px (top/left)` : 'none',
    to: n.mode === 'margin' ? `margin-top: ${o.mt + n.y}px; margin-left: ${o.ml + n.x}px` : `translate(${n.x}px, ${n.y}px)`,
    text: `${n.mode === 'margin' ? 'margin' : 'move'} ${n.x >= 0 ? '+' : ''}${n.x}, ${n.y >= 0 ? '+' : ''}${n.y}` });
  if (c.text !== null) out.push({ prop: 'text', from: o.text, to: c.text, text: 'text edited' });
  return out;
}
function suggestedCss(a) {
  const c = a.changes, o = a.orig, n = c.nudge, d = [];
  if (c.bg) d.push(`background-color: ${c.bg};`);
  if (c.color) d.push(`color: ${c.color};`);
  if (c.border) d.push(o.borderNone ? `border: 1px solid ${c.border};` : `border-color: ${c.border};`);
  if (n.x || n.y) {
    if (n.mode === 'margin') d.push(`margin-top: ${o.mt + n.y}px;`, `margin-left: ${o.ml + n.x}px;`);
    else d.push(`transform: translate(${n.x}px, ${n.y}px);`);
  }
  return d.length ? `${a.selector} {\n  ${d.join('\n  ')}\n}` : '';
}

/* ─── prompt builder ─── */
function annBlock(a, i, o) {
  const L = [], ch = describeChanges(a);
  L.push(`### #${i + 1} · ${TAGS[a.tag].label}${a.resolved ? ' · resolved' : ''}`);
  L.push(`- **Selector:** ${code(a.selector)}`);
  L.push(`- **Element:** ${code(a.label)} · ${a.size.w}×${a.size.h}px · captured at ${a.vp.w}px (${VPS[a.vp.name]})`);
  L.push('', '**Request**', a.comment.trim() ? a.comment.trim().split('\n').map(l => '> ' + l).join('\n') : '> _(no comment, see visual modifications)_');
  if (o.mods && ch.length) {
    L.push('', '**Visual modifications (prototyped live in the browser)**');
    ch.forEach(c => {
      if (c.prop === 'text') L.push(`- Text content: "${c.from}" → "${c.to}"`);
      else if (c.prop === 'transform') L.push(`- Position: moved ${nudgeWords(a.changes.nudge)} · Original: ${code('none')} → Modified: ${code('transform: ' + c.to)}`);
      else if (c.prop === 'margin') L.push(`- Position: moved ${nudgeWords(a.changes.nudge)} · Original: ${code(c.from)} → Modified: ${code(c.to)}`);
      else L.push(`- ${code(c.prop)}: Original: ${code(c.from)} → Modified: ${code(c.to)}`);
    });
    const css = suggestedCss(a);
    if (css) L.push('', fence('css', css));
  }
  if (o.css) {
    const t = Object.entries(a.computed).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    L.push('', '**Computed styles and design tokens (before any change)**', fence('css', `${a.selector} {\n${t}\n}`));
  }
  if (o.html) L.push('', '**HTML context**', fence('html', a.html));
  return L.join('\n');
}

function buildPrompt(anns, opts) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const items = anns.filter(a => a.saved !== false).filter(a => o.resolved || !a.resolved);
  if (!items.length) return '';
  const page = PAGE_FILE;
  const blocks = items.map((a, i) => annBlock(a, i, o)).join('\n\n---\n\n');
  const notes = o.notes ? `- Notes from the reviewer: ${o.notes}\n` : '';
  const n = items.length, plural = n === 1 ? '' : 's';
  let out;
  if (o.target === 'cursor') {
    out = `# Task: apply visual QA feedback to the UI

Act as a senior frontend engineer with write access to this repository. Apply the ${n} annotated change${plural} below by editing the source files that render the matching elements.

## Ground rules
1. Selectors come from the *rendered* DOM of ${code(page)}. Locate the owning component, template or stylesheet by searching for the class names, ids, text content and HTML context given for each item.
2. Make the smallest correct edit. Reuse existing design tokens, CSS variables and utility classes (e.g. Tailwind) before introducing new values.
3. "Visual modifications" were prototyped live with inline styles. Translate them into proper stylesheet or utility-class changes. Never ship inline styles or \`!important\`.
4. If an item was captured at a Tablet or Mobile width, scope the change to the matching breakpoint. Otherwise apply it at all sizes.
5. Do not touch unrelated code and do not reformat files.
6. Aider: add the relevant files with \`/add\` first, then answer with SEARCH/REPLACE blocks.
7. When finished, print a changelog: \`#N → file:line — what changed\`.

## Context
- Page: ${page}
${notes}
## Annotations

${blocks}`;
  } else if (o.target === 'chat') {
    out = `You are a senior frontend engineer. Below is structured visual feedback captured with a browser inspector on ${code(page)}. Turn it into precise code changes.

<instructions>
1. The selectors were read from the rendered DOM and may not match your source exactly. Use class names, text and the HTML context to map each item to a component.
2. If you do not have the source files, first list the files or components you need me to paste, then wait.
3. Otherwise reply with one unified diff (\`\`\`diff) per file, containing the smallest change that satisfies each request.
4. Visual modifications were prototyped with inline styles. Express them as proper CSS, utility classes or design tokens, with no \`!important\`.
5. If an item was captured at a Tablet or Mobile width, scope it to the matching media query.
6. End with a checklist that explains how to verify each annotation visually.
</instructions>
${notes ? `\n<context>\n${notes}</context>\n` : ''}
<annotations count="${n}">

${blocks}

</annotations>`;
  } else {
    const open = items.filter(a => !a.resolved).length;
    const rows = items.map((a, i) => `| ${i + 1} | ${TAGS[a.tag].label} | ${code(trunc(a.selector, 60))} | ${a.resolved ? 'Resolved' : 'Open'} | ${trunc((a.comment.trim() || describeChanges(a).map(c => c.text).join(', ') || '—').replace(/\|/g, '\\|').replace(/\n/g, ' '), 70)} |`).join('\n');
    out = `# Visual review report

- **Page:** ${page}
- **Date:** ${new Date().toISOString().slice(0, 10)}
- **Annotations:** ${n} (${open} open, ${n - open} resolved)
${notes}
| # | Tag | Selector | Status | Summary |
|---|-----|----------|--------|---------|
${rows}

## Details

${blocks}`;
  }
  return o.wrap ? '````markdown\n' + out + '\n````' : out;
}

return { PAGE_FILE, STORE_KEY, TAGS, VPS, FORMATS, DEFAULT_OPTS,
         esc, trunc, code, fence, clone,
         save, load, clear, serialize,
         nudgeWords, describeChanges, suggestedCss, buildPrompt };
})();
