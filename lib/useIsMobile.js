import { useEffect, useState } from 'react'

// Phone layout below this width (tablets in portrait and up keep the desktop layout).
export const MOBILE_MAX_WIDTH = 767
const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`

// True on a phone-width screen, updated live on resize / rotation. False during the
// server render and the first client render (the app is behind sign-in, so the
// loading screen covers the switch). The media-query change event alone can be missed
// when the viewport settles just after load, so resize and rotation re-check too.
export function useIsMobile() {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener ? mq.addEventListener('change', update) : mq.addListener(update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', update) : mq.removeListener(update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return mobile
}
