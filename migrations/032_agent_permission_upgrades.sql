ALTER TABLE agent_connections ADD COLUMN requested_scopes text[];

-- Bind codes to what was actually approved, even if the connection changes
-- before exchange. Backfill keeps outstanding pre-upgrade codes usable.
ALTER TABLE agent_codes ADD COLUMN scopes text[];
UPDATE agent_codes c SET scopes=a.scopes
FROM agent_connections a WHERE a.id=c.connection_id;
