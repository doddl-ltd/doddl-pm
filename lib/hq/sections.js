// doddlHQ navigation (design agreed by Jon 2026-11-16, canvas https://claude.ai/artifact/Jk8JvgaJwiLGVwoQA1Xk6A).
// One purple rail of sections; each section has its own brand colour (brand book p56 only) and a row of folder tabs.
// A tab is either a PM view (`view`) or a Hub report directory (`reports`). Pure: shared by the shell and the tests.

export const BRAND = ['#3D157D', '#947FB6', '#c0b5d8', '#e0daeb', '#f2ece5', '#EAEAEA', '#d6ebe7', '#9ecfc6', '#30BEAA', '#eec682', '#e8a5a9', '#dd6c92', '#fff']

// Hub reports render inside the doddlHQ frame (doddl-reports components/hub/HqFrame.js) and open in the same tab.
// This address already serves /hub (next.config.js rewrites), but signing in there needs https://doddl-pm.vercel.app/hub
// on the "doddl-hub" Entra app, added by Jon 2026-11-16, so reports open at this address.
export const HUB_ORIGIN = ''
export const hubLink = (path) => HUB_ORIGIN + path

// Every Hub report, grouped as the Hub's own menu (doddl-reports components/hub/nav.js), with Stock and inventory moved
// to Finance and inventory (Jon 2026-11-16). [title, Hub path, one line, finance access?]
export const REPORTS = {
  dashboard: {
    label: 'Dashboard', blurb: 'The whole business on one screen; every figure opens its full report.',
    groups: [
      { h: 'Today', dot: '#9ecfc6', items: [['Daily read', '/hub', 'Yesterday across Amazon and the website']] },
      { h: 'Start here', dot: '#c0b5d8', items: [['D2C overview', '/hub/ecommerce/d2c', 'Website sales, orders and customers'], ['Marketing overview', '/hub/marketing', 'What we spent and what it bought'], ['D2C P&L', '/hub/finance', 'What we made after costs', true]] },
    ],
  },
  ecommerce: {
    label: 'Ecommerce', blurb: 'What sold, where and to whom.',
    groups: [
      { h: 'Sales', dot: '#9ecfc6', items: [['Daily read', '/hub', 'Yesterday, every channel'], ['D2C overview', '/hub/ecommerce/d2c', 'Website sales and orders']] },
      { h: 'Amazon', dot: '#eec682', items: [['Overview', '/hub/amazon/overview', 'Sales, traffic, conversion by store'], ['Search and market', '/hub/amazon/search', 'Search terms, rank, share'], ['ASIN performance', '/hub/amazon/asins', 'Every product, every store']] },
      { h: 'Website', dot: '#c0b5d8', items: [['Overview', '/hub/website/overview', 'Sessions, conversion, revenue'], ['Checkout and site', '/hub/website/checkout', 'Where people drop out'], ['Orders and fulfilment', '/hub/website/orders', 'Shipping and returns']] },
      { h: 'Products', dot: '#e8a5a9', items: [['Summary', '/hub/products', 'How the range is selling'], ['Categories', '/hub/products/categories', 'Cutlery, plates, bowls, kits'], ['Master SKU and mix', '/hub/products/mix', 'Bundles split into units'], ['SKU table', '/hub/products/master', 'Every SKU in one table'], ['Bundles and basket', '/hub/products/basket', 'Add-ons and what goes together'], ['Product funnel', '/hub/products/funnel', 'View to cart to order']] },
      { h: 'Customers', dot: '#30BEAA', items: [['Customers and retention', '/hub/customers', 'New, returning, repeat rate'], ['Customer voice', '/hub/customers/voice', 'Reviews and messages']] },
    ],
  },
  marketing: {
    label: 'Marketing', blurb: 'What we spent, what it bought, and how the brand and audience are growing.',
    groups: [
      { h: 'Performance', dot: '#e8a5a9', items: [['Marketing overview', '/hub/marketing', 'Spend and what it bought'], ['Paid media', '/hub/marketing/paid', 'Meta, Google, Amazon Ads'], ['Creatives and audiences', '/hub/marketing/creatives', 'Which ads, and who saw them'], ['Attribution', '/hub/marketing/attribution', 'What really drove the sale'], ['Acquisition and traffic', '/hub/marketing/acquisition', 'Where visitors come from']] },
      { h: 'Owned', dot: '#eec682', items: [['Email, CRM and sign-ups', '/hub/marketing/email', 'Klaviyo flows and campaigns'], ['Organic social', '/hub/marketing/social', 'Instagram, TikTok, Facebook']] },
      { h: 'Brand and market', dot: '#c0b5d8', items: [['Peers and movers', '/hub/marketing/peers', 'Brands like us'], ['Search and AI share of voice', '/hub/marketing/search', 'Where we show up'], ['What parents ask', '/hub/marketing/parents', 'Questions in the wild'], ['Content series tracker', '/hub/marketing/content', 'How each series performs']] },
      { h: 'Reporting', dot: '#9ecfc6', items: [['Monthly report', '/hub/marketing/report', 'The month on one page'], ['Tracking and consent', '/hub/marketing/tracking', 'Can we trust the data']] },
    ],
  },
  finance: {
    label: 'Finance and inventory', blurb: 'What we made, what it cost, whether it ties to Xero, and the stock we hold.',
    groups: [
      { h: 'Profit', dot: '#9ecfc6', items: [['D2C P&L', '/hub/finance', 'What we made after costs', true], ['Unit economics', '/hub/finance/unit-economics', 'The Hub against Accounts', true], ['Channel economics', '/hub/finance/economics', 'What each channel costs to run', true], ['Amazon profitability', '/hub/finance/amazon-profit', 'Store by store', true]] },
      { h: 'Month end', dot: '#c0b5d8', items: [['Amazon accrual', '/hub/finance/accrual', 'Month-end Amazon figures', true], ['Reconciliation and VAT', '/hub/finance/checks', 'Ties to Xero', true], ['Payouts and cash', '/hub/finance/payouts', 'Money in from each channel', true]] },
      { h: 'Plan', dot: '#eec682', items: [['Targets and budget', '/hub/finance/targets', 'Against plan', true], ['Costs and overheads', '/hub/finance/costs', 'Where the money goes', true]] },
      { h: 'Inventory', dot: '#e8a5a9', items: [['Stock and inventory', '/hub/amazon/stock', 'Cover and reorder by store']] },
    ],
  },
  mine: {
    label: 'My reports', blurb: 'Reports made for you from Requests, and the ones you use most.',
    groups: [],
  },
}
export const REPORT_TABS = Object.keys(REPORTS)

