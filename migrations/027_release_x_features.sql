-- X publishing and mentions are Pro capabilities, not account experiments.
-- Retain feature_audit as the historical record of the private trials.
DELETE FROM feature_grants WHERE feature IN ('x-publishing','x-mentions');
