// A+ page model (migration 34): Amazon's standard modules, limits, checks and the per-market text. Pure and safe in
// the browser; lib/pm/aplus.js holds the server side (saving, Claude, HQ routes).
const ENGLISH = ['UK', 'US', 'CA', 'IE']
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true })

// Amazon's standard A+ modules PM builds with: their API name, image size (pixels) and text limits (characters).
export const MODULES = {
  header: { label: 'Banner with text', amazon: 'STANDARD_HEADER_IMAGE_TEXT', image: [970, 600], headline: 150, body: 6000 },
  overlay: { label: 'Banner with text on the image', amazon: 'STANDARD_IMAGE_TEXT_OVERLAY', image: [970, 300], headline: 70, body: 300 },
  side: { label: 'Image beside text', amazon: 'STANDARD_SINGLE_SIDE_IMAGE', image: [300, 300], headline: 160, body: 1000 },
  three: { label: 'Three images with text', amazon: 'STANDARD_THREE_IMAGE_TEXT', headline: 160, blocks: 3, block: { image: [300, 300], headline: 160, body: 1000 } },
  four: { label: 'Four images with text', amazon: 'STANDARD_FOUR_IMAGE_TEXT', headline: 100, blocks: 4, block: { image: [220, 220], headline: 160, body: 1000 } },
  highlights: { label: 'Image with key points', amazon: 'STANDARD_SINGLE_IMAGE_HIGHLIGHTS', image: [300, 300], headline: 160, bullets: 6, bullet: 100 },
  text: { label: 'Text only', amazon: 'STANDARD_TEXT', headline: 160, body: 5000 },
}
export const MAX_MODULES = 5
export const ALT_MAX = 100

/** Does an image fill a module slot of W×H once cropped to that shape (centred)? */
export function fits(img, [W, H]) {
  if (!img || !img.w || !img.h) return false
  const cropW = Math.min(img.w, (img.h * W) / H)
  return cropW >= W - 0.5
}

const str = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max * 2)

/** Normalises a module list to the shapes above (unknown keys dropped). Pure. */
export function cleanModules(raw) {
  if (!Array.isArray(raw)) throw fail(400, 'modules must be a list')
  if (raw.length > MAX_MODULES) throw fail(400, `At most ${MAX_MODULES} modules`)
  return raw.map((m, i) => {
    if (!isObj(m) || !MODULES[m.type]) throw fail(400, `modules[${i}].type must be one of ${Object.keys(MODULES).join(', ')}`)
    const d = MODULES[m.type]
    const out = { type: m.type, headline: str(m.headline, d.headline) }
    if (d.body) out.body = str(m.body, d.body)
    if (d.image) out.image = typeof m.image === 'string' ? m.image.slice(0, 40) : ''
    if (m.type === 'overlay') out.overlay = m.overlay === 'light' ? 'light' : 'dark'
    if (m.type === 'side') out.side = m.side === 'right' ? 'right' : 'left'
    if (d.bullets) out.bullets = (Array.isArray(m.bullets) ? m.bullets : []).map(b => str(b, d.bullet)).filter(Boolean).slice(0, d.bullets)
    if (d.blocks) out.blocks = Array.from({ length: d.blocks }, (_, k) => { const b = isObj(m.blocks && m.blocks[k]) ? m.blocks[k] : {}; return { headline: str(b.headline, d.block.headline), body: str(b.body, d.block.body), image: typeof b.image === 'string' ? b.image.slice(0, 40) : '' } })
    return out
  })
}

