"""Generic env-driven agent. One container per agent.

Required env:
  PIPEFLOW_BACKEND    e.g. http://server:4000
  PIPEFLOW_TOKEN      bearer token
  AGENT_ID            unique id (also the hostname in the docker network)
  AGENT_LABEL         display label in UI
  AGENT_KIND          one of: user, ext, fe, be, svc, wk, kf, db, obs
  AGENT_COLOR         color key (amber, red, teal, ...)

Optional env:
  AGENT_TARGETS       JSON list:
    [{"to": "postgres", "color": "amber", "label": "orchestrate"}]
  AGENT_FLOWS         JSON list of per-target traffic patterns:
    [
      {"to": "postgres",
       "interval_min": 0.4, "interval_max": 0.9,
       "bytes_min": 200, "bytes_max": 1500,
       "latency_min": 30, "latency_max": 120}
    ]
"""
from __future__ import annotations

import json
import os
import random
import signal
import threading
import time

from pipeflow_agent import Agent


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        raise SystemExit(f"missing required env var: {name}")
    return v


def env_json(name: str, default):
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f"{name} is not valid JSON: {e}")


def main() -> None:
    agent = Agent(
        backend=env("PIPEFLOW_BACKEND"),
        token=env("PIPEFLOW_TOKEN"),
        id=env("AGENT_ID"),
        label=env("AGENT_LABEL"),
        node_type=env("AGENT_KIND"),
        color=env("AGENT_COLOR", "neutral"),
        targets=env_json("AGENT_TARGETS", []),
    )
    agent.start()

    flows = env_json("AGENT_FLOWS", [])
    threads: list[threading.Thread] = []

    def flow_loop(spec: dict) -> None:
        to = spec["to"]
        imin = float(spec.get("interval_min", 0.5))
        imax = float(spec.get("interval_max", 1.5))
        bmin = int(spec.get("bytes_min", 0))
        bmax = int(spec.get("bytes_max", 0))
        lmin = float(spec.get("latency_min", 0))
        lmax = float(spec.get("latency_max", 0))
        # Wait so the registration races settle and target stubs/agents exist.
        time.sleep(2)
        while True:
            byt = random.randint(bmin, bmax) if bmax > 0 else None
            lat = random.uniform(lmin, lmax) if lmax > 0 else None
            agent.flow(to, bytes_=byt, latency_ms=lat)
            time.sleep(random.uniform(imin, imax))

    for spec in flows:
        t = threading.Thread(target=flow_loop, args=(spec,),
                             name=f"flow-{spec['to']}", daemon=True)
        t.start()
        threads.append(t)

    print(f"[{agent.id}] running, {len(flows)} flow loop(s)")

    # Stay alive until SIGTERM/SIGINT.
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT,  lambda *_: stop.set())
    stop.wait()
    agent.stop()


if __name__ == "__main__":
    main()
