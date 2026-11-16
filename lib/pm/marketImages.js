// Which images each Amazon store should carry. Pure, so the browser can use it too (masterSend.js re-exports it).
export const ENGLISH = ['UK', 'US', 'CA', 'IE']
export const LANGUAGE = { DE: 'German', FR: 'French', ES: 'Spanish', IT: 'Italian', NL: 'Dutch', BE: 'French (Belgium)', PL: 'Polish', SE: 'Swedish' }

// ─── Images: one master set for every market ───────────────────────────────
// Jon 2026-11-16: "Master images should defined, then the agent should pull to the UK, US, CA for english, and then the
// agent should take the images and create translated versions for each other market". images.MASTER is the set (older
// masters kept theirs under UK). English stores take it as it is; every other store takes, slot by slot, the approved
// translation of that image (image_translations), the image itself when it has no words to translate, and the main image
// as it is (never translated). A slot still being translated is not ready, so nothing is sent for it.
export const masterImages = (m) => { const i = (m && m.images) || {}; return Array.isArray(i.MASTER) && i.MASTER.length ? i.MASTER : (Array.isArray(i.UK) ? i.UK : []) }
export function marketImages(master, market, translations = []) {
  const src = masterImages(master).filter(x => x && x.url)
  const english = ENGLISH.includes(market) || !LANGUAGE[market]
  const by = new Map((translations || []).filter(t => t.locale === market).map(t => [t.source_url, t]))
  return src.map((x, i) => {
    const slot = i === 0 ? 'MAIN' : `PT${String(i).padStart(2, '0')}`
    if (english || i === 0) return { slot, url: x.url, source: x.url, ready: true, translation: null }
    const t = by.get(x.url)
    if (t && t.status === 'approved' && t.url) return { slot, url: t.url, source: x.url, ready: true, translation: 'approved' }
    if (t && t.status === 'no_text') return { slot, url: x.url, source: x.url, ready: true, translation: 'no_text' }
    return { slot, url: null, source: x.url, ready: false, translation: t ? t.status : null }
  })
}

