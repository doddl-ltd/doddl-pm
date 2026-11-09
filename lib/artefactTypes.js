// Artefact type registry (Task 3, extended for Approvals v2 — docs/approvals-v2/CONTRACT.md).
//
// Each entry defines:
//   label       — human-readable name shown in the UI
//   description — one-line summary shown in the approval panel
//   fields      — ordered array of field definitions the artefact may contain
//                 { key, type, required, label, render, ...nested }
//                 `render` is used by components/ApprovalTaskPanel for per-field display
//   lines       — (v2) how to list the line ids a decision can address per line
//
// Field types: string, number, boolean, scalar (string or number), date (YYYY-MM-DD), enum (values),
// object (fields), array (of: a type name or { type, fields, values }), any. Nested definitions use the
// same shape, so the validator walks arrays of objects. Unknown extra keys are allowed everywhere.
//
// The POST /api/agent/artefacts endpoint rejects any artefact_type not present here.

// ─── v2 shared pieces ───────────────────────────────────────────────────────

const CHECKS = {
  key: 'checks', type: 'array', label: 'Checks', render: 'checks',
  of: { type: 'object', fields: [
    { key: 'result', type: 'enum', values: ['pass', 'check', 'fix'], required: true },
    { key: 'text', type: 'string', required: true },
  ] },
}

// Every v2 type may carry these.
const COMMON = [
  CHECKS,
  { key: 'why', type: 'string', label: 'Why', render: 'text' },
  { key: 'evidence', type: 'array', label: 'Evidence', render: 'evidence', of: { type: 'object', fields: [
    { key: 'text', type: 'string', required: true },
    { key: 'source', type: 'string' },
  ] } },
  { key: 'expected_effect', type: 'string', label: 'Expected effect', render: 'text' },
  { key: 'undo', type: 'string', label: 'Undo', render: 'text' },
  { key: 'after_yes', type: 'array', of: 'string', label: 'After you say yes', render: 'list' },
]

const IMAGE = (extra = []) => ({ type: 'object', fields: [
  { key: 'label', type: 'string' },
  { key: 'url', type: 'string' },
  ...extra,
] })

const LISTING_IMAGE = { type: 'object', fields: [
  { key: 'slot', type: 'scalar' },
  { key: 'label', type: 'string' },
  { key: 'url', type: 'string' },
  { key: 'px', type: 'scalar' },
] }

// B2B campaigns: the business definition and a prospect (contact ROLE and type only, never names/e-mails/phones).
const B2B_DEFINITION_FIELDS = [
  { key: 'name', type: 'string' },
  { key: 'line', type: 'string' },
  { key: 'kinds', type: 'array', of: { type: 'object', fields: [{ key: 't', type: 'string', required: true }, { key: 'on', type: 'boolean' }] } },
  { key: 'size', type: 'string' },
  { key: 'who_decides', type: 'string' },
  { key: 'must', type: 'array', of: 'string' },
  { key: 'nice', type: 'array', of: 'string' },
  { key: 'rule_out', type: 'array', of: 'string' },
  { key: 'sources', type: 'string' },
  { key: 'wants', type: 'string' },
  { key: 'contact_rules', type: 'string' },
]

const B2B_PROSPECT = { type: 'object', fields: [
  { key: 'id', type: 'string', required: true },
  { key: 'name', type: 'string', required: true },
  { key: 'place', type: 'string' },
  { key: 'details', type: 'object' },
  { key: 'sources', type: 'array', of: { type: 'object', fields: [{ key: 'label', type: 'string', required: true }, { key: 'url', type: 'string' }] } },
  { key: 'match', type: 'array', of: { type: 'object', fields: [{ key: 't', type: 'string', required: true }, { key: 'ok', type: 'boolean' }] } },
  { key: 'contact', type: 'object', fields: [
    { key: 'role', type: 'string' },
    { key: 'type', type: 'enum', values: ['named', 'generic', 'none'] },
    { key: 'in_hubspot', type: 'boolean' },
  ] },
  { key: 'fit', type: 'number' },
] }

const CONTACT_DETAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}|(?:\+?\d[\s().-]?){9,}/i

