-- NULL preserves the deployment's existing environment setting until the owner saves.
CREATE TABLE x_api_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  monthly_limit_cents integer CHECK (monthly_limit_cents BETWEEN 0 AND 9999999)
);
INSERT INTO x_api_settings (monthly_limit_cents) VALUES (NULL);
