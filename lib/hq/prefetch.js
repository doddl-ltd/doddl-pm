// Reports (/hub) are a separate app served from this address. While someone is in another doddlHQ section, fetch its
// page and ask the browser to pre-load the scripts and styles it uses, so opening the first report is quick.
let done = false

export function prefetchReports() {
  if (done || typeof window === 'undefined') return
  done = true
  const run = async () => {
    try {
      const html = await (await fetch('/hub', { credentials: 'same-origin' })).text()
      const urls = new Set([...html.matchAll(/(?:src|href)="([^"]+\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))
      for (const u of urls) {
        if (document.querySelector(`link[href="${u}"]`)) continue
        const l = document.createElement('link')
        l.rel = 'prefetch'
        l.href = u
        l.as = u.endsWith('.css') ? 'style' : 'script'
        document.head.appendChild(l)
      }
    } catch { /* only a speed-up */ }
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
