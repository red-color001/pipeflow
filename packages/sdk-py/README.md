# pipeflow-agent (Python)

Tiny agent SDK that registers a service as a live node in the pipeflow topology UI and heartbeats every 5s.

## Install

```bash
pip install -e packages/sdk-py
```

## Use

```python
from pipeflow_agent import Agent

agent = Agent(
    backend="http://pipeflow-server:4000",
    token=os.environ["PIPEFLOW_TOKEN"],
    id="airflow",
    label="Airflow",
    node_type="svc",     # one of: user, ext, fe, be, svc, wk, kf, db, obs
    color="amber",
    targets=[
        {"to": "postgres",       "color": "amber"},
        {"to": "kafka-broker-0", "color": "amber", "label": "orchestrate"},
    ],
)
agent.start()
```

The background thread is a daemon — it dies with the process. `agent.stop()` is registered with `atexit` and deregisters cleanly on SIGINT/SIGTERM.

## Airflow integration

Drop into `airflow_local_settings.py` (Airflow imports this at scheduler/webserver boot):

```python
# airflow_local_settings.py
import os
from pipeflow_agent import Agent

_pipeflow = Agent(
    backend=os.environ.get("PIPEFLOW_BACKEND", "http://pipeflow-server:4000"),
    token=os.environ["PIPEFLOW_TOKEN"],
    id="airflow", label="Airflow", node_type="svc", color="amber",
    targets=[{"to": "postgres", "color": "amber"}],
)
_pipeflow.start()
```

## Node types

| kind   | meaning                |
|--------|------------------------|
| user   | human / external user  |
| ext    | external API           |
| fe     | frontend               |
| be     | backend / API          |
| svc    | service (Airflow, etc) |
| wk     | worker (ETL, ML)       |
| kf     | Kafka broker / op      |
| db     | database               |
| obs    | observability          |

The backend picks the right cluster automatically from the `node_type`.
