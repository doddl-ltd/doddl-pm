-- Migration: 30-listing-edit-approval
-- Description: Sending listing edits for approval (Jon 2026-11-11: "Yes, build it" — saved edits go for approval and on
-- to Amazon). An edit moves: proposed (saved in PM) → submitted (Jon pressed "Send for approval") → in_approval (HQ
-- checked it, Amazon's validation preview passed, the approval card exists) → sent (approved and patched on Amazon),
-- or refused (HQ's checks or Amazon said no; hq_note says why). withdrawn as before.
--
-- Deploy-safe and idempotent: the status CHECK is replaced with a wider one, columns are ADD IF NOT EXISTS. Nothing is
-- dropped or deleted.

SELECT backup_before_migration('30-listing-edit-approval');

ALTER TABLE public.listing_edits DROP CONSTRAINT IF EXISTS listing_edits_status_check;
ALTER TABLE public.listing_edits ADD CONSTRAINT listing_edits_status_check
  CHECK (status IN ('proposed', 'submitted', 'in_approval', 'sent', 'refused', 'withdrawn'));

ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS submitted_by     text;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS submitted_at     timestamptz;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS approval_task_id uuid;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS proposal_id      text;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS hq_note          text;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS hq_at            timestamptz;

CREATE INDEX IF NOT EXISTS listing_edits_hq ON public.listing_edits (status) WHERE status IN ('submitted', 'in_approval');

NOTIFY pgrst, 'reload schema';
