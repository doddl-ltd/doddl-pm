// Registry of type-specific approval review renderers (Approvals v2).
// Each renderer is a React component with props:
//   { task, artefact, isMobile, readOnly,
//     lines, setLines,        // { [lineId]: 'approved'|'rejected'|'edited'|'push'|'keep', '<id>:edit': {...} }
//     edits, setEdits,        // decision_edits object (approver's edits, keyed as the artefact is)
//     comments, onComment }   // onComment(body, anchor) -> Promise; anchor per CONTRACT.md
// The approval card frame (ApprovalCard) owns the header, clock, decision bar and the POST to
// /api/approvals/decide; renderers only show the preview and collect lines/edits.
// getRenderer returns null for types without a rich renderer (the card falls back to generic).
import PackReview from './PackReview'

const RENDERERS = {
  pack: PackReview,
}

export function getRenderer(artefactType) {
  return RENDERERS[artefactType] || null
}
