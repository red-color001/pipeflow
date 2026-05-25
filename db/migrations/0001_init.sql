-- Clusters: visual grouping rectangles. Seeded from mockup CLUSTERS.
CREATE TABLE clusters (
  id            text PRIMARY KEY,
  label         text NOT NULL,
  x             int  NOT NULL,
  y             int  NOT NULL,
  w             int  NOT NULL,
  h             int  NOT NULL,
  color         text NOT NULL,
  orient        text,
  accepts_kinds text[] NOT NULL DEFAULT '{}'
);

-- Agents: every registered service. Becomes a node in the diagram.
-- Stub = placeholder created because another agent declared it as a target
-- but the agent itself has not registered yet.
CREATE TABLE agents (
  id             text PRIMARY KEY,
  service        text,
  node_type      text NOT NULL,
  color          text NOT NULL DEFAULT 'neutral',
  label          text NOT NULL,
  host           text,
  version        text,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  x              int  NOT NULL DEFAULT 0,
  y              int  NOT NULL DEFAULT 0,
  w              int  NOT NULL DEFAULT 170,
  h              int  NOT NULL DEFAULT 60,
  cluster_id     text REFERENCES clusters(id) ON DELETE SET NULL,
  stub           boolean NOT NULL DEFAULT false
);

CREATE INDEX agents_last_seen_idx ON agents(last_seen_at);
CREATE INDEX agents_cluster_idx   ON agents(cluster_id);

-- Edges: declared by source agent at register time, or added manually via UI.
CREATE TABLE edges (
  id          serial PRIMARY KEY,
  from_agent  text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent    text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  color       text NOT NULL DEFAULT 'neutral',
  dashed      boolean NOT NULL DEFAULT false,
  label       text,
  source      text NOT NULL DEFAULT 'agent',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_agent, to_agent, source)
);

CREATE INDEX edges_from_idx ON edges(from_agent);
CREATE INDEX edges_to_idx   ON edges(to_agent);

-- Manual edge suppressions: user-deleted agent-declared edges.
-- Persisted so they stay deleted across re-registration.
CREATE TABLE edge_suppressions (
  id          serial PRIMARY KEY,
  from_agent  text NOT NULL,
  to_agent    text NOT NULL,
  UNIQUE (from_agent, to_agent)
);
