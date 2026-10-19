-- Migration: 20-auto-triage-usage
-- Description: Jon, 2026-10-15: test runs of auto-triage cost $14.03 in one sitting, "that is
--   unacceptable". Every Claude call auto-triage makes now records its model, tokens and cost on the
--   inbox item, so spend is visible and the daily budget cap (AUTO_TRIAGE_DAILY_BUDGET_USD) can be
--   enforced in code.
--
--   inbox_items.auto_usage jsonb: { model, input_tokens, output_tokens, cost_usd, at }
--
-- Additive (one nullable column) and safe under the live UI. Idempotent.

ALTER TABLE public.inbox_items ADD COLUMN IF NOT EXISTS auto_usage jsonb;

CREATE INDEX IF NOT EXISTS inbox_items_auto_at_idx ON public.inbox_items (auto_at) WHERE auto_usage IS NOT NULL;
