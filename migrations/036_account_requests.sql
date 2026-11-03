-- Requests do not create accounts or invitations.
CREATE TABLE account_requests (
  email text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
