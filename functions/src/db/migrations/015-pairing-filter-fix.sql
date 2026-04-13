-- Migration 015: Add guest_id/staff_id ontology properties for pairing concept
-- Fixes: guest detail Pairings tab filter (guest_id={{record.id}}) silently ignored
-- because guest_id is not an ontology property, so buildWhereClause skips it.
-- Also adds guest_id for prep_item and transport so their embedded tabs filter correctly.

BEGIN;

-- ============================================================
-- 1. Add guest_id and staff_id as ontology properties for pairing
--    with postgres_column set so the filter uses the typed column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ontology_properties
    WHERE concept_key = 'pairing' AND key = 'guest_id' AND status = 'active'
  ) THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, postgres_column, required, hidden, sort_order)
    VALUES ('pairing', 'guest_id', 'Guest ID', 'text', 'guest_id', false, true, 10);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ontology_properties
    WHERE concept_key = 'pairing' AND key = 'staff_id' AND status = 'active'
  ) THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, postgres_column, required, hidden, sort_order)
    VALUES ('pairing', 'staff_id', 'Staff ID', 'text', 'staff_id', false, true, 11);
  END IF;
END $$;

-- ============================================================
-- 2. Add guest_id ontology property for prep_item
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ontology_properties
    WHERE concept_key = 'prep_item' AND key = 'guest_id' AND status = 'active'
  ) THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, postgres_column, required, hidden, sort_order)
    VALUES ('prep_item', 'guest_id', 'Guest ID', 'text', 'guest_id', false, true, 10);
  END IF;
END $$;

-- ============================================================
-- 3. Add guest_id ontology property for transport
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ontology_properties
    WHERE concept_key = 'transport' AND key = 'guest_id' AND status = 'active'
  ) THEN
    INSERT INTO ontology_properties (concept_key, key, label, type, postgres_column, required, hidden, sort_order)
    VALUES ('transport', 'guest_id', 'Guest ID', 'text', 'guest_id', false, true, 10);
  END IF;
END $$;

-- ============================================================
-- 4. Add guest_id/staff_id to RBAC visible_properties for pairing
-- ============================================================
UPDATE permissions SET visible_properties = array_append(visible_properties, 'guest_id')
WHERE concept_key = 'pairing' AND NOT ('guest_id' = ANY(visible_properties));

UPDATE permissions SET visible_properties = array_append(visible_properties, 'staff_id')
WHERE concept_key = 'pairing' AND NOT ('staff_id' = ANY(visible_properties));

-- Add guest_id to visible_properties for prep_item and transport
UPDATE permissions SET visible_properties = array_append(visible_properties, 'guest_id')
WHERE concept_key = 'prep_item' AND NOT ('guest_id' = ANY(visible_properties));

UPDATE permissions SET visible_properties = array_append(visible_properties, 'guest_id')
WHERE concept_key = 'transport' AND NOT ('guest_id' = ANY(visible_properties));

COMMIT;
