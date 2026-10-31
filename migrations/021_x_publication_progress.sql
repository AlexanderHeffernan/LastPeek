ALTER TABLE x_publications
  ADD COLUMN snapshot jsonb,
  ADD COLUMN progress jsonb,
  ADD COLUMN lease uuid,
  ADD COLUMN lease_until timestamptz;
