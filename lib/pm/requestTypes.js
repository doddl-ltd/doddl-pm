// The requests hub's types, forms, stages and plans (migration 35). Pure: shared by the page and the API.
// Jon 2026-11-13: one front door for every ask, one-off or ongoing, stage based, two approvals (the plan, then the
// finished work). Mockup: https://claude.ai/artifact/TiwHcEZ7MxAtdwvxV1apJy.

const F = (k, l, ph, req) => ({ k, l, ph, req: !!req })
const C = (k, l, ch, multi) => ({ k, l, ch, multi: !!multi })
const RUNS = ['How it runs', [C('cad', 'How often', ['Live', 'Daily', 'Weekly', 'Monthly']), C('owner', 'Owner', ['Jon', 'Laura', 'Catherine', 'HQ']), C('review', 'Review it every', ['Month', 'Quarter', 'Half year'])]]

export const ICONS = {
  report: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  presentation: 'M3 4h18v12H3zM12 16v4M8 20h8',
  campaign: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14',
  page: 'M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01',
  product: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  amazon: 'M4 5h2l2 10h10l2-7H7M9 20h.01M17 20h.01',
  content: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
  ip: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  pm: 'M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5L15 12l-3-3z',
  other: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z',
}

export const TYPES = {
  report: { name: 'Report or dashboard', one: 'A one-off answer from the Hub', on: 'A permanent dashboard tile or scheduled report', agent: 'Finance and data analyst',
    oneSteps: [['What', [F('q', 'What question should it answer?', 'Which channel made the most margin in October?', 1)]], ['Scope', [C('period', 'Period', ['Last month', 'Last quarter', 'Year to date', 'Custom']), C('for', 'Who is it for?', ['Me', 'Leadership', 'Accounts', 'Agency'])]]],
    onSteps: [['What to track', [F('q', 'What should it show?', 'Margin by channel, after ad spend', 1), C('lives', 'Where it lives', ['Hub dashboard tile', 'Weekly email', 'Monthly pack', 'Teams channel'], 1)]], ['Alerts', [F('alert', 'Alert me when (optional)', 'Margin falls below 35%'), C('for', 'Who sees it?', ['Me', 'Leadership', 'Accounts', 'Whole team'], 1)]], RUNS] },
  presentation: { name: 'Presentation', one: 'A deck for one meeting', on: 'A recurring pack, such as the monthly board pack', agent: 'Brand positioning, with the finance analyst for numbers',
    oneSteps: [['What', [C('aud', 'Audience', ['Investors', 'Retail buyer', 'Partner', 'Team', 'Board']), F('q', 'What must they leave believing or doing?', 'John Lewis lists the starter kit for spring', 1)]], ['Details', [C('len', 'Length', ['5 slides', '10 slides', '20 slides']), C('due', 'Needed by', ['This week', 'Next week', 'This month'])]]],
    onSteps: [['What', [C('aud', 'Pack', ['Board pack', 'Investor update', 'Retailer review', 'Team update']), F('q', 'What must every edition cover?', 'Trading, cash, stock, the month ahead', 1)]], RUNS] },
  campaign: { name: 'Campaign', one: 'A burst with an end date', on: 'Always-on ads or an email flow', agent: 'Paid social and search, or CRM for email',
    oneSteps: [['What', [C('goal', 'Goal', ['Sell more', 'New customers', 'Launch a product', 'Clear stock']), F('q', 'In one sentence, what should people see or do?', 'Grandparents buy the cutlery set as a Christmas gift', 1)]], ['Where', [C('mkt', 'Market', ['UK', 'US', 'UK and US']), C('ch', 'Channels', ['Meta', 'Google', 'Email', 'Amazon ads'], 1)]], ['Budget', [F('budget', 'Budget per day (£)', '15', 1), C('when', 'Run for', ['1 week', '3 weeks', '6 weeks'])]]],
    onSteps: [['What', [C('goal', 'Goal', ['Sell more', 'New customers', 'Win back', 'Retarget']), F('q', 'What should it keep doing?', 'Retarget site visitors who did not buy', 1)]], ['Where', [C('mkt', 'Market', ['UK', 'US', 'UK and US']), C('ch', 'Channels', ['Meta', 'Google', 'Email flow', 'Amazon ads'], 1), F('budget', 'Budget per day (£)', '25', 1)]], RUNS] },
  page: { name: 'Web page', one: 'A new or changed page on doddl.com', agent: 'Design and development', oneOnly: true,
    oneSteps: [['What', [F('q', 'What is the page for?', 'A weaning guide that links to the starter kit', 1)]], ['Where', [C('mkt', 'Sites', ['UK', 'US', 'Germany'], 1), C('from', 'Link it from', ['Menu', 'A product page', 'Ads only'])]]] },
  product: { name: 'New product set-up', one: 'Every channel set up in one go', agent: 'HQ: listing, website, stock and finance agents', oneOnly: true,
    oneSteps: [['Product', [C('kind', 'What is it?', ['New product', 'New colour', 'Bundle or kit']), F('q', 'Product name', 'Toddler bowl, sage', 1), F('sku', 'Stock code', 'DOD031', 1)]], ['Where it sells', [C('ch', 'Channels', ['Shopify UK', 'Shopify US', 'Amazon UK', 'Amazon US', 'Amazon EU', 'Wholesale'], 1)]], ['Launch', [F('price', 'UK price (£)', '14.95', 1), C('date', 'Launch', ['Within 2 weeks', 'This month', 'Next month', 'To be set']), C('stock', 'Stock landed?', ['Yes', 'On the water', 'Not ordered'])]]] },
  amazon: { name: 'Amazon', one: 'Fix a listing, a new A+ page, an ads change', on: 'A standing watch on listings, Buy Box or reviews', agent: 'Marketplace listing and marketplace ads',
    oneSteps: [['What', [C('kind', 'What needs doing?', ['Fix a listing', 'New A+ page', 'Ads change']), F('q', 'Which product, and what is wrong or wanted?', 'Bowl: main image is out of date in DE', 1)]]],
    onSteps: [['What to watch', [C('kind', 'Watch', ['Listings match the master', 'Buy Box', 'Reviews under 4 stars', 'A+ live'], 1), C('mkt', 'Stores', ['UK', 'US', 'CA', 'EU'], 1), F('q', 'Anything specific? (optional)', 'Tell me within a day if a listing image changes')]], RUNS] },
  content: { name: 'Content', one: 'One post, video or email', on: 'A regular series', agent: 'Content marketing and content creator',
    oneSteps: [['What', [C('kind', 'Format', ['Social post', 'Short video', 'Email', 'Blog']), F('q', 'What is it about?', 'Five first foods for baby-led weaning', 1)]]],
    onSteps: [['What', [C('kind', 'Format', ['Social posts', 'Short videos', 'Emails', 'Blogs']), F('q', 'What is the series about?', 'A weekly weaning tip', 1), C('per', 'How many', ['1 a week', '2 a week', '1 a month'])]], RUNS] },
  ip: { name: 'IP and trademark', one: 'A review, a filing or a copycat to deal with', on: 'A standing watch for copycats and deadlines', agent: 'IP review by Claude, then your patent attorney',
    oneSteps: [['What', [C('kind', 'What is it?', ['New trademark', 'Patent or design', 'Someone copying us', 'Renewal or deadline', 'Check before launch']), F('q', 'Describe it', 'A seller on Amazon DE is using our bowl photos', 1)]], ['Where', [C('terr', 'Territories', ['UK', 'EU', 'US', 'China', 'Other'], 1), C('urg', 'How urgent?', ['Deadline this month', 'Soon', 'No rush'])]]],
    onSteps: [['What to watch', [C('kind', 'Watch for', ['Copycat listings', 'Use of our photos', 'Similar trademarks filed', 'Renewal deadlines'], 1), C('terr', 'Territories', ['UK', 'EU', 'US', 'China'], 1)]], RUNS] },
  pm: { name: 'PM tool change', one: 'A fix or a new feature in doddl PM', agent: 'Design and development', oneOnly: true,
    oneSteps: [['What', [C('kind', 'Type', ['Something is broken', 'New feature', 'Change how it works']), F('q', 'Describe it', 'Approvals should filter by market', 1), C('area', 'Where in PM', ['Requests', 'Approvals', 'Projects', 'Amazon listings', 'Dashboards', 'Other'])]]] },
  other: { name: 'Something else', one: 'HQ works out who does it', on: 'HQ works out who runs it', agent: 'HQ orchestrator',
    oneSteps: [['What', [F('q', 'What do you need?', 'Describe it in a sentence or two', 1)]]],
    onSteps: [['What', [F('q', 'What should keep happening?', 'Describe it in a sentence or two', 1)]], RUNS] },
}
export const KINDS = Object.keys(TYPES)

