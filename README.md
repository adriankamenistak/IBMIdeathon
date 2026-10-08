# Pinpoint — Visual Inspector & AI Prompt Builder

Single-file web app (`index.html`, no build step) for turning visual UI feedback into execution-ready prompts for AI coding agents (Cursor, Aider, Claude, GPT).

## Run

```bash
python3 -m http.server 8000   # or just open index.html in Chrome/Edge
```

## Demo flow (≈60 s)

1. Press **I** (or **Inspect** in the toolbar) and hover the demo page — DevTools-style box model, selector and size badge.
2. Click the grey hero subtitle → pin **#1** drops and the comment popover opens. Type a comment, set the type to **Bug**, and change the text colour to `64748B`.
3. Click the CTA button row → switch Position to **Margin** and press **←** a few times to fix the off-center row.
4. Click the headline → Text **Edit** and change the copy.
5. Press **B** to compare with the original, then **E** → *Export prompt* → **Copy to clipboard** and paste into Cursor.

## Features

- Viewport switcher: Desktop (auto), Tablet (1024px), Mobile (420px) with scale-to-fit.
- Hover inspector: margin / border / content boxes, `tag.class` label, `W × H`, DOM path.
- Numbered pins anchored where you clicked, following scroll and layout changes.
- Popover: comment, category tag, background / text / border color pickers, arrow-key nudging (offset, margin or padding), inline text editing — all applied live.
- Original → Modified log per annotation, with design-token and Tailwind class matching.
- Sidebar: filter, click-to-scroll-and-highlight, edit, resolve, delete (with undo).
- Export: Cursor/Aider task list, Claude/GPT XML prompt, or Markdown QA report; toggles for HTML context, computed CSS + `:root` tokens, modifications log.
- Annotations persist in `localStorage` per target page.

## Loading other pages

Browsers block scripts from reading cross-origin iframes, so the target is always rendered as a same-origin `srcdoc` document:

- **Demo site** — built in, works offline.
- **Paste HTML** — paste page source or DevTools `outerHTML`; add a base URL so relative CSS / images resolve.
- **Fetch URL** — works for CORS-enabled origins (most local dev servers); public sites usually refuse.

Page scripts are disabled by default; enable **Run page scripts** for JS-rendered apps.

## Keyboard

`I` inspect · `E` export · `B` compare · `\` sidebar · `1/2/3` viewport · arrows nudge (Shift = 10px) · `Ctrl/⌘+Enter` save · `Esc` close
