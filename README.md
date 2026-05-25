# Pipeline Data Flow

Live, agent-driven topology visualization. Each service installs a small **agent SDK** that registers itself with the backend; the diagram updates in real time. The agent declares which other services it talks to — the backend draws those edges and animates particle flow.

```
┌──────────────┐      WS(socket.io)      ┌──────────────┐
│  React UI    │ ◄────────────────────► │  Node API +  │
│  (Vite)      │                         │  socket.io   │
└──────────────┘                         │  + Postgres  │
                                          └──────▲───────┘
                                                 │ HTTP register/heartbeat
                                                 │ Bearer $AGENT_TOKEN
                                          ┌──────┴───────┐
                                          │ Agent SDK    │
                                          │ (py / node)  │
                                          │ in services  │
                                          └──────────────┘
```

## Quick start

Prereq: Docker Desktop. (Node + Python only needed if you want to develop or run an agent locally.)

```bash
cp .env.example .env          # then edit AGENT_TOKEN to a real secret
docker compose up -d --build  # postgres + server + web all up
```

- UI:      http://localhost:5173
- API:     http://localhost:4000  (`GET /healthz`, `GET /topology`)
- DB:      `postgres://pipeflow:pipeflow@localhost:5432/pipeflow`

Server runs migrations on startup — 13 clusters seeded automatically.

### Dev mode (hot reload)

```bash
docker compose up -d postgres
npm install
npm run migrate
npm run dev:server   # :4000, tsx watch
npm run dev:web      # :5173, vite dev
```

### Run an example agent

```bash
pip install -e packages/sdk-py
PIPEFLOW_TOKEN=dev-token-change-me \
  python packages/sdk-py/examples/multi_agent_demo.py
```

Within a second the UI fills in: Airflow node lands in the **Orchestration** cluster, Postgres in **Data Stores**, Kafka broker in the **Kafka** column, edges drawn from declared targets. Particles flow from `youtube-api` through the graph.

Kill the demo (Ctrl+C) → agents deregister → nodes go gray.

## Layout

| path                 | what                                                 |
|----------------------|------------------------------------------------------|
| `apps/web`           | Vite + React + TS frontend                           |
| `apps/server`        | Node + Express + socket.io + Postgres backend        |
| `packages/shared`    | TS event/payload types                               |
| `packages/sdk-py`    | Python agent SDK (`pipeflow-agent`)                  |
| `packages/sdk-node`  | Node agent SDK (`@pipeflow/agent`)                   |
| `db/migrations`      | SQL schema                                           |
| `mockup/`            | original design reference (kept as a sanity check)   |

## How it works

1. **Agent boots** → calls `POST /agents/register` with `{id, label, node_type, color, targets}`.
2. **Backend places node**: picks the smallest cluster whose `accepts_kinds` includes the agent's `node_type`, finds the first free grid slot inside, persists `x/y`.
3. **Backend draws declared edges**. If a target ID is unknown, a **stub** node is created (dashed border, gray) so the edge has somewhere to land; when that target agent later registers, the stub is upgraded in place.
4. **Heartbeat every 5s** → backend bumps `last_seen_at`. A liveness loop scans every 5s: `<15s = live, <45s = stale, ≥45s = dead`. Changes broadcast via `agent:status`.
5. **UI** subscribes via socket.io `/diagram`. Initial state from `GET /topology`, deltas from `node:added/updated/removed`, `edge:added/removed`, `agent:status`.
6. **User edits** (drag node, click edge to delete, draw edge by dragging from a socket) persist to DB. Deleted agent-declared edges are recorded in `edge_suppressions` so re-registration doesn't recreate them.

## Auth

All `POST /agents/*` endpoints require `Authorization: Bearer ${AGENT_TOKEN}`. UI endpoints (`GET /topology`, socket.io) are open — put them behind a reverse proxy if you care.

## Node types

| kind   | dropped into cluster |
|--------|----------------------|
| `user` | Users                |
| `ext`  | External             |
| `fe`   | one of the app/admin/duck/kafd/lensa/etc UI clusters |
| `be`   | matching backend cluster |
| `svc`  | Orchestration or Model Learning |
| `wk`   | KEDA Workers         |
| `kf`   | Kafka (Strimzi)      |
| `db`   | Data Stores          |
| `obs`  | Observability        |

## Roadmap (out of scope this round)

- Per-agent API keys (currently shared token)
- Live `flow_event` particle driving (currently simulated wave)
- Health metrics overlay (queue depth → bottleneck viz)
- Topology replay (event-sourced history scrubber)
- Kafka consumer-group auto-discovery
