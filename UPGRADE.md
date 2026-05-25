# Upgrade Guide

Each entry lists what changed, breaking-change risk, migration steps for an
existing deployment, and rollback. **Always back up Postgres before
upgrading**: `docker compose exec postgres pg_dump -U pipeflow pipeflow > backup.sql`.

The agent ↔ server wire protocol has stayed backward-compatible across all
versions: old binaries keep working against new servers; they just miss
features that need the new fields.

---

## `v0.1.3` → unreleased (`main` @ `083d976` or later)

**Server + UI features. No agent binary change. No DB migration.**

### What changed

- **Auto-layout panel** (top-right in canvas): `dagre` layout, LR or TB,
  no node overlap. Persists positions via existing `node:move`.
- **Prune / Reset actions** in user dropdown:
  - `Prune dead nodes`: hapus semua node `stub=true` atau `last_seen_at < now() - 45s`. Live agents tetap.
  - `Reset topology…`: wipe semua node + edge. Cluster tetap. Agents live re-register otomatis pada heartbeat berikutnya.
- New REST endpoints (auth: user JWT):
  - `POST /topology/prune-dead`
  - `POST /topology/reset` (kini broadcast `node:removed` + `edge:removed` per id)
- Header overflow fix: `.meta` wrap + `userMenu` anchored right.

### Migration steps

```bash
git pull
docker compose build server web
docker compose up -d --force-recreate server web
```

No `.env` change. No migration. No agent action needed.

### Rollback

```bash
git checkout v0.1.3
docker compose build server web && docker compose up -d --force-recreate server web
```

---

## `v0.1.2` → `v0.1.3`

**Major: auth layer + agent stats + edge animation. DB migrations required.**

### Breaking changes

- **`/topology/*` and `/layouts/*` now require a user JWT.** Any external script that called these REST endpoints anonymously will get `401`. Agent endpoints (`/agents/*`) are unaffected — they still use `AGENT_TOKEN`.
- **Socket.IO `/diagram` namespace requires `auth.token` in handshake.** Connections without a valid JWT are refused with `Error: unauthorized`. Built-in web client handles this automatically.

### What changed (cumulative)

- **Auth (`db/migrations/0003_users.sql`)**:
  - `users` table with scrypt-hashed passwords + JWT (HS256, 12h TTL, `JWT_SECRET` env)
  - First start auto-creates `admin / admin` with `must_change=true` → UI forces password change on first login
  - `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- **Agent stats (`db/migrations/0004_agent_stats.sql`)**:
  - New columns on `agents`: `cpu_pct`, `mem_pct`, `mem_used_bytes`, `mem_total_bytes`, `stats_at`
  - `POST /agents/:id/heartbeat` accepts optional body `{cpu_pct, mem_pct, mem_used_bytes, mem_total_bytes}` (backward-compatible — empty body still works)
  - New socket event `node:stats`
  - UI: CPU + MEM bars on each live node card (`PipeflowNode`)
- **Agent SDK (`packages/sdk-py`)**:
  - Adds `psutil>=5.9` dep
  - `Agent.report_stats: bool = True` — collects host stats via `psutil` and ships them in each heartbeat
  - Silent fallback when `psutil` import fails
- **Edge animation**:
  - Default edges show animated dashed flow (CSS `stroke-dashoffset`) — visible idle "alive" state
  - Particles (dots) now only spawn when `bytes >= 2000` → dots read as significant events, not ambient
  - Particle speed scales with `latency_ms` (ref 100ms = 1x, clamped 0.25x–4x)
- **Postgres no longer binds to host port `5432`** in `docker-compose.yml`. Connect from inside the docker network (`postgres:5432`) or temporarily restore the port mapping for ad-hoc debugging.
- **PyInstaller spec** picks up `psutil` for shipped binaries.

### Migration steps

1. **Set `JWT_SECRET`** in `.env` (any long random string). Default fallback `pipeflow-dev-secret-change-me` is fine for local but **must** change in production.
2. Pull + rebuild:
   ```bash
   git pull
   docker compose build server web
   docker compose up -d --force-recreate server web
   ```
   Migrations `0003_users.sql` + `0004_agent_stats.sql` run automatically (`migrate.js` invoked before `index.js` in the server Dockerfile).
3. First UI load → redirected to login. Default `admin / admin`. UI forces password change immediately.
4. **Re-install or upgrade agents** to pick up CPU/MEM reporting:
   - Docker agent: `docker compose build agent-* && docker compose up -d --force-recreate agent-*`
   - Binary agent: re-run the installer from
     <https://github.com/red-color001/pipeflow/releases/tag/v0.1.3>
     — old binaries (v0.1.2 and below) still connect and stream flow events; they just won't show CPU/MEM bars.
5. **If you have external scripts hitting `/topology` or `/layouts`**: switch them to log in via `POST /auth/login` first and send `Authorization: Bearer <token>`.

### Rollback

DB rollback requires manually dropping the new columns + table (Postgres has
no down-migrations here). Code rollback:

```bash
git checkout v0.1.2
docker compose build server web
docker compose up -d --force-recreate server web
# the extra columns/table are harmless if left in place
```

If you actually want the old schema back:

```sql
DROP TABLE IF EXISTS users;
ALTER TABLE agents
  DROP COLUMN IF EXISTS cpu_pct,
  DROP COLUMN IF EXISTS mem_pct,
  DROP COLUMN IF EXISTS mem_used_bytes,
  DROP COLUMN IF EXISTS mem_total_bytes,
  DROP COLUMN IF EXISTS stats_at;
DELETE FROM schema_migrations WHERE id IN ('0003_users.sql','0004_agent_stats.sql');
```

---

## `v0.1.1` → `v0.1.2`

**CI-only release.** Drops the `macos-x64` matrix entry from the agent binary
release workflow (Apple Silicon builds only).

### Migration steps

Server / web / SDK: no change. If you previously installed an agent on Intel
macOS via the v0.1.1 release, install via `pip install pipeflow-agent` or
re-build the binary locally from the PyInstaller spec.

---

## `v0.1.0` → `v0.1.1`

**Agent binary fix.** `pyinstaller.spec` no longer excludes `distutils`,
which was producing `Target module 'distutils' already imported as
ExcludedModule` on Python 3.12+ build runners.

### Migration steps

- Server / web / SDK source: no change.
- If you installed an agent binary from v0.1.0 and saw it crash on startup,
  re-install from v0.1.1+ release artifacts.

---

## Generic upgrade checklist

1. `pg_dump` Postgres (always).
2. `git pull` + `git tag --sort=-version:refname | head -3` to see what's new.
3. Read the section in this file for the version range you're crossing.
4. Set any new env vars listed.
5. `docker compose build server web` (and `agent-*` if agent code changed).
6. `docker compose up -d --force-recreate server web`.
7. Tail logs: `docker compose logs -f server | head -50` — confirm
   migrations applied and no startup errors.
8. If agent SDK changed, re-install / re-build agents at the new release tag.

## Compatibility matrix

| Server | Agent SDK | Web | DB schema |
|--------|-----------|-----|-----------|
| `v0.1.0`–`v0.1.2` | `v0.1.0`+ | `v0.1.0`+ | `0001`, `0002` |
| `v0.1.3` | `v0.1.0`+ (CPU/MEM bars need `v0.1.3`+) | `v0.1.3`+ | `0001`–`0004` |
| `unreleased` (`083d976`+) | `v0.1.0`+ | `unreleased`+ | `0001`–`0004` |

Mixing matrix: server is the source of truth. As long as you upgrade the
server (and run its migrations), older agents keep working — they just lose
features that need their side of the wire change.
