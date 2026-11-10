// B2B campaigns (docs/b2b-campaigns): the list, the create wizard and one campaign, in one view.
// Approvals open in the existing approval card (onOpenApproval -> the approvals view).
import { useState } from 'react'
import CampaignsList from './CampaignsList'
import CreateWizard from './CreateWizard'
import CampaignDetail from './CampaignDetail'
import OutreachReport from './OutreachReport'
import { defaultFetcher } from './kit'

export default function B2BView({ userName, isMobile, onOpenApproval, fetcher = defaultFetcher, initial = { name: 'list' } }) {
  const [screen, setScreen] = useState(initial)
  const go = (s) => { setScreen(s); if (typeof window !== 'undefined') window.scrollTo(0, 0) }
  const common = { userName, isMobile, fetcher, onOpenApproval }
  if (screen.name === 'create') {
    return <CreateWizard key={screen.id || screen.typeId || 'new'} {...common} campaignId={screen.id || null} typeId={screen.typeId || null}
      onBack={() => go(screen.id ? { name: 'detail', id: screen.id } : { name: 'list' })} onSubmitted={(id) => go({ name: 'detail', id })} />
  }
  if (screen.name === 'report') return <OutreachReport isMobile={isMobile} fetcher={fetcher} onBack={() => go({ name: 'list' })} />
  if (screen.name === 'detail') {
    return <CampaignDetail key={screen.id} {...common} id={screen.id} onBack={() => go({ name: 'list' })} onEdit={() => go({ name: 'create', id: screen.id })} />
  }
  return <CampaignsList {...common} onReport={() => go({ name: 'report' })} onNew={(typeId) => go({ name: 'create', typeId: typeId || null })} onOpen={(c) => go(c.stage === 'draft' ? { name: 'create', id: c.id } : { name: 'detail', id: c.id })} />
}
