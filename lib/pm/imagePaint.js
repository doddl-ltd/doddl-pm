// How a translated block is set on a repainted listing image (lib/pm/imageTranslate.js). Pure: the browser passes in its
// canvas text measure, so the same layout can be tested without a canvas. The brand font is Nunito: regular words at
// weight 600, bold at 800 (doddl's listing images).
export const FONT = 'Nunito'
export const WEIGHT = { regular: 600, bold: 800 }
const FONT_TO_LINE = 0.8 // Nunito's type size is about 80% of its line spacing

/** "Learn to use **easily**" -> runs [{ t: 'Learn to use ', bold: false }, { t: 'easily', bold: true }] */
export function runsOf(text, baseBold = false) {
  const out = []
  const parts = String(text || '').split('**')
  parts.forEach((p, i) => { if (p) out.push({ t: p, bold: i % 2 === 1 ? !baseBold : baseBold }) })
  return out
}

/** Words with their weight, keeping explicit line breaks as { br: true }. */
function wordsOf(runs) {
  const words = []
  for (const r of runs) {
    r.t.split(/(\n)/).forEach((seg) => {
      if (seg === '\n') { words.push({ br: true }); return }
      for (const w of seg.split(/\s+/).filter(Boolean)) words.push({ t: w, bold: r.bold })
    })
  }
  return words
}

/**
 * Lay a block out in its box. measure(text, sizePx, bold) -> width in px. Returns { size, lineGap, lines, box, fill }
 * where lines are [{ runs: [{ t, bold }], width }] and positions are in px. Shrinks the type until it fits (never below
 * 55% of the original size; fits is false then, and the check will say so).
 */
export function layoutBlock(block, W, H, measure) {
  const box = { x: block.x * W, y: block.y * H, w: block.w * W, h: block.h * H }
  // The type size comes from the English itself where it can: the widest English line, set in the brand font, filled the
  // box, so that size is the original's (Claude's line spacing is the fallback, and bounds it). Jon 2026-11-16 test: sizes
  // from the line spacing alone came out too small.
  let size0 = Math.max(4, block.line_height * H) * FONT_TO_LINE
  const enLines = String(block.text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (enLines.length) {
    const wide = Math.max(...enLines.map((l) => runsOf(l, block.weight === 'bold').reduce((n, r) => n + measure(r.t, 100, r.bold), 0)))
    if (wide > 0) size0 = Math.min(Math.max((100 * box.w) / wide, size0 * 0.7), size0 * 1.6)
  }
  const lineGap0 = Math.max(Math.max(4, block.line_height * H), size0 / FONT_TO_LINE * 0.95)
  const words = wordsOf(runsOf(block.translated, block.weight === 'bold'))
  // English line breaks are kept only where the translation has its own; otherwise wrap to the box width. A longer
  // translation may take a little more width and more lines (centred on the same spot) before the type is made smaller.
  let scale = 1, lines = [], lineGap = lineGap0, size = size0, fits = false
  for (; scale >= 0.55; scale -= 0.04) {
    lineGap = lineGap0 * scale
    size = size0 * scale
    lines = []
    let cur = [], width = 0
    const space = (bold) => measure(' ', size, bold)
    for (const w of words) {
      if (w.br) { lines.push({ runs: cur, width }); cur = []; width = 0; continue }
      const ww = measure(w.t, size, w.bold)
      const add = cur.length ? space(w.bold) + ww : ww
      if (cur.length && width + add > box.w * 1.12) { lines.push({ runs: cur, width }); cur = [w]; width = ww } else { cur.push(w); width += add }
    }
    if (cur.length) lines.push({ runs: cur, width })
    const tall = lines.length * lineGap
    const wide = Math.max(0, ...lines.map((l) => l.width))
    if (tall <= box.h * 1.3 + lineGap * 0.2 && wide <= box.w * 1.14 && scale >= 0.7) { fits = true; break }
  }
  const pad = lineGap0 * 0.18
  return {
    size, lineGap, fits,
    box,
    fill: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: Math.min(W, box.w + pad * 2), h: Math.min(H, box.h + pad * 2) },
    lines: lines.map((l) => ({ width: l.width, runs: l.runs.map((w, i) => ({ t: (i ? ' ' : '') + w.t, bold: w.bold })) })),
  }
}

/** Where line i starts (left x, baseline y), for the block's alignment. */
export function lineOrigin(layout, block, i) {
  const { box, lineGap, size, lines } = layout
  const total = lines.length * lineGap
  const top = box.y + Math.max(0, (box.h - total) / 2)
  const x = block.align === 'center' ? box.x + (box.w - lines[i].width) / 2 : block.align === 'right' ? box.x + box.w - lines[i].width : box.x
  return { x, y: top + lineGap * i + (lineGap + size * 0.7) / 2 }
}

/** The panel colour: the most common colour on the ring just outside the fill area; Claude's reading when unsure. */
export function panelColour(pixels, fallback) {
  const count = new Map()
  for (const [r, g, b] of pixels) {
    const k = `${r >> 3},${g >> 3},${b >> 3}`
    const e = count.get(k) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b
    count.set(k, e)
  }
  let best = null
  for (const e of count.values()) if (!best || e.n > best.n) best = e
  if (!best || best.n < pixels.length * 0.35) return { colour: fallback, flat: false }
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0')
  return { colour: `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`, flat: true }
}

const rgb = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(h || '')); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null }
const dist = (d, i, c) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2])

/**
 * Takes the old words off the image without a patch (Jon 2026-11-16 test: a rectangle clipped the splat's curve). Inside
 * the block's area, pixels close to the text colour (and 2 px around them, for the soft edges) are the letters; each is
 * filled from the nearest non-letter pixels on its row and its column, so curves, edges and soft shading stay. In place
 * on RGBA data (width W). Returns the share of the area that was letters.
 */
