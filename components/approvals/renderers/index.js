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
import AdReview from './AdReview'
import VideoReview from './VideoReview'
import SocialReview from './SocialReview'
import EmailReview from './EmailReview'
import ListingChangeReview from './ListingChangeReview'
import B2BDefinitionReview from './B2BDefinitionReview'
import B2BSampleReview from './B2BSampleReview'
import B2BSequenceReview from './B2BSequenceReview'
import B2BGoliveReview from './B2BGoliveReview'

const RENDERERS = {
  pack: PackReview,
  ad_creative: AdReview,
  video: VideoReview,
  social_pack: SocialReview,
  email: EmailReview,
  listing_change: ListingChangeReview,
  // B2B campaigns (docs/b2b-campaigns/CONTRACT.md). A renderer may set a static approveLabel(tally, lines)
  // for the card's main button.
  b2b_definition: B2BDefinitionReview,
  b2b_sample: B2BSampleReview,
  b2b_sequence: B2BSequenceReview,
  b2b_golive: B2BGoliveReview,
}

export function getRenderer(artefactType) {
  return RENDERERS[artefactType] || null
}
