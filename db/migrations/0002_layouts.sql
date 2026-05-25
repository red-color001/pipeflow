CREATE TABLE layout_presets (
  id         serial PRIMARY KEY,
  name       text UNIQUE NOT NULL,
  positions  jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX layout_presets_name_idx ON layout_presets(name);
