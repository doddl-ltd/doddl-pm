// The listing agent's image repaint, on the server (Jon 2026-11-16: "the agent should take the images and create
// translated versions for each other market"). The same layout as the browser button (lib/pm/imagePaint.js): each text
// panel is filled with the colour around it and the translation is set in doddl's brand font, Nunito 600 / 800
// (lib/fonts, SIL Open Font License, from Google Fonts). Server only: @napi-rs/canvas.
import path from 'node:path'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { layoutBlock, lineOrigin, panelColour, eraseText } from './imagePaint'

const FAMILY = { regular: 'doddlNunito600', bold: 'doddlNunito800' }
let ready = false
function fonts() {
  if (ready) return
  const dir = path.join(process.cwd(), 'lib', 'fonts')
  GlobalFonts.registerFromPath(path.join(dir, 'Nunito-600.ttf'), FAMILY.regular)
  GlobalFonts.registerFromPath(path.join(dir, 'Nunito-800.ttf'), FAMILY.bold)
  ready = true
}
const font = (bold, size) => `${size}px ${bold ? FAMILY.bold : FAMILY.regular}`

/** Repaint one image (its bytes) with the translated blocks. Returns { png, flags, width, height }. */
export async function paintImage(bytes, blocks) {
  fonts()
  const img = await loadImage(Buffer.from(bytes))
  const W = img.width, H = img.height
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const measure = (t, size, bold) => { ctx.font = font(bold, size); return ctx.measureText(t).width }
  const flags = [], laid = []
  for (const b of blocks || []) {
    const l = layoutBlock(b, W, H, measure)
    const ring = []
    const f = l.fill, band = Math.max(2, Math.round(l.lineGap * 0.12))
    const read = (x, y, w, h) => {
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y))
      const w0 = Math.min(W - x0, Math.round(w)), h0 = Math.min(H - y0, Math.round(h))
      if (w0 < 1 || h0 < 1) return
      const d = ctx.getImageData(x0, y0, w0, h0).data
      for (let i = 0; i < d.length; i += 16) ring.push([d[i], d[i + 1], d[i + 2]])
    }
    read(f.x, f.y - band, f.w, band); read(f.x, f.y + f.h, f.w, band); read(f.x - band, f.y, band, f.h); read(f.x + f.w, f.y, band, f.h)
    const panel = panelColour(ring, b.background)
    if (!panel.flat) flags.push(`"${String(b.text).slice(0, 40)}" is not on a flat colour`)
    if (!l.fits) flags.push(`"${String(b.translated).slice(0, 40)}" had to be set small to fit`)
    // Take off only the letters (eraseText), so the shapes and shading around them stay: no rectangle patch.
    // Claude's box can be a little tight: the eraser looks a third of a line further out on every side.
    const p = Math.max(8, Math.round(l.lineGap * 0.45)), m = Math.round(p * 1.5), rx = Math.max(0, Math.floor(f.x) - m), ry = Math.max(0, Math.floor(f.y) - m)
    const rw = Math.min(W - rx, Math.ceil(f.w) + m * 2), rh = Math.min(H - ry, Math.ceil(f.h) + m * 2)
    const region = ctx.getImageData(rx, ry, rw, rh)
    eraseText(region.data, rw, rh, { x: Math.max(0, f.x - rx - p), y: Math.max(0, f.y - ry - p), w: f.w + p * 2, h: f.h + p * 2 }, b.color, panel.flat ? panel.colour : b.background, { halo: l.lineGap * 0.05 })
    ctx.putImageData(region, rx, ry)
    laid.push([b, l])
  }
  // Every old block is taken off before any new words go on, so one block's eraser never touches another's translation.
  for (const [b, l] of laid) {
    ctx.fillStyle = b.color
    ctx.textBaseline = 'alphabetic'
    l.lines.forEach((line, i) => {
      let { x, y } = lineOrigin(l, b, i)
      for (const run of line.runs) { ctx.font = font(run.bold, l.size); ctx.fillText(run.t, x, y); x += ctx.measureText(run.t).width }
    })
  }
  return { png: canvas.toBuffer('image/png'), flags, width: W, height: H }
}
