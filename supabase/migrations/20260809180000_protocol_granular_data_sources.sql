-- Protocol: split the coarse body_vitals_source into per-metric data sources so
-- the user can choose Garmin vs Oura per biomarker (HRV / resting HR / readiness /
-- recovery / SpO2 / temperature) instead of one all-or-nothing toggle. Seeded from
-- the old body_vitals_source. That column is kept (vestigial) for safety.
ALTER TABLE protocol_data_source_settings
  ADD COLUMN IF NOT EXISTS hrv_source text NOT NULL DEFAULT 'oura',
  ADD COLUMN IF NOT EXISTS resting_hr_source text NOT NULL DEFAULT 'oura',
  ADD COLUMN IF NOT EXISTS readiness_source text NOT NULL DEFAULT 'oura',
  ADD COLUMN IF NOT EXISTS recovery_source text NOT NULL DEFAULT 'oura',
  ADD COLUMN IF NOT EXISTS spo2_source text NOT NULL DEFAULT 'oura',
  ADD COLUMN IF NOT EXISTS temperature_source text NOT NULL DEFAULT 'oura';
UPDATE protocol_data_source_settings SET
  hrv_source = body_vitals_source, resting_hr_source = body_vitals_source,
  readiness_source = body_vitals_source, recovery_source = body_vitals_source,
  spo2_source = body_vitals_source, temperature_source = body_vitals_source;
