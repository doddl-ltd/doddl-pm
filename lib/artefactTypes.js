// Artefact type registry for Task 3.
//
// Each entry defines:
//   label       — human-readable name shown in the UI
//   description — one-line summary shown in the approval panel
//   fields      — ordered array of field definitions the artefact must contain
//                 { key, type, required, label, render }
//                 `render` is used by components/ApprovalTaskPanel for per-field display
//
// Two example types shipped with MVP (pr_link, deploy_plan). Add new types by
// appending to this object. The POST /api/agent/artefacts endpoint rejects any
// artefact_type not present here.

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
}

export function listArtefactTypes() {
  return Object.keys(ARTEFACT_TYPES)
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
    if (field.type === 'string' && typeof v !== 'string') {
      return { valid: false, error: `Field '${field.key}' must be a string` }
    }
    if (field.type === 'array' && !Array.isArray(v)) {
      return { valid: false, error: `Field '${field.key}' must be an array` }
    }
    if (field.type === 'object' && (typeof v !== 'object' || Array.isArray(v))) {
      return { valid: false, error: `Field '${field.key}' must be an object` }
    }
  }
  return { valid: true }
}
