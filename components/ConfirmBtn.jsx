import { useEffect, useState } from 'react'

/** A button that asks on the page itself (no browser pop-up): the first click arms it, a second click within 6 s acts. */
export default function ConfirmBtn({ as: As, onConfirm, label, confirmLabel = 'Click again to confirm', disabled, ...rest }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 6000); return () => clearTimeout(t) }, [armed])
  return <As {...rest} disabled={disabled} onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>{armed ? confirmLabel : label}</As>
}
