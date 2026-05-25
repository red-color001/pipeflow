ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS cpu_pct         real,
  ADD COLUMN IF NOT EXISTS mem_pct         real,
  ADD COLUMN IF NOT EXISTS mem_used_bytes  bigint,
  ADD COLUMN IF NOT EXISTS mem_total_bytes bigint,
  ADD COLUMN IF NOT EXISTS stats_at        timestamptz;
