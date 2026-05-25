"""pipeflow_agent — register a service as a live node in the topology UI.

Usage:

    from pipeflow_agent import Agent

    agent = Agent(
        backend="http://pipeflow-server:4000",
        token=os.environ["PIPEFLOW_TOKEN"],
        id="airflow-scheduler",
        label="Airflow",
        node_type="svc",
        color="amber",
        targets=[
            {"to": "postgres", "color": "amber"},
            {"to": "kafka-broker-0", "color": "amber", "label": "orchestrate"},
        ],
    )
    agent.start()
"""
from __future__ import annotations

import atexit
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests

log = logging.getLogger("pipeflow_agent")

_HEARTBEAT_INTERVAL_S = 5
_REGISTER_RETRY_S = 5


@dataclass
class Agent:
    backend: str
    token: str
    id: str
    label: str
    node_type: str
    color: str = "neutral"
    service: str | None = None
    host: str | None = None
    version: str | None = None
    targets: Iterable[dict[str, Any]] = field(default_factory=list)
    heartbeat_interval_s: float = _HEARTBEAT_INTERVAL_S
    # When True, the heartbeat body includes CPU + memory stats (psutil).
    # Falls back silently if psutil isn't importable.
    report_stats: bool = True

    _stop: threading.Event = field(default_factory=threading.Event, init=False, repr=False)
    _thread: threading.Thread | None = field(default=None, init=False, repr=False)
    _registered: bool = field(default=False, init=False, repr=False)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def _register_payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "node_type": self.node_type,
            "color": self.color,
            "targets": list(self.targets) if self.targets else [],
        }
        # Only include optional fields when set — server rejects nulls on
        # `service`/`host`/`version` because they're typed as optional strings.
        if self.service is not None: body["service"] = self.service
        if self.host    is not None: body["host"]    = self.host
        if self.version is not None: body["version"] = self.version
        return body

    def _register_once(self) -> bool:
        try:
            r = requests.post(
                f"{self.backend.rstrip('/')}/agents/register",
                json=self._register_payload(),
                headers=self._headers(),
                timeout=5,
            )
            if r.status_code >= 400:
                log.warning("pipeflow register failed: %s %s", r.status_code, r.text[:200])
                return False
            self._registered = True
            return True
        except requests.RequestException as e:
            log.warning("pipeflow register error: %s", e)
            return False

    def flow(self, to: str, bytes_: int | None = None,
             latency_ms: float | None = None) -> None:
        """Emit a flow event (one particle on the edge from self → `to`).

        Non-blocking-ish: a single HTTP POST. Swallow network errors so
        traffic loops don't crash on transient failures.
        """
        if not self._registered:
            return
        try:
            body: dict[str, Any] = {"to": to}
            if bytes_ is not None:      body["bytes"] = bytes_
            if latency_ms is not None:  body["latency_ms"] = latency_ms
            requests.post(
                f"{self.backend.rstrip('/')}/agents/{self.id}/flow",
                json=body,
                headers=self._headers(),
                timeout=3,
            )
        except requests.RequestException as e:
            log.debug("pipeflow flow error: %s", e)

    # ── Auto-instrumentation for the `requests` library ───────────────────
    # Patches `requests.Session.send` once per process. Every outbound HTTP
    # call whose host (or `X-Pipeflow-To` header) maps to a known agent id
    # emits a flow event with measured latency. Use this so apps don't need
    # to sprinkle `agent.flow(...)` everywhere.
    def instrument_requests(self, host_map: dict[str, str] | None = None) -> None:
        """Auto-emit flow events for every outbound `requests` call.

        `host_map` resolves a target hostname → registered agent id. If the
        host isn't in the map, the call is ignored (so we don't spam stub
        nodes for every random URL the app hits).
        """
        import time
        import requests as _r
        from urllib.parse import urlparse

        # Use a per-instance flag plus a module-level guard so multiple Agent
        # instances in one process don't stack patches.
        if getattr(_r.Session.send, "_pipeflow_patched", False):
            log.debug("requests already instrumented in this process")
            return

        host_map = dict(host_map or {})
        original_send = _r.Session.send
        agent_self = self

        def wrapped(self, request, **kw):  # type: ignore[no-redef]
            start = time.perf_counter()
            try:
                response = original_send(self, request, **kw)
            finally:
                elapsed_ms = (time.perf_counter() - start) * 1000.0
            try:
                # Resolve target: explicit header wins, else look up host.
                target = request.headers.get("X-Pipeflow-To") if hasattr(request, "headers") else None
                if target is None:
                    host = urlparse(request.url).hostname or ""
                    target = host_map.get(host)
                if target:
                    size = 0
                    try:
                        # Outbound body size — best-effort, don't read streams.
                        if request.body is None: size = 0
                        elif isinstance(request.body, (bytes, bytearray)): size = len(request.body)
                        elif isinstance(request.body, str): size = len(request.body.encode("utf-8"))
                    except Exception:
                        size = 0
                    agent_self.flow(target, bytes_=size or None,
                                    latency_ms=round(elapsed_ms, 2))
            except Exception as e:  # never break the host's HTTP call
                log.debug("pipeflow instrument error: %s", e)
            return response

        wrapped._pipeflow_patched = True  # type: ignore[attr-defined]
        _r.Session.send = wrapped         # type: ignore[assignment]
        log.info("pipeflow: requests auto-instrument active (%d hosts mapped)", len(host_map))

    def _collect_stats(self) -> dict[str, Any]:
        """Snapshot host CPU + memory via psutil. Returns {} if unavailable."""
        if not self.report_stats:
            return {}
        try:
            import psutil  # type: ignore
        except Exception:
            return {}
        out: dict[str, Any] = {}
        try:
            # Non-blocking CPU sample (delta since last call). First call after
            # process start returns 0.0 which is harmless.
            cpu = psutil.cpu_percent(interval=None)
            if cpu is not None:
                out["cpu_pct"] = round(float(cpu), 2)
        except Exception as e:
            log.debug("pipeflow cpu_percent error: %s", e)
        try:
            vm = psutil.virtual_memory()
            out["mem_pct"] = round(float(vm.percent), 2)
            out["mem_used_bytes"] = int(vm.used)
            out["mem_total_bytes"] = int(vm.total)
        except Exception as e:
            log.debug("pipeflow virtual_memory error: %s", e)
        return out

    def _heartbeat_once(self) -> None:
        try:
            body = self._collect_stats()
            requests.post(
                f"{self.backend.rstrip('/')}/agents/{self.id}/heartbeat",
                json=body if body else {},
                headers=self._headers(),
                timeout=5,
            )
        except requests.RequestException as e:
            log.debug("pipeflow heartbeat error: %s", e)
            self._registered = False  # will re-register on next loop

    def _loop(self) -> None:
        while not self._stop.is_set():
            if not self._registered:
                if not self._register_once():
                    self._stop.wait(_REGISTER_RETRY_S)
                    continue
            self._heartbeat_once()
            self._stop.wait(self.heartbeat_interval_s)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=f"pipeflow-{self.id}", daemon=True)
        self._thread.start()
        atexit.register(self.stop)

    def stop(self, deregister: bool = True) -> None:
        self._stop.set()
        if deregister and self._registered:
            try:
                requests.post(
                    f"{self.backend.rstrip('/')}/agents/{self.id}/deregister",
                    headers=self._headers(),
                    timeout=3,
                )
            except requests.RequestException:
                pass
        if self._thread:
            self._thread.join(timeout=2)
