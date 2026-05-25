"""Example: register Airflow with downstream targets.

Run in an Airflow scheduler/webserver process (e.g. via airflow_local_settings.py)
or as a standalone smoke test:

    PIPEFLOW_TOKEN=dev-token-change-me python examples/airflow_agent.py
"""
import os
import time

from pipeflow_agent import Agent

agent = Agent(
    backend=os.environ.get("PIPEFLOW_BACKEND", "http://localhost:4000"),
    token=os.environ["PIPEFLOW_TOKEN"],
    id="airflow",
    label="Airflow",
    node_type="svc",
    color="amber",
    service="orchestration",
    targets=[
        {"to": "postgres",       "color": "amber"},
        {"to": "kafka-broker-0", "color": "amber", "label": "orchestrate"},
        {"to": "etl-worker",     "color": "amber"},
        {"to": "ml-api",         "color": "amber"},
    ],
)

if __name__ == "__main__":
    agent.start()
    print("Airflow agent running. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        agent.stop()
