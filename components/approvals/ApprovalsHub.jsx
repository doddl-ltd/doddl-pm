// The 'approvals' view: the inbox (GET /api/approvals) and, when one is open, its card. The open card is
// mirrored in the URL (/?view=approvals&task=<id>), which is also the Teams deep link.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import ApprovalsInbox from './ApprovalsInbox'
import ApprovalCard from './ApprovalCard'
import { callJson } from './ui'

const defaultFetcher = (path, init) => callJson(apiFetch, path, init)

function setUrl(taskId) {
  if (typeof window === 'undefined' || !window.history) return
  const url = taskId ? `/?view=approvals&task=${encodeURIComponent(taskId)}` : '/?view=approvals'
  if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, '', url)
}

export default function ApprovalsHub({ userName, isMobile, initialTaskId, onBadge, onNavigate, fetcher = defaultFetcher, initialData = null }) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('mine')
  const [open, setOpen] = useState(initialTaskId ? { id: initialTaskId } : null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const d = await fetcher('/api/approvals')
      setData(d)
      if (onBadge) onBadge(d.badge || 0)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [fetcher, onBadge])
  useEffect(() => { if (!initialData) load() }, [initialData, load])
  useEffect(() => { if (initialTaskId) setOpen({ id: initialTaskId }) }, [initialTaskId])
  useEffect(() => { setUrl(open?.id || null) }, [open])

  const openCard = (id, index, total) => {
    setOpen({ id, index: typeof index === 'number' ? index : -1, total })
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }
  const back = () => { setOpen(null); load() }

  if (open) {
    const mineIds = (data?.mine || []).map(r => r.id)
    const nextId = mineIds.find(id => id !== open.id)
    return (
      <ApprovalCard key={open.id} taskId={open.id} userName={userName} isMobile={isMobile} fetcher={fetcher}
        position={open.index >= 0 ? { index: open.index, total: open.total } : null}
        onBack={back} onDecided={() => load()}
        onNext={nextId ? () => openCard(nextId, 0, Math.max(0, mineIds.length - 1)) : undefined} />
    )
  }
  return (
    <ApprovalsInbox data={data} loading={loading} error={error} isMobile={isMobile} userName={userName}
      tab={tab} setTab={setTab} onOpen={openCard} onNavigate={onNavigate} />
  )
}
