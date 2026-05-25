CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
