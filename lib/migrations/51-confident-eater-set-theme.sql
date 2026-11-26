-- Migration: 51-confident-eater-set-theme
-- Description: P-CONFIDENT-EATER's three products are sets, not colours: its UK parent 2L-STB3-1NQY varies by SET_NAME,
--              so the target theme is SET_NAME (migration 50 said COLOR, which made doddlHQ propose a new parent for a
--              family that is already grouped). Nothing is sent to Amazon. Idempotent.

SELECT public.backup_before_migration('51-confident-eater-set-theme');

UPDATE public.listing_family_target SET theme = 'SET_NAME', updated_by = 'migration 51', updated_at = now()
WHERE family_code = 'P-CONFIDENT-EATER' AND theme IS DISTINCT FROM 'SET_NAME';
