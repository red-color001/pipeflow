import { useEffect, useMemo, useState } from 'react';
import { DiagramRF } from './components/rf/DiagramRF';
import { useStore } from './store';
import { getSocket, fetchTopology } from './socket';
import { COLORS } from './colors';
import type { NodeKind } from '@pipeflow/shared';

const KIND_LABEL: Record<NodeKind, string> = {
  user: 'user',
  ext:  'ext',
  fe:   'fe',
  be:   'be',
  svc:  'svc',
  wk:   'wk',
  kf:   'kafka',
  db:   'db',
  obs:  'obs',
};

export function App() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const metrics = useStore((s) => s.metrics);

  const [running, setRunning] = useState(true);

  useEffect(() => {
    fetchTopology().catch((e) => console.error('topology load failed:', e));
    getSocket();
  }, []);

  let live = 0, stale = 0, dead = 0;
  nodes.forEach((n) => {
    if (n.stub) return;
    if (n.status === 'live') live++;
    else if (n.status === 'stale') stale++;
    else dead++;
  });

  const kindSummary = useMemo(() => {
    const m = new Map<NodeKind, { count: number; color: string }>();
    nodes.forEach((n) => {
      if (n.stub) return;
      const cur = m.get(n.kind);
      if (cur) cur.count++;
      else m.set(n.kind, { count: 1, color: COLORS[n.color] || '#64748b' });
    });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [nodes]);

  const totalRate = useMemo(() => {
    let sum = 0;
    metrics.forEach((m) => { sum += m.in_rate; });
    return sum;
  }, [metrics]);
  const bottleneckCount = useMemo(() => {
    let c = 0;
    metrics.forEach((m) => { if (m.bottleneck) c++; });
    return c;
  }, [metrics]);

  return (
    <div className="app">
      <header className="hdr">
        <div className="title">
          <div className="dot"/>
          <h1>Pipeline Data Flow</h1>
        </div>
        <div className="meta">
          <Group>
            <Stat label="services" value={nodes.size}/>
            <Stat label="edges"    value={edges.size}/>
            <Stat label="ev/s"     value={totalRate.toFixed(1)}/>
          </Group>
          <Group>
            <span className="kvOn"><span className="liveDot"/>{live}</span>
            {stale > 0 && <span className="kvWarn"><span className="staleDot"/>{stale}</span>}
            {dead > 0  && <span className="kvOff"><span className="deadDot"/>{dead}</span>}
            {bottleneckCount > 0 && (
              <span className="kvBn">
                <span className="bnDot"/>{bottleneckCount} bottleneck{bottleneckCount > 1 ? 's' : ''}
              </span>
            )}
          </Group>
          {kindSummary.length > 0 && (
            <Group>
              {kindSummary.map(([kind, info]) => (
                <span key={kind} className="kindChip" title={kind}>
                  <span className="swatch" style={{ background: info.color, boxShadow: `0 0 6px ${info.color}` }}/>
                  <span style={{ color: 'var(--ink-dim)' }}>{KIND_LABEL[kind]}</span>
                  <b>{info.count}</b>
                </span>
              ))}
            </Group>
          )}
        </div>
      </header>

      <main className="stage">
        <DiagramRF running={running} particleSize="medium"/>
        <PlaybackToggle running={running} setRunning={setRunning}/>
        {nodes.size === 0 && <EmptyState/>}
      </main>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <span className="kvGroup">{children}</span>;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="kv">
      <b>{value}</b>
      <span style={{ color: 'var(--ink-dim)', marginLeft: 4 }}>{label}</span>
    </span>
  );
}

function PlaybackToggle({ running, setRunning }: { running: boolean; setRunning: (v: boolean) => void }) {
  return (
    <div className="playctl">
      <button onClick={() => setRunning(true)}  className={running ? 'pc on' : 'pc'}  title="Start">▶ Start</button>
      <button onClick={() => setRunning(false)} className={!running ? 'pc off' : 'pc'} title="Stop">■ Stop</button>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        textAlign: 'center', fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--ink-dim)',
        padding: 32,
        border: '1px dashed var(--line)',
        borderRadius: 12,
        background: 'rgba(7,11,24,0.6)',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.4 }}>○ ◦ ·</div>
        <div style={{ fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          waiting for agents
        </div>
        <div style={{ fontSize: 11, marginTop: 10, opacity: 0.7, lineHeight: 1.6 }}>
          install <code style={{ color: '#a5b4fc' }}>pipeflow-agent</code> in a service<br/>
          then call <code style={{ color: '#a5b4fc' }}>agent.start()</code>
        </div>
      </div>
    </div>
  );
}
