-- Migration: 46-family-master
-- Description: Stage 1 + 2 of the Amazon listings process agreed with Jon (23 Nov 2026), first for P-2IN1-BOWL:
--   listing_family_master  the complete English master of a family: copy, colour names, attributes, images
--                          (master set + each colour's set), status draft | approved, approvals by Jon and Laura.
--   listing_family_target  the structure every store must end up with: one parent SKU (the same in every store),
--                          theme, the colour ASINs in the family, and products moved out to another family.
-- Seeds P-2IN1-BOWL (Jon: parent SKU P-2IN1-BOWL; colours Fresh Green B0C5Z9J9D4 and Dusky Rose B0FM3X7G7T; twin packs
-- B0DBQS5CRC and B0FPMKQ5K4 move to their own family P-2IN1-BOWL-TWIN). Copy and attributes come from the existing
-- master of the lead colour (DOD011), with the live UK listing filling any empty field. Nothing is sent to Amazon.
-- Service role only (RLS on, no policy), like the other listing tables. Idempotent.

SELECT public.backup_before_migration('46-family-master');

CREATE TABLE IF NOT EXISTS public.listing_family_master (
  family_code  text        PRIMARY KEY,
  copy         jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { title, bullet_1..bullet_5, description, search_terms }
  colours      jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{ asin, name, notes }]
  attributes   jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, value }] shared by every colour
  images       jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { master: { slot: url }, colours: { asin: { slot: url } } }
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approvals    jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { Jon: iso, Laura: iso }
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listing_family_target (
  family_code  text        PRIMARY KEY,
  parent_sku   text        NOT NULL,
  theme        text        NOT NULL DEFAULT 'COLOR',
  children     text[]      NOT NULL DEFAULT '{}',
  moved_out    jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{ asin, to_family }]
  note         text,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_family_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_family_target ENABLE ROW LEVEL SECURITY;

INSERT INTO public.listing_family_target (family_code, parent_sku, theme, children, moved_out, note, updated_by)
VALUES
  ('P-2IN1-BOWL', 'P-2IN1-BOWL', 'COLOR', ARRAY['B0C5Z9J9D4', 'B0FM3X7G7T'],
   '[{"asin": "B0DBQS5CRC", "to_family": "P-2IN1-BOWL-TWIN"}, {"asin": "B0FPMKQ5K4", "to_family": "P-2IN1-BOWL-TWIN"}]'::jsonb,
   'Agreed with Jon 23 Nov 2026', 'migration 46'),
  ('P-2IN1-BOWL-TWIN', 'P-2IN1-BOWL-TWIN', 'COLOR', ARRAY['B0DBQS5CRC', 'B0FPMKQ5K4'], '[]'::jsonb,
   'Twin packs moved out of P-2IN1-BOWL (Jon 23 Nov 2026)', 'migration 46')
ON CONFLICT (family_code) DO NOTHING;

-- The bowl's master: copy from DOD011's master, the live UK field where the master is empty.
WITH lead AS (
  SELECT m.copy, m.attributes FROM public.listing_masters m WHERE m.asin = 'B0C5Z9J9D4'
), live AS (
  SELECT field, live #>> '{}' AS v FROM public.listing_fields WHERE asin = 'B0C5Z9J9D4' AND marketplace = 'UK'
)
INSERT INTO public.listing_family_master (family_code, copy, colours, attributes, updated_by)
SELECT 'P-2IN1-BOWL',
  jsonb_build_object(
    'title',        COALESCE(NULLIF(l.copy->>'title', ''),        (SELECT v FROM live WHERE field = 'Title'), ''),
    'bullet_1',     COALESCE(NULLIF(l.copy->>'bullet_1', ''),     (SELECT v FROM live WHERE field = 'Bullet 1'), ''),
    'bullet_2',     COALESCE(NULLIF(l.copy->>'bullet_2', ''),     (SELECT v FROM live WHERE field = 'Bullet 2'), ''),
    'bullet_3',     COALESCE(NULLIF(l.copy->>'bullet_3', ''),     (SELECT v FROM live WHERE field = 'Bullet 3'), ''),
    'bullet_4',     COALESCE(NULLIF(l.copy->>'bullet_4', ''),     (SELECT v FROM live WHERE field = 'Bullet 4'), ''),
    'bullet_5',     COALESCE(NULLIF(l.copy->>'bullet_5', ''),     (SELECT v FROM live WHERE field = 'Bullet 5'), ''),
    'description',  COALESCE(NULLIF(l.copy->>'description', ''),  (SELECT v FROM live WHERE field = 'Description'), ''),
    'search_terms', COALESCE(NULLIF(l.copy->>'search_terms', ''), (SELECT v FROM live WHERE field = 'Search terms'), '')
  ),
  '[{"asin": "B0C5Z9J9D4", "name": "Fresh Green"}, {"asin": "B0FM3X7G7T", "name": "Dusky Rose"}]'::jsonb,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name', a->>'name', 'value', a->'value'))
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.copy) IS NOT NULL AND jsonb_typeof(l.attributes) = 'array' THEN l.attributes ELSE '[]'::jsonb END) a
            WHERE COALESCE((a->>'keep')::boolean, true)), '[]'::jsonb),
  'migration 46'
FROM (SELECT * FROM lead UNION ALL SELECT '{}'::jsonb, '[]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM lead)) l
LIMIT 1
ON CONFLICT (family_code) DO NOTHING;

COMMENT ON TABLE public.listing_family_master IS 'The complete English master of an Amazon family (migration 46): copy, colour names, attributes, images, approvals. Translations follow only once the structure is complete in every store.';
COMMENT ON TABLE public.listing_family_target IS 'The structure each Amazon store must end up with for a family (migration 46): one parent SKU everywhere, theme, colours, products moved out.';