// HQ pages that live in the Hub today.
export const HQ_LINKS = {
  agents: [['Agent runs', '/hub/agents', 'Every run and what it cost'], ['Controls', '/hub/agents/controls', 'Switch agents on and off'], ['Spend', '/hub/agents/spend', 'Claude cost by agent'], ['Failures', '/hub/agents/failures', 'What broke and why'], ['Chat with HQ', '/hub/agents/chat', 'Ask the agents anything']],
  data: [['Data health', '/hub/admin/coverage', 'Is every feed fresh'], ['Products and mapping', '/hub/data/products', 'SKUs, ASINs, bundles'], ['Amazon transaction mapping', '/hub/data/mapping', 'Fees into the right lines'], ['Settlement reconciliation', '/hub/data/reconciliation', 'Amazon pays what we expect'], ['Reference tables', '/hub/admin', 'Costs, rates, rules'], ['Glossary', '/hub/glossary', 'What every number means']],
}

// c = header colour, big = the splat's lighter tone, acc = the active tab's stripe, ink = header text.
export const SECTIONS = [
  { key: 'home', label: 'Home', c: '#c0b5d8', big: '#e0daeb', acc: '#947FB6', ink: '#3D157D', icon: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
    title: (u) => (u ? `Hello, ${u}` : 'Home'), sub: 'What needs you today, across the whole business.',
    tabs: [{ key: 'home', label: 'My day', view: 'home' }, { key: 'inbox', label: 'Notifications', view: 'inbox', badge: 'unread' }] },
  { key: 'projects', label: 'Projects', c: '#e8a5a9', big: '#f2ece5', acc: '#dd6c92', ink: '#3D157D', icon: 'M3 6h7l2 2h9v11H3z',
    title: () => 'Projects', sub: 'Every project by programme: what it is, who has it and when it lands.',
    tabs: [{ key: 'mywork', label: 'My work', view: 'mywork', badge: 'mine' }, { key: 'myprojects', label: 'My projects', view: 'myprojects' }, { key: 'board', label: 'All projects', view: 'board', menu: 'projects' }, { key: 'triage', label: 'Triage', view: 'triage', badge: 'triage' }] },
  { key: 'requests', label: 'Requests', c: '#eec682', big: '#f2ece5', acc: '#dd6c92', ink: '#3D157D', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15 9l-2 5-4 1 2-5z',
    title: () => 'Requests', sub: 'One front door for every ask, one-off or ongoing: reports, campaigns, pages, products, IP, decks and doddlHQ itself.',
    tabs: [{ key: 'new', label: 'New request', view: 'requests', sub: 'new', alias: ['form'] }, { key: 'board', label: 'All requests', view: 'requests', sub: 'board', alias: ['detail'] }, { key: 'standing', label: 'Standing work', view: 'requests', sub: 'standing' }, { key: 'inbox', label: 'Waiting on me', view: 'requests', sub: 'inbox', badge: 'requests' }] },
  { key: 'approvals', label: 'Approvals', c: '#3D157D', big: '#947FB6', acc: '#dd6c92', ink: '#fff', pip: '#fff', icon: 'M5 12l5 5 9-10',
    title: () => 'Approvals', sub: 'What changes, why, and what it costs. Nothing goes out until it is approved here.',
    tabs: [{ key: 'approvals', label: 'Waiting on me', view: 'approvals', badge: 'approvals' }, { key: 'approvers', label: 'Who approves what', view: 'approvers' }] },
  { key: 'reports', label: 'Reports', c: '#9ecfc6', big: '#d6ebe7', acc: '#30BEAA', ink: '#3D157D', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    title: () => 'Reports', sub: 'Every report, from the Hub. Hover a tab to find one.',
    tabs: REPORT_TABS.map((k) => ({ key: k, label: REPORTS[k].label, view: 'reports', sub: k, menu: k === 'mine' ? null : 'reports', href: k === 'mine' ? null : hubLink(REPORTS[k].groups[0].items[0][1]) })) },
  { key: 'studio', label: 'Studio', c: '#30BEAA', big: '#9ecfc6', acc: '#eec682', ink: '#3D157D', icon: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
    title: () => 'Studio', sub: 'Where things get made: creative, the content calendar and the Amazon listings.',
    tabs: [{ key: 'studio', label: 'Creative studio', view: 'studio' }, { key: 'calendar', label: 'Content calendar', view: 'calendar' }, { key: 'listings', label: 'Amazon listings', view: 'listings' }, { key: 'media', label: 'Image library', view: 'media' }] },
  { key: 'b2b', label: 'B2B', c: '#e0daeb', big: '#c0b5d8', acc: '#e8a5a9', ink: '#3D157D', icon: 'M8 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5',
    title: () => 'B2B', sub: 'Nurseries, retailers and partners, from first email to first order, sent from doddl\'s own mailboxes.',
    tabs: [{ key: 'b2b', label: 'Campaigns', view: 'b2b' }, { key: 'mailboxes', label: 'Mailboxes', view: 'mailboxes' }] },
  { key: 'hq', label: 'HQ', c: '#f2ece5', big: '#e0daeb', acc: '#9ecfc6', ink: '#3D157D', icon: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    title: () => 'HQ', sub: 'The agents, the data behind every number, and the settings.',
    tabs: [{ key: 'agents', label: 'Agents', view: 'hq', sub: 'agents', menu: 'hq', href: hubLink('/hub/agents') }, { key: 'data', label: 'Data health', view: 'hq', sub: 'data', menu: 'hq', href: hubLink('/hub/admin/coverage') }] },
]
export const SECTION = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))

// Every view the app can show, mapped to its section (`idea` is the old name for Requests).
export const sectionOf = (view) => {
  if (view === 'idea') return SECTION.requests
  return SECTIONS.find((s) => s.tabs.some((t) => t.view === view)) || SECTION.home
}
// The tab that is lit for a view (+ its sub-tab, for Requests, Reports and HQ).
export const activeTab = (view, sub) => {
  const s = sectionOf(view)
  const v = view === 'idea' ? 'requests' : view
  return s.tabs.find((t) => t.view === v && (t.sub == null || t.sub === sub || (t.alias || []).includes(sub))) || s.tabs.find((t) => t.view === v) || s.tabs[0]
}
// The sub-tab a view opens on when none is given.
export const defaultSub = (view) => sectionOf(view).tabs.find((t) => t.view === (view === 'idea' ? 'requests' : view))?.sub ?? null
// Which sub-tabs are valid for a view (used to check a ?tab= in the address).
export const subsOf = (view) => sectionOf(view).tabs.filter((t) => t.view === view).flatMap((t) => [t.sub, ...(t.alias || [])]).filter(Boolean)