// Agents never send a person's name, e-mail or phone: a contact is { role, type, in_hubspot } and nothing else.
function noContactDetails(entries) {
  for (const [path, p] of entries) {
    const c = p && p.contact
    if (c == null) continue
    if (typeof c !== 'object') return `${path}.contact must be an object`
    const extra = Object.keys(c).filter(k => !['role', 'type', 'in_hubspot'].includes(k))
    if (extra.length) return `${path}.contact may carry only role, type and in_hubspot (no names, e-mails or phones): ${extra.join(', ')}`
    if (c.role && (String(c.role).length > 60 || CONTACT_DETAIL.test(String(c.role)))) return `${path}.contact.role must be a role like "Manager", not contact details`
  }
  return null
}

export const LINE_VALUES = ['approved', 'rejected', 'edited', 'push', 'keep', 'edit']

export const ARTEFACT_TYPES = {
  pr_link: {
    label: 'Pull Request',
    description: 'A GitHub pull request awaiting code review.',
    fields: [
      { key: 'url',    type: 'string', required: true,  label: 'URL',    render: 'link' },
      { key: 'title',  type: 'string', required: true,  label: 'Title',  render: 'text' },
      { key: 'author', type: 'string', required: false, label: 'Author', render: 'text' },
      { key: 'branch', type: 'string', required: false, label: 'Branch', render: 'code' },
    ],
  },
  deploy_plan: {
    label: 'Deployment Plan',
    description: 'A proposed deployment with steps and rollback notes.',
    fields: [
      { key: 'summary',    type: 'string', required: true,  label: 'Summary',    render: 'text' },
      { key: 'steps',      type: 'array',  required: true,  label: 'Steps',      render: 'list' },
      { key: 'risk_level', type: 'string', required: false, label: 'Risk level', render: 'badge' },
      { key: 'rollback',   type: 'string', required: false, label: 'Rollback',   render: 'text' },
    ],
  },
  copy: {
    label: 'Copy',
    description: 'Listing, email, ad or web copy awaiting sign-off.',
    fields: [
      { key: 'title',       type: 'string', required: true,  label: 'Title',       render: 'text' },
      { key: 'channel',     type: 'string', required: false, label: 'Channel',     render: 'badge' },
      { key: 'bullets',     type: 'array',  required: false, label: 'Bullets',     render: 'list' },
      { key: 'description', type: 'string', required: true,  label: 'Copy',        render: 'text' },
    ],
  },
  document: {
    label: 'Document',
    description: 'A document, report or plan to review.',
    fields: [
      { key: 'title',   type: 'string', required: true,  label: 'Title',   render: 'text' },
      { key: 'url',     type: 'string', required: true,  label: 'Link',    render: 'link' },
      { key: 'summary', type: 'string', required: false, label: 'Summary', render: 'text' },
    ],
  },
  design: {
    label: 'Design',
    description: 'A visual design, mock-up or creative to review.',
    fields: [
      { key: 'title', type: 'string', required: true,  label: 'Title', render: 'text' },
      { key: 'url',   type: 'string', required: true,  label: 'Link',  render: 'link' },
      { key: 'notes', type: 'string', required: false, label: 'Notes', render: 'text' },
    ],
  },

  // ─── Approvals v2 ─────────────────────────────────────────────────────────

  ad_creative: {
    label: 'Ad creative',
    description: 'New ads with their placements and variants (board 9).',
    v2: true,
    lines: (a) => (a.variants || []).map(v => v && v.id),
    fields: [
      { key: 'platform', type: 'enum', values: ['meta', 'tiktok', 'amazon_sb'], label: 'Platform', render: 'badge' },
      { key: 'campaign', type: 'string', label: 'Campaign', render: 'text' },
      { key: 'ad_set', type: 'string', label: 'Ad set', render: 'text' },
      { key: 'audience', type: 'string', label: 'Audience', render: 'text' },
      { key: 'placements', type: 'any', label: 'Placements', render: 'list' },
      { key: 'budget_text', type: 'string', label: 'Budget', render: 'text' },
      { key: 'dates_text', type: 'string', label: 'Dates', render: 'text' },
      { key: 'landing_url', type: 'string', label: 'Landing page', render: 'link' },
      { key: 'utm', type: 'string', label: 'UTM', render: 'code' },
      { key: 'variants', type: 'array', required: true, min: 1, label: 'Variants', render: 'variants', of: { type: 'object', fields: [
        { key: 'id', type: 'string', required: true },
        { key: 'name', type: 'string' },
        { key: 'primary_text', type: 'string' },
        { key: 'headline', type: 'string' },
        { key: 'description', type: 'string' },
        { key: 'cta', type: 'string' },
        { key: 'overlay', type: 'string' },
        { key: 'image', ...IMAGE([{ key: 'path', type: 'string' }, { key: 'rights', type: 'string' }]) },
        { key: 'video_task_id', type: 'string' },
        CHECKS,
        { key: 'why', type: 'string' },
      ] } },
      { key: 'running_now', type: 'array', label: 'Running now', render: 'table', of: { type: 'object', fields: [
        { key: 'name', type: 'string', required: true },
        { key: 'spend', type: 'scalar' },
        { key: 'ctr', type: 'scalar' },
        { key: 'cpa', type: 'scalar' },
        { key: 'note', type: 'string' },
      ] } },
      ...COMMON,
    ],
  },

  video: {
    label: 'Video',
    description: 'A video cut with frames, beats, script and deliverables (board 10).',
    v2: true,
    lines: () => [],
    fields: [
      { key: 'title', type: 'string', required: true, label: 'Title', render: 'text' },
      { key: 'duration_s', type: 'number', label: 'Duration (s)', render: 'text' },
      { key: 'version', type: 'scalar', label: 'Version', render: 'badge' },
      { key: 'previous_versions', type: 'array', label: 'Previous versions', render: 'table', of: { type: 'object', fields: [
        { key: 'version', type: 'scalar', required: true },
        { key: 'outcome', type: 'string' },
        { key: 'note', type: 'string' },
      ] } },
      { key: 'runs_on', type: 'array', of: 'string', label: 'Runs on', render: 'list' },
      { key: 'used_by', type: 'array', of: 'string', label: 'Used by', render: 'list' },
      { key: 'files', type: 'object', label: 'Files', render: 'files', fields: [
        { key: '9:16', type: 'string' }, { key: '4:5', type: 'string' }, { key: '1:1', type: 'string' },
      ] },
      { key: 'frames', type: 'array', label: 'Frames', render: 'frames', of: { type: 'object', fields: [
        { key: 't', type: 'scalar', required: true },
        { key: 'beat', type: 'string' }, { key: 'shot', type: 'string' }, { key: 'text', type: 'string' },
        { key: 'voice', type: 'string' }, { key: 'thumb_url', type: 'string' },
      ] } },
      { key: 'beats', type: 'array', label: 'Beats', render: 'beats', of: { type: 'object', fields: [
        { key: 'label', type: 'string', required: true },
        { key: 'start_s', type: 'number' }, { key: 'end_s', type: 'number' },
      ] } },
      { key: 'script', type: 'array', label: 'Script vs cut', render: 'table', of: { type: 'object', fields: [
        { key: 't', type: 'scalar' }, { key: 'beat', type: 'string' }, { key: 'brief', type: 'string' },
        { key: 'on_screen', type: 'string' }, { key: 'words', type: 'string' }, { key: 'source', type: 'string' },
      ] } },
      { key: 'deliverables', type: 'array', label: 'Deliverables', render: 'table', of: { type: 'object', fields: [
        { key: 'label', type: 'string', required: true },
        { key: 'status', type: 'enum', values: ['ready', 'missing'], required: true },
        { key: 'note', type: 'string' },
      ] } },
      ...COMMON,
    ],
  },

  social_pack: {
    label: 'Social week pack',
    description: 'A week of organic posts, ticked post by post (board 11).',
    v2: true,
    lines: (a) => (a.posts || []).map(p => p && p.id),
    fields: [
      { key: 'week_start', type: 'date', label: 'Week of', render: 'text' },
      { key: 'posts', type: 'array', required: true, min: 1, label: 'Posts', render: 'posts', of: { type: 'object', fields: [
        { key: 'id', type: 'string', required: true },
        { key: 'channel', type: 'string', required: true },
        { key: 'day', type: 'date' },
        { key: 'time', type: 'string' },
        { key: 'title', type: 'string' },
        { key: 'pillar', type: 'string' },
        { key: 'format', type: 'string' },
        { key: 'age_stage', type: 'string' },
        { key: 'image', ...IMAGE([{ key: 'source', type: 'string' }]) },
        { key: 'caption', type: 'string' },
        { key: 'hashtags', type: 'any' },
        { key: 'alt_text', type: 'string' },
        { key: 'first_comment', type: 'string' },
        { key: 'product_tag', type: 'string' },
        CHECKS,
      ] } },
      { key: 'pillars_note', type: 'string', label: 'Balance across pillars', render: 'text' },
      ...COMMON,
    ],
  },

  email: {
    label: 'Email',
    description: 'A Klaviyo campaign or flow email (board 12).',
    v2: true,
    lines: () => [],
    fields: [
      { key: 'kind', type: 'enum', values: ['campaign', 'flow'], label: 'Kind', render: 'badge' },
      { key: 'klaviyo_id', type: 'string', label: 'Klaviyo id', render: 'code' },
      { key: 'send_at', type: 'string', label: 'Send at', render: 'text' },
      { key: 'from', type: 'string', label: 'From', render: 'text' },
      { key: 'preview_text', type: 'string', label: 'Preview text', render: 'text' },
      { key: 'html_url', type: 'string', label: 'HTML', render: 'link' },
      { key: 'html', type: 'string', label: 'HTML', render: 'html' },
      { key: 'smart_sending', type: 'boolean', label: 'Smart sending', render: 'text' },
      { key: 'subjects', type: 'array', label: 'Subject lines', render: 'table', of: { type: 'object', fields: [
        { key: 'id', type: 'string' }, { key: 'text', type: 'string', required: true }, { key: 'split', type: 'scalar' },
      ] } },
      { key: 'audience', type: 'object', label: 'Audience', render: 'audience', fields: [
        { key: 'segment', type: 'string' }, { key: 'size', type: 'scalar' }, { key: 'excluded', type: 'any' },
      ] },
      { key: 'links', type: 'array', label: 'Every link', render: 'table', of: { type: 'object', fields: [
        { key: 'where', type: 'string' }, { key: 'url', type: 'string', required: true }, { key: 'utm', type: 'string' }, { key: 'ok', type: 'boolean' },
      ] } },
      { key: 'sequence', type: 'array', label: 'Where it sits', render: 'sequence', of: { type: 'object', fields: [
        { key: 'label', type: 'string', required: true }, { key: 'when', type: 'string' }, { key: 'current', type: 'boolean' },
      ] } },
      ...COMMON,
    ],
  },

  listing_change: {
    label: 'Amazon listing change',
    description: 'One listing, field by field: push, keep or edit (board 13).',
    v2: true,
    lines: (a) => (a.fields || []).map(f => f && f.field),
    fields: [
      { key: 'asin', type: 'string', required: true, label: 'ASIN', render: 'code' },
      { key: 'sku', type: 'string', label: 'SKU', render: 'code' },
      { key: 'marketplace', type: 'string', required: true, label: 'Marketplace', render: 'badge' },
      { key: 'product', type: 'string', label: 'Product', render: 'text' },
      { key: 'fields', type: 'array', required: true, min: 1, label: 'Fields', render: 'listing_fields', of: { type: 'object', fields: [
        { key: 'field', type: 'string', required: true },
        { key: 'limit_text', type: 'string' },
        { key: 'live', type: 'any' }, { key: 'live_meta', type: 'string' },
        { key: 'should', type: 'any' }, { key: 'should_meta', type: 'string' },
        { key: 'status', type: 'enum', values: ['match', 'drift', 'proposed', 'in_flight', 'problem', 'na'] },
      ] } },
      { key: 'images', type: 'object', label: 'Images', render: 'images', fields: [
        { key: 'live', type: 'array', of: LISTING_IMAGE }, { key: 'should', type: 'array', of: LISTING_IMAGE },
      ] },
      { key: 'keywords', type: 'array', label: 'Keywords', render: 'table', of: { type: 'object', fields: [
        { key: 'term', type: 'string', required: true }, { key: 'live', type: 'any' }, { key: 'should', type: 'any' },
      ] } },
      { key: 'history', type: 'array', label: 'History', render: 'table', of: { type: 'object', fields: [
        { key: 'at', type: 'string' }, { key: 'text', type: 'string', required: true },
      ] } },
      ...COMMON,
    ],
  },

  pack: {
    label: 'Pack',
    description: 'Groups of lines approved line by line, with running totals (board 3).',
    v2: true,
    lines: (a) => (a.groups || []).flatMap(g => (g && Array.isArray(g.lines) ? g.lines : []).map(l => l && l.id)),
    fields: [
      { key: 'pack_kind', type: 'enum', values: ['amazon_ads', 'paid_media', 'replies', 'outreach', 'listings'], required: true, label: 'Pack', render: 'badge' },
      { key: 'currency_totals', type: 'boolean', label: 'Show totals', render: 'text' },
      { key: 'groups', type: 'array', required: true, min: 1, label: 'Lines', render: 'pack', of: { type: 'object', fields: [
        { key: 'name', type: 'string', required: true },
        { key: 'lines', type: 'array', required: true, min: 1, of: { type: 'object', fields: [
          { key: 'id', type: 'string', required: true },
          { key: 'target', type: 'string' },
          { key: 'before', type: 'any' },
          { key: 'after', type: 'any' },
          { key: 'limit', type: 'any' },
          { key: 'limit_tone', type: 'string' },
          { key: 'why', type: 'string' },
          { key: 'weekly_delta', type: 'object', fields: [
            { key: 'currency', type: 'string', required: true }, { key: 'amount', type: 'number', required: true },
          ] },
          { key: 'detail', type: 'any' },
        ] } },
      ] } },
      ...COMMON,
    ],
  },

  // ─── B2B campaigns (docs/b2b-campaigns/CONTRACT.md) ───────────────────────

  b2b_definition: {
    label: 'B2B definition',
    description: 'Who a B2B campaign talks to, for what goal, with which offer (board B2BDefine).',
    v2: true,
    lines: () => [],
    fields: [
      { key: 'campaign_id', type: 'string', required: true, label: 'Campaign', render: 'code' },
      { key: 'name', type: 'string', required: true, label: 'Campaign', render: 'text' },
      { key: 'definition', type: 'object', required: true, label: 'Who we want to talk to', render: 'b2b_definition', fields: B2B_DEFINITION_FIELDS },
      { key: 'goal', type: 'object', required: true, label: 'Goal', render: 'text', fields: [
        { key: 'id', type: 'enum', values: ['trial', 'stock', 'calls', 'deal', 'refer', 'bulk'], required: true },
        { key: 'target', type: 'string' }, { key: 'by', type: 'string' },
      ] },
      { key: 'offers', type: 'array', required: true, min: 1, label: 'Offers', render: 'list', of: { type: 'enum', values: ['sample', 'trade', 'starter', 'code', 'call'] } },
      { key: 'market', type: 'object', required: true, label: 'Market', render: 'text', fields: [
        { key: 'country', type: 'enum', values: ['GB', 'FR', 'DE', 'IE', 'US'], required: true },
        { key: 'regions', type: 'array', of: 'string' }, { key: 'language', type: 'string' },
      ] },
      { key: 'volume', type: 'number', required: true, label: 'How many', render: 'text' },
      { key: 'sample_size', type: 'number', required: true, label: 'Sample', render: 'text' },
      { key: 'pace', type: 'string', label: 'Pace', render: 'text' },
      { key: 'channels', type: 'array', required: true, min: 1, label: 'Channels', render: 'list', of: { type: 'enum', values: ['email', 'linkedin', 'phone', 'post'] } },
      { key: 'people', type: 'object', label: 'People', render: 'text', fields: [{ key: 'replies', type: 'string' }, { key: 'calls', type: 'string' }] },
      { key: 'estimate', type: 'object', label: 'HQ’s estimate', render: 'text', fields: [
        { key: 'found', type: 'scalar' }, { key: 'match', type: 'scalar' }, { key: 'contact', type: 'scalar' }, { key: 'after_rules', type: 'scalar' },
      ] },
      { key: 'country_rules', type: 'array', of: 'string', label: 'Contact rules', render: 'list' },
      ...COMMON,
    ],
  },

  b2b_sample: {
    label: 'B2B sample',
    description: 'A sample of prospects to tick or reject, with a reason for each rejection (board B2BSample).',
    v2: true,
    lines: (a) => (a.prospects || []).map(p => p && p.id),
    validate: (a) => noContactDetails((a.prospects || []).map((p, i) => [`prospects[${i}]`, p])),
    fields: [
      { key: 'campaign_id', type: 'string', required: true, label: 'Campaign', render: 'code' },
      { key: 'prospects', type: 'array', required: true, min: 1, label: 'Prospects', render: 'b2b_prospects', of: B2B_PROSPECT },
      { key: 'excluded_count', type: 'number', label: 'Left out by the rules', render: 'text' },
      { key: 'excluded_note', type: 'string', label: 'Left out', render: 'text' },
      ...COMMON,
    ],
  },

  b2b_sequence: {
    label: 'B2B emails and flow',
    description: 'The emails, the flow and who steps in when someone replies (board B2BFlow).',
    v2: true,
    lines: (a) => (a.emails || []).map(e => e && e.id),
    fields: [
      { key: 'campaign_id', type: 'string', required: true, label: 'Campaign', render: 'code' },
      { key: 'emails', type: 'array', required: true, min: 1, label: 'Emails', render: 'b2b_emails', of: { type: 'object', fields: [
        { key: 'id', type: 'string', required: true },
        { key: 'when', type: 'string' },
        { key: 'subject', type: 'string', required: true },
        { key: 'body', type: 'string', required: true },
        { key: 'step', type: 'string' },
      ] } },
      { key: 'flow', type: 'array', label: 'Flow', render: 'b2b_flow', of: { type: 'object', fields: [
        { key: 'id', type: 'string', required: true },
        { key: 'when', type: 'string' }, { key: 'title', type: 'string', required: true }, { key: 'sub', type: 'string' },
        { key: 'then', type: 'string' }, { key: 'person', type: 'boolean' }, { key: 'body', type: 'string' },
      ] } },
      { key: 'branches', type: 'array', label: 'When someone replies', render: 'table', of: { type: 'object', fields: [
        { key: 'say', type: 'string', required: true }, { key: 'what', type: 'string' }, { key: 'who', type: 'string' }, { key: 'fast', type: 'string' },
      ] } },
      { key: 'sending', type: 'object', label: 'How it sends', render: 'text', fields: [
        { key: 'via', type: 'string' }, { key: 'pace', type: 'string' }, { key: 'days', type: 'string' }, { key: 'stops_when', type: 'string' },
      ] },
      ...COMMON,
    ],
  },

  b2b_golive: {
    label: 'B2B go-live',
    description: 'The full list, the first day’s batch and the send times (go-live).',
    v2: true,
    lines: () => [],
    validate: (a) => noContactDetails((a.first_batch || []).map((p, i) => [`first_batch[${i}]`, { contact: { role: p && p.contact_role } }])),
    fields: [
      { key: 'campaign_id', type: 'string', required: true, label: 'Campaign', render: 'code' },
      { key: 'total', type: 'number', required: true, label: 'On the list', render: 'text' },
      { key: 'contacts_missing', type: 'number', label: 'Contacts still to add', render: 'text' },
      { key: 'first_batch', type: 'array', required: true, label: 'First day', render: 'table', of: { type: 'object', fields: [
        { key: 'id', type: 'string', required: true }, { key: 'name', type: 'string', required: true },
        { key: 'place', type: 'string' }, { key: 'contact_role', type: 'string' },
      ] } },
      { key: 'send_times', type: 'string', label: 'Send times', render: 'text' },
      ...COMMON,
    ],
  },
}