export function eraseText(data, W, H, area, textHex, panelHex, { halo = 2 } = {}) {
  let tc = rgb(textHex)
  const pc = rgb(panelHex)
  if (!tc) return 0
  const x0 = Math.max(0, Math.floor(area.x)), y0 = Math.max(0, Math.floor(area.y))
  const x1 = Math.min(W, Math.ceil(area.x + area.w)), y1 = Math.min(H, Math.ceil(area.y + area.h))
  const w = x1 - x0, h = y1 - y0
  if (w < 2 || h < 2) return 0
  // A pixel is part of a letter when its colour lies on the way from the background to the text colour (soft edges
  // included, from 10% of the way), and not off to the side of that line (another shape's colour, like a splat's edge).
  // The background is the commonest colour in the area itself (the panel the words sit on), else the one given.
  const bins = new Map()
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = ((y0 + y) * W + x0 + x) * 4, k = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3)
    const e = bins.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += data[i]; e[2] += data[i + 1]; e[3] += data[i + 2]; bins.set(k, e)
  }
  let top = null
  for (const e of bins.values()) if (!top || e[0] > top[0]) top = e
  const bg = top && top[0] > (w * h) / 4 * 0.2 ? [top[1] / top[0], top[2] / top[0], top[3] / top[0]] : (pc || [255, 255, 255])
  // The letters' own colour: the commonest colour in the area that is clearly not the background and nearest the colour
  // Claude read (its reading can be a few shades off the pixels).
  let best = null
  for (const e of bins.values()) {
    const c = [e[1] / e[0], e[2] / e[0], e[3] / e[0]]
    if (Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) < 60 || Math.hypot(c[0] - tc[0], c[1] - tc[1], c[2] - tc[2]) > 90) continue
    if (!best || e[0] > best[0]) best = [e[0], c]
  }
  if (best) tc = best[1]
  const g = [tc[0] - bg[0], tc[1] - bg[1], tc[2] - bg[2]], gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] || 1
  const core = new Uint8Array(w * h), third = new Uint8Array(w * h), G = Math.sqrt(gg)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * W + x0 + x) * 4
    const v = [data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]]
    const t = (v[0] * g[0] + v[1] * g[1] + v[2] * g[2]) / gg
    const off = Math.hypot(v[0] - t * g[0], v[1] - t * g[1], v[2] - t * g[2])
    if (t > 0.1 && off < 14 + t * G * 0.12) core[y * w + x] = 1
    // a third colour (another shape, the edge of a splat): letters are never taken from right next to it
    else if (off > Math.max(40, G * 0.3) && Math.hypot(v[0], v[1], v[2]) > 40 && Math.hypot(data[i] - tc[0], data[i + 1] - tc[1], data[i + 2] - tc[2]) > 70) third[y * w + x] = 1
  }
  const by = (map, x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w && map[yy * w + xx]) return true } return false }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (core[y * w + x] && by(third, x, y, 4)) core[y * w + x] = 0
  const near = (x, y) => { const i = ((y0 + y) * W + x0 + x) * 4; return Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) < 45 }
  const R = Math.max(2, Math.round(halo)), mask = new Uint8Array(w * h)
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let hit = 0
    for (let dy = -R; dy <= R && !hit; dy++) for (let dx = -R; dx <= R && !hit; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w && core[yy * w + xx]) hit = 1 }
    // the halo only takes pixels close to the background: never the edge of another shape next to the words
    if (hit && (core[y * w + x] || !by(third, x, y, 2))) { mask[y * w + x] = 1; n++ }
  }
  if (!n) return 0
  // Fill: each letter pixel takes the average of the clean background around it (not a letter, not another shape),
  // from summed-area tables, so soft shading carries through and nothing streaks.
  const W1 = w + 1, S = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))], N = new Float64Array(W1 * (h + 1))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y + 1) * W1 + x + 1, i = ((y0 + y) * W + x0 + x) * 4
    const ok = !mask[y * w + x] && !third[y * w + x] && near(x, y) ? 1 : 0
    for (let c = 0; c < 3; c++) S[c][k] = S[c][k - 1] + S[c][k - W1] - S[c][k - W1 - 1] + (ok ? data[i + c] : 0)
    N[k] = N[k - 1] + N[k - W1] - N[k - W1 - 1] + ok
  }
  const box = (A, xa, ya, xb, yb) => A[yb * W1 + xb] - A[ya * W1 + xb] - A[yb * W1 + xa] + A[ya * W1 + xa]
  const r0 = Math.max(6, Math.round(R * 3))
  const out = new Uint8ClampedArray(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue
    let col = bg
    for (let r = r0; r <= r0 * 8; r *= 2) {
      const xa = Math.max(0, x - r), ya = Math.max(0, y - r), xb = Math.min(w, x + r + 1), yb = Math.min(h, y + r + 1)
      const cn = box(N, xa, ya, xb, yb)
      if (cn >= 8) { col = [box(S[0], xa, ya, xb, yb) / cn, box(S[1], xa, ya, xb, yb) / cn, box(S[2], xa, ya, xb, yb) / cn]; break }
    }
    out[(y * w + x) * 3] = col[0]; out[(y * w + x) * 3 + 1] = col[1]; out[(y * w + x) * 3 + 2] = col[2]
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue
    const i = ((y0 + y) * W + x0 + x) * 4
    for (let c = 0; c < 3; c++) data[i + c] = out[(y * w + x) * 3 + c]
  }
  return n / (w * h)
}
