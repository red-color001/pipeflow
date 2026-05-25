"""Traffic generator: spawn 10 fake pipeline agents and stream realistic flows.

Wave: youtube-api → airflow → fanout (postgres, kafka, etl-worker, ml-api)
                                                    │
                                                    ├─→ kafka-broker-0 → duckdb
                                                    └─→ ml-api ↔ ollama → duckdb
            grafana ← prometheus (scrape loop)
"""
from __future__ import annotations

import os
import random
import threading
import time

from pipeflow_agent import Agent

BACKEND = os.environ.get("PIPEFLOW_BACKEND", "http://server:4000")
TOKEN   = os.environ["PIPEFLOW_TOKEN"]

# ─── Topology declaration ────────────────────────────────────────────
agents: dict[str, Agent] = {}

def add(id, label, kind, color, targets=()):
    a = Agent(
        backend=BACKEND, token=TOKEN,
        id=id, label=label, node_type=kind, color=color,
        targets=[{"to": t, "color": c} for t, c in targets],
    )
    agents[id] = a

#         id              label            kind   color    targets [(to, edge_color)]
add("youtube-api",   "YouTube API",   "ext",  "orange", [("airflow",        "orange")])
add("airflow",       "Airflow",       "svc",  "amber",  [("postgres",       "amber"),
                                                          ("kafka-broker-0", "amber"),
                                                          ("etl-worker",     "amber"),
                                                          ("ml-api",         "amber")])
add("postgres",      "Postgres",      "db",   "teal")
add("kafka-broker-0","Kafka · B0",    "kf",   "red",    [("duckdb",         "red")])
add("etl-worker",    "ETL · Worker",  "wk",   "violet", [("kafka-broker-0", "red")])
add("ml-api",        "ML · API",      "wk",   "violet", [("ollama",         "purple")])
add("ollama",        "Ollama",        "svc",  "purple", [("duckdb",         "purple")])
add("duckdb",        "DuckDB",        "db",   "green")
add("prometheus",    "Prometheus",    "obs",  "cyan",   [("airflow",        "cyan"),
                                                          ("kafka-broker-0", "cyan")])
add("grafana",       "Grafana",       "obs",  "cyan",   [("prometheus",     "cyan")])

# ─── Boot every agent (register + heartbeat) ─────────────────────────
for a in agents.values():
    a.start()

# Wait for registrations to settle before sending flow events.
time.sleep(2)

# ─── Flow loops ──────────────────────────────────────────────────────
# Each loop drives a realistic-ish traffic pattern. Run in parallel.
def loop_ingest():
    """YouTube → Airflow — fast ingestion (creates bottleneck pressure)."""
    while True:
        agents["youtube-api"].flow("airflow",
                                   bytes_=random.randint(800, 4000),
                                   latency_ms=random.uniform(15, 40))
        time.sleep(random.uniform(0.05, 0.15))  # ~10/s in

def loop_orchestrate():
    """Airflow fans out — slow drain. In_rate > out_rate ⇒ bottleneck."""
    while True:
        for target in ["postgres", "kafka-broker-0", "etl-worker", "ml-api"]:
            agents["airflow"].flow(target,
                                   bytes_=random.randint(200, 1500),
                                   latency_ms=random.uniform(80, 220))
            time.sleep(random.uniform(0.5, 0.9))  # ~1/s out per target
        time.sleep(random.uniform(0.4, 0.8))

def loop_etl():
    """ETL → Kafka → DuckDB."""
    while True:
        agents["etl-worker"].flow("kafka-broker-0", bytes_=random.randint(500, 3000))
        time.sleep(random.uniform(0.1, 0.3))
        agents["kafka-broker-0"].flow("duckdb", bytes_=random.randint(500, 3000))
        time.sleep(random.uniform(0.2, 0.6))

def loop_ml():
    """ML cycle ml-api → ollama → duckdb."""
    while True:
        agents["ml-api"].flow("ollama", bytes_=random.randint(100, 800))
        time.sleep(random.uniform(0.6, 1.5))
        agents["ollama"].flow("duckdb", bytes_=random.randint(100, 800))
        time.sleep(random.uniform(0.5, 1.0))

def loop_observability():
    """Grafana pulls from Prometheus, Prometheus scrapes services."""
    while True:
        agents["prometheus"].flow("airflow",        bytes_=128)
        time.sleep(0.3)
        agents["prometheus"].flow("kafka-broker-0", bytes_=128)
        time.sleep(0.3)
        agents["grafana"].flow("prometheus",        bytes_=64)
        time.sleep(random.uniform(0.4, 0.8))

loops = [loop_ingest, loop_orchestrate, loop_etl, loop_ml, loop_observability]
for fn in loops:
    threading.Thread(target=fn, name=fn.__name__, daemon=True).start()

print(f"traffic-generator: {len(agents)} agents registered, {len(loops)} loops running")
print("Ctrl+C to stop.")
try:
    while True:
        time.sleep(60)
except KeyboardInterrupt:
    for a in agents.values():
        a.stop()