export function listArtefactTypes() {
  return Object.keys(ARTEFACT_TYPES)
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Checks one value against a definition. Returns an error string or null.
function checkValue(def, v, path) {
  switch (def.type) {
    case 'string':  return typeof v === 'string' ? null : `${path} must be a string`
    case 'number':  return typeof v === 'number' && Number.isFinite(v) ? null : `${path} must be a number`
    case 'boolean': return typeof v === 'boolean' ? null : `${path} must be true or false`
    case 'scalar':  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? null : `${path} must be a string or a number`
    case 'date':    return typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? null : `${path} must be a date (YYYY-MM-DD)`
    case 'enum':    return def.values.includes(v) ? null : `${path} must be one of ${def.values.join(', ')}`
    case 'object': {
      if (!isObj(v)) return `${path} must be an object`
      return def.fields ? checkFields(def.fields, v, path) : null
    }
    case 'array': {
      if (!Array.isArray(v)) return `${path} must be an array`
      if (def.min && v.length < def.min) return `${path} needs at least ${def.min} item${def.min === 1 ? '' : 's'}`
      if (!def.of) return null
      const itemDef = typeof def.of === 'string' ? { type: def.of } : def.of
      for (let i = 0; i < v.length; i++) {
        const err = checkValue(itemDef, v[i], `${path}[${i}]`)
        if (err) return err
      }
      return null
    }
    default: return null
  }
}

function checkFields(fields, obj, prefix) {
  for (const field of fields) {
    const v = obj[field.key]
    const path = prefix ? `${prefix}.${field.key}` : field.key
    if (v == null || v === '') {
      if (field.required) return prefix ? `${path} is required` : null
      continue
    }
    const err = checkValue(field, v, prefix ? path : `Field '${field.key}'`)
    if (err) return err
  }
  return null
}

/** The ids a per-line decision can address for this artefact (variant / post / field / pack line ids). */
export function lineIds(artefactType, artefact) {
  const def = ARTEFACT_TYPES[artefactType]
  if (!def || !def.lines || !isObj(artefact)) return []
  return def.lines(artefact).filter(id => typeof id === 'string' && id)
}

// Validates an artefact payload against its type definition.
// Returns { valid: true } or { valid: false, error: 'human-readable reason' }.
export function validateArtefact(artefactType, artefact) {
  const def = ARTEFACT_TYPES[artefactType]
  if (!def) {
    return { valid: false, error: `Unknown artefact_type '${artefactType}'. Valid types: ${listArtefactTypes().join(', ')}` }
  }
  if (artefact == null || typeof artefact !== 'object' || Array.isArray(artefact)) {
    return { valid: false, error: 'artefact must be a JSON object' }
  }
  for (const field of def.fields) {
    const v = artefact[field.key]
    if (field.required && (v == null || v === '')) {
      return { valid: false, error: `Missing required field '${field.key}' for type '${artefactType}'` }
    }
    if (v == null) continue
    const err = def.v2 ? checkValue(field, v, field.key) : legacyCheck(field, v)
    if (err) return { valid: false, error: err }
  }
  if (def.lines) {
    const ids = def.lines(artefact)
    const seen = new Set()
    for (const id of ids) {
      if (seen.has(id)) return { valid: false, error: `Line id '${id}' is used twice; line ids must be unique within the artefact` }
      seen.add(id)
    }
  }
  if (def.validate) {
    const err = def.validate(artefact)
    if (err) return { valid: false, error: err }
  }
  return { valid: true }
}

// The original (pre-v2) checks, kept word for word so old callers see the same messages.
function legacyCheck(field, v) {
  if (field.type === 'string' && typeof v !== 'string') return `Field '${field.key}' must be a string`
  if (field.type === 'array' && !Array.isArray(v)) return `Field '${field.key}' must be an array`
  if (field.type === 'object' && (typeof v !== 'object' || Array.isArray(v))) return `Field '${field.key}' must be an object`
  return null
}
