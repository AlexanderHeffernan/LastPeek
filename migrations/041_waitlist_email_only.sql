-- The public landing page joins the same request queue with an email alone.
ALTER TABLE account_requests ALTER COLUMN name DROP NOT NULL;
