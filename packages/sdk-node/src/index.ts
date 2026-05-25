import type { RegisterPayload, NodeKind, ColorKey, TargetDecl } from '@pipeflow/shared';

export interface AgentOptions {
  backend: string;
  token: string;
  id: string;
  label: string;
  node_type: NodeKind;
  color?: ColorKey;
  service?: string;
  host?: string;
  version?: string;
  targets?: TargetDecl[];
  heartbeatIntervalMs?: number;
}

const REGISTER_RETRY_MS = 5_000;

export class Agent {
  private opts: AgentOptions;
  private timer: NodeJS.Timeout | null = null;
  private registered = false;
  private stopping = false;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' };
  }

  private payload(): RegisterPayload {
    return {
      id: this.opts.id,
      label: this.opts.label,
      node_type: this.opts.node_type,
      color: this.opts.color,
      service: this.opts.service,
      host: this.opts.host,
      version: this.opts.version,
      targets: this.opts.targets ?? [],
    };
  }

  private async tryRegister(): Promise<boolean> {
    try {
      const r = await fetch(`${this.opts.backend.replace(/\/$/, '')}/agents/register`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.payload()),
      });
      if (!r.ok) {
        console.warn(`pipeflow register failed: ${r.status} ${await r.text()}`);
        return false;
      }
      this.registered = true;
      return true;
    } catch (e) {
      console.warn(`pipeflow register error:`, e);
      return false;
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      const r = await fetch(`${this.opts.backend.replace(/\/$/, '')}/agents/${this.opts.id}/heartbeat`, {
        method: 'POST',
        headers: this.headers(),
      });
      if (r.status === 404) this.registered = false;
    } catch {
      this.registered = false;
    }
  }

  private scheduleNext(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => this.loop(), ms);
  }

  private async loop() {
    if (!this.registered) {
      const ok = await this.tryRegister();
      if (!ok) return this.scheduleNext(REGISTER_RETRY_MS);
    }
    await this.heartbeat();
    this.scheduleNext(this.opts.heartbeatIntervalMs ?? 5_000);
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.loop();
    process.on('SIGINT',  () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  async stop(deregister = true) {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (deregister && this.registered) {
      try {
        await fetch(`${this.opts.backend.replace(/\/$/, '')}/agents/${this.opts.id}/deregister`, {
          method: 'POST',
          headers: this.headers(),
        });
      } catch { /* ignore */ }
    }
  }
}
