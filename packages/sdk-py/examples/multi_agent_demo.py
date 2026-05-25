"""Spawn a swarm of fake agents to populate the diagram for demo purposes."""
import os
import time

from pipeflow_agent import Agent

TOKEN = os.environ["PIPEFLOW_TOKEN"]
BACKEND = os.environ.get("PIPEFLOW_BACKEND", "http://localhost:4000")

AGENTS = [
    Agent(BACKEND, TOKEN, id="youtube-api", label="YouTube API", node_type="ext", color="orange",
          targets=[{"to": "airflow", "color": "orange"}]),
    Agent(BACKEND, TOKEN, id="airflow", label="Airflow", node_type="svc", color="amber",
          targets=[{"to": "postgres", "color": "amber"},
                   {"to": "kafka-broker-0", "color": "amber"},
                   {"to": "etl-worker", "color": "amber"}]),
    Agent(BACKEND, TOKEN, id="postgres", label="Postgres", node_type="db", color="teal"),
    Agent(BACKEND, TOKEN, id="duckdb", label="DuckDB", node_type="db", color="green"),
    Agent(BACKEND, TOKEN, id="kafka-broker-0", label="Kafka · Broker 0", node_type="kf", color="red",
          targets=[{"to": "duckdb", "color": "red"}]),
    Agent(BACKEND, TOKEN, id="etl-worker", label="ETL · Worker", node_type="wk", color="violet",
          targets=[{"to": "kafka-broker-0", "color": "red"}]),
    Agent(BACKEND, TOKEN, id="ml-api", label="ML · API", node_type="wk", color="violet"),
    Agent(BACKEND, TOKEN, id="prometheus", label="Prometheus", node_type="obs", color="cyan"),
    Agent(BACKEND, TOKEN, id="grafana", label="Grafana", node_type="obs", color="cyan",
          targets=[{"to": "prometheus", "color": "cyan", "dashed": True}]),
]

for a in AGENTS:
    a.start()

print(f"Spawned {len(AGENTS)} agents. Ctrl+C to stop.")
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    for a in AGENTS:
        a.stop()