export const LABELS = { q: 'Request', sku: 'Stock code', price: 'UK price', ch: 'Channels', terr: 'Territories', aud: 'Audience', len: 'Length', due: 'Needed by', kind: 'Type', mkt: 'Market', from: 'Linked from', goal: 'Goal', budget: 'Budget per day', when: 'Run for', date: 'Launch', stock: 'Stock', urg: 'Urgency', period: 'Period', for: 'Who sees it', lives: 'Lives in', alert: 'Alert', cad: 'Runs', owner: 'Owner', review: 'Review every', per: 'How many', area: 'Where in PM' }

// The stages, in order, and their names per mode.
export const STAGE_ORDER = ['asked', 'plan_approval', 'in_progress', 'output_approval', 'live', 'closed']
export const TRACK = {
  one: [['asked', 'Asked'], ['plan_approval', 'Plan approval'], ['in_progress', 'Being made'], ['output_approval', 'Output approval'], ['live', 'Live'], ['closed', 'Results']],
  on: [['asked', 'Asked'], ['plan_approval', 'Plan approval'], ['in_progress', 'Being built'], ['output_approval', 'Output approval'], ['running', 'Running'], ['closed', 'Retired']],
}

/** The form's steps for a type and mode (ending with Check and send). */
export function stepsFor(kind, mode) {
  const t = TYPES[kind]
  if (!t) return []
  const s = mode === 'on' && !t.oneOnly ? t.onSteps : t.oneSteps
  return [...s, ['Check and send', []]]
}