/** Everything that stops a page being approved or sent: text over Amazon's limits, missing or too-small images. Pure. */
export function aplusProblems(modules, images) {
  const out = []
  const byId = Object.fromEntries((images || []).map(x => [x.id, x]))
  const len = (s) => [...String(s || '')].length
  if (!modules.length) out.push('No modules yet')
  modules.forEach((m, i) => {
    const d = MODULES[m.type], at = `Module ${i + 1} (${d.label})`
    if (!m.headline) out.push(`${at}: no headline`)
    if (len(m.headline) > d.headline) out.push(`${at}: headline is ${len(m.headline)} characters, Amazon allows ${d.headline}`)
    if (d.body && len(m.body) > d.body) out.push(`${at}: text is ${len(m.body)} characters, Amazon allows ${d.body}`)
    const img = (id, size, where) => {
      if (!id) { out.push(`${at}: ${where} has no image`); return }
      const x = byId[id]
      if (!x) out.push(`${at}: ${where} uses an image that is no longer in the library`)
      else if (!fits(x, size)) out.push(`${at}: ${where} needs an image at least ${size[0]}×${size[1]} in that shape; ${x.name || 'this one'} is ${x.w}×${x.h}`)
      else if (!x.alt) out.push(`${at}: ${where} image needs alt text (what the image shows, for screen readers)`)
    }
    if (d.image) img(m.image, d.image, 'the module')
    if (d.bullets && !(m.bullets || []).length) out.push(`${at}: no key points`)
    if (d.bullets) (m.bullets || []).forEach((b, k) => { if (len(b) > d.bullet) out.push(`${at}: key point ${k + 1} is ${len(b)} characters, Amazon allows ${d.bullet}`) })
    if (d.blocks) (m.blocks || []).forEach((b, k) => {
      if (!b.headline) out.push(`${at}: block ${k + 1} has no headline`)
      if (len(b.headline) > d.block.headline) out.push(`${at}: block ${k + 1} headline is over ${d.block.headline} characters`)
      if (len(b.body) > d.block.body) out.push(`${at}: block ${k + 1} text is over ${d.block.body} characters`)
      img(b.image, d.block.image, `block ${k + 1}`)
    })
  })
  return out
}

// Every piece of text in a page, with a path, so a translation keeps the layout exactly.
export function textsOf(modules) {
  const t = []
  modules.forEach((m, i) => {
    t.push({ id: `${i}.headline`, text: m.headline || '' })
    if (m.body != null) t.push({ id: `${i}.body`, text: m.body })
    ;(m.bullets || []).forEach((b, k) => t.push({ id: `${i}.bullets.${k}`, text: b }))
    ;(m.blocks || []).forEach((b, k) => { t.push({ id: `${i}.blocks.${k}.headline`, text: b.headline }); t.push({ id: `${i}.blocks.${k}.body`, text: b.body }) })
  })
  return t.filter(x => x.text)
}
export function withTexts(modules, texts) {
  const out = JSON.parse(JSON.stringify(modules))
  for (const { id, text } of texts) {
    const p = String(id).split('.')
    const m = out[Number(p[0])]
    if (!m) continue
    if (p.length === 2 && (p[1] === 'headline' || p[1] === 'body')) m[p[1]] = text
    else if (p[1] === 'bullets' && m.bullets && p[2] != null) m.bullets[Number(p[2])] = text
    else if (p[1] === 'blocks' && m.blocks && m.blocks[Number(p[2])] && (p[3] === 'headline' || p[3] === 'body')) m.blocks[Number(p[2])][p[3]] = text
  }
  return out
}

/** The modules a market gets: the UK English page for English markets, the approved translation otherwise. */
export function modulesFor(page, market) {
  if (ENGLISH.includes(market)) return { modules: page.modules, reviewed_by: null }
  const v = (page.variants || {})[market]
  if (!v || v.status !== 'approved') return null
  return { modules: v.modules, reviewed_by: v.approved_by }
}

/** Where a sent page is on Amazon, from the daily read: its document (by reference key) and Amazon's status. Pure. */
export function aplusLiveState(send, product) {
  if (!send || send.status !== 'sent' || !send.ref) return null
  const doc = ((product && product.aplus) || []).find(d => d.ref === send.ref)
  if (!doc) return { state: 'waiting', why: 'Created on Amazon. Waiting for the next read' }
  if (doc.status === 'APPROVED') return { state: 'live', why: 'Amazon approved it: it is the live A+ page' }
  if (doc.status === 'REJECTED') return { state: 'problem', why: 'Amazon rejected it. Open Seller Central A+ Content Manager for Amazon\'s reasons' }
  return { state: 'waiting', why: `With Amazon for review (${String(doc.status).toLowerCase()})` }
}
