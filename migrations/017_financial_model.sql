CREATE TABLE financial_model (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  assumptions jsonb NOT NULL
);
INSERT INTO financial_model (assumptions) VALUES ('{}');