/** Which required answers are missing from one step (choices count as required, "(optional)" fields do not). */
export function missingIn(step, fields) {
  return (step ? step[1] : []).filter(f => (f.req || f.ch) && !/\(optional\)/.test(f.l) && !String((fields || {})[f.k] || '').trim())
}

/** Validates a new request. Pure. Returns { kind, mode, title, fields } or throws { status, message }. */
export function cleanRequest(raw) {
  const fail = (m) => Object.assign(new Error(m), { status: 400, expose: true })
  if (!raw || typeof raw !== 'object') throw fail('Send { kind, mode, fields }')
  const t = TYPES[raw.kind]
  if (!t) throw fail(`kind must be one of ${KINDS.join(', ')}`)
  const mode = raw.mode === 'on' && !t.oneOnly ? 'on' : 'one'
  const src = raw.fields && typeof raw.fields === 'object' ? raw.fields : {}
  const allowed = new Map(stepsFor(raw.kind, mode).flatMap(([, fs]) => fs.map(f => [f.k, f])))
  const fields = {}
  for (const [k, f] of allowed) {
    const v = src[k]
    if (v == null || v === '') continue
    const s = String(v).replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (f.ch) {
      const parts = s.split(', ').filter(Boolean)
      if (parts.some(p => !f.ch.includes(p)) || (!f.multi && parts.length > 1)) throw fail(`${f.l}: choose from the options given`)
    }
    fields[k] = s
  }
  for (const step of stepsFor(raw.kind, mode)) {
    const miss = missingIn(step, fields)
    if (miss.length) throw fail(`${miss.map(f => f.l.replace(/\?$/, '')).join(' and ')}: required`)
  }
  const first = fields.kind || fields.aud || fields.goal
  const base = fields.q || (first ? `${t.name}: ${first}` : t.name)
  const title = (base + (fields.sku ? ` (${fields.sku})` : '')).slice(0, 120)
  return { kind: raw.kind, mode, title, fields }
}

