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
  const lineGap0 = Math.max(4, block.line_height * H)
  const words = wordsOf(runsOf(block.translated, block.weight === 'bold'))
  // English line breaks are kept only where the translation has its own; otherwise wrap to the box width.
  let scale = 1, lines = [], lineGap = lineGap0, size = lineGap0 * FONT_TO_LINE, fits = false
  for (; scale >= 0.55; scale -= 0.05) {
    lineGap = lineGap0 * scale
    size = lineGap * FONT_TO_LINE
    lines = []
    let cur = [], width = 0
    const space = (bold) => measure(' ', size, bold)
    for (const w of words) {
      if (w.br) { lines.push({ runs: cur, width }); cur = []; width = 0; continue }
      const ww = measure(w.t, size, w.bold)
      const add = cur.length ? space(w.bold) + ww : ww
      if (cur.length && width + add > box.w * 1.04) { lines.push({ runs: cur, width }); cur = [w]; width = ww } else { cur.push(w); width += add }
    }
    if (cur.length) lines.push({ runs: cur, width })
    const tall = lines.length * lineGap
    const wide = Math.max(0, ...lines.map((l) => l.width))
    if (tall <= box.h * 1.18 + lineGap * 0.2 && wide <= box.w * 1.06) { fits = true; break }
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