/** HQ's plan for a request, built from its answers (no model call). [[label, value], ...] */
export function planFor({ kind, mode, fields }) {
  const t = TYPES[kind]
  const v = fields || {}
  const on = mode === 'on'
  const rows = [['Agent', t.agent]]
  const P = {
    report: on ? [['Builds', `A tile or report: ${v.lives || 'Hub dashboard tile'}`], ['Data', "The Hub's own report SQL, dated, with its source"], ['Alerts', v.alert || 'None set']] : [['What you get', 'A one-page answer with the numbers behind it'], ['Data', `The Hub, ${(v.period || 'last month').toLowerCase()}`]],
    campaign: on ? [['What you get', 'An always-on ad set with 3 ads, or an email flow'], ['Spend', `£${v.budget || '?'} a day until stopped`]] : [['What you get', '3 ads, 1 ad set and the landing link'], ['Spend', `£${v.budget || '?'} a day for ${v.when || '3 weeks'}`]],
    presentation: [['What you get', on ? 'Each edition in the doddl deck style' : `${v.len || '10 slides'} in the doddl deck style, with speaker notes`], ['Numbers', 'From the Hub, dated, with sources'], ['Checks', 'Brand and claims review before you see it']],
    product: [['Set-up checklist', 'Product master and costs, Shopify page, Amazon listings, A+, images per market, Klaviyo catalogue, stock in the Hub'], ['Each piece', 'Its own approval card'], ['Blocked until', 'Barcodes, safety documents and photos are in']],
    ip: [['What you get', on ? 'A monthly watch report, and an alert the day something is found' : 'A written review: what is at stake, the options, the deadlines'], ['Filing or letters', 'Your patent attorney, never HQ'], ['Evidence', 'Screenshots and dates kept with the request']],
    amazon: [['What you get', on ? 'A daily check, with an alert on any change' : 'The fix, sent as an approval card']],
    page: [['What you get', '1 page on DEV first, then live'], ['Links', v.from || 'Menu']],
    content: [['What you get', on ? `${v.per || '1 a week'}, each piece approved before it goes out` : 'The piece, checked for brand and claims']],
    pm: [['What you get', 'The change on staging first, then live'], ['Where', v.area || 'Not given']],
    other: [['What you get', 'Scoped by the agent HQ picks']],
  }[kind] || []
  rows.push(...P)
  if (on) rows.push(['Runs', v.cad || 'Weekly'], ['Owner', v.owner || 'Not set'], ['Review every', v.review || 'Quarter'])
  rows.push(['Success looks like', on ? 'Used and acted on; reviewed on its date' : 'Agreed when you approve this plan'])
  return rows
}

/** Who owes the next move, as a short label and a tone. Pure. */
export function waitingOn(r) {
  switch (r.stage) {
    case 'suggested': return ['Suggested by HQ', 'info']
    case 'asked': return ['HQ scoping', 'info']
    case 'plan_approval': return ['Plan to approve', 'warn']
    case 'in_progress': return [r.mode === 'on' ? 'Being built' : 'Being made', 'info']
    case 'output_approval': return ['Output to approve', 'warn']
    case 'live': return ['Live', 'ok']
    case 'running': return [r.paused ? 'Paused' : 'Running', r.paused ? 'grey' : 'ok']
    case 'closed': return ['Closed', 'ok']
    case 'parked': return ['Parked', 'grey']
    case 'declined': return ['Declined', 'grey']
    default: return [r.stage, 'grey']
  }
}

/** Which operations a person may take on a request in its current stage. Pure. */
export function allowedOps(r) {
  const ops = { suggested: ['accept', 'decline'], plan_approval: ['approve', 'change', 'park'], output_approval: ['approve', 'change', 'park'], parked: ['reopen'], running: ['pause', 'retire', 'change_request'], asked: ['park'], in_progress: ['park'], live: ['close'] }[r.stage] || []
  return [...ops, 'reply']
}
