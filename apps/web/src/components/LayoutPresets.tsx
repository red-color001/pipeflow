import { useEffect, useState } from 'react';

const API = (import.meta.env.VITE_API_URL ?? '/api');

interface Preset {
  id: number;
  name: string;
  nodes: number;
  created_at: string;
  updated_at: string;
}

export function LayoutPresets() {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function refresh() {
    try {
      const r = await fetch(`${API}/layouts`);
      if (r.ok) setPresets(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => { if (open) refresh(); }, [open]);

  async function save() {
    const name = window.prompt('Layout name?');
    if (!name) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/layouts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) {
        const err = await r.text();
        alert(`Save failed: ${err}`);
      } else {
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function apply(id: number) {
    setBusyId(id);
    try {
      await fetch(`${API}/layouts/${id}/apply`, { method: 'POST' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this layout?')) return;
    await fetch(`${API}/layouts/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div style={{
      position: 'absolute', right: 18, top: 138,
      zIndex: 4, fontFamily: "'JetBrains Mono', monospace",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', fontSize: 11,
          background: 'rgba(7,11,24,0.88)', backdropFilter: 'blur(10px)',
          color: 'var(--ink)', border: '1px solid var(--line)',
          borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        }}
        title="Layouts">
        <span style={{ fontSize: 13 }}>⊞</span>
        layouts {presets.length > 0 && <span style={{ color: 'var(--ink-dim)' }}>· {presets.length}</span>}
      </button>

      {open && (
        <div style={{
          marginTop: 6, width: 240,
          background: 'rgba(7,11,24,0.94)', backdropFilter: 'blur(10px)',
          border: '1px solid var(--line)', borderRadius: 10,
          padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
          fontSize: 11,
        }}>
          <button onClick={save} disabled={saving}
                  style={{
                    padding: '7px 10px', fontSize: 11, fontWeight: 600,
                    background: 'rgba(129,140,248,0.14)',
                    color: '#a5b4fc',
                    border: '1px solid rgba(129,140,248,0.32)',
                    borderRadius: 6, cursor: saving ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}>
            {saving ? 'saving…' : '+ save current'}
          </button>

          {presets.length === 0 && (
            <div style={{ padding: '8px 4px', color: 'var(--ink-dim)', textAlign: 'center' }}>
              no presets yet
            </div>
          )}

          {presets.map((p) => (
            <div key={p.id}
                 style={{
                   display: 'flex', alignItems: 'center', gap: 6,
                   padding: '6px 8px',
                   background: 'rgba(255,255,255,0.02)',
                   border: '1px solid var(--line)',
                   borderRadius: 6,
                 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--ink-dim)' }}>
                  {p.nodes} nodes
                </div>
              </div>
              <button onClick={() => apply(p.id)} disabled={busyId === p.id}
                      title="Apply"
                      style={{
                        padding: '4px 8px', fontSize: 10,
                        background: 'transparent', color: '#34d399',
                        border: '1px solid rgba(52,211,153,0.28)',
                        borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}>
                {busyId === p.id ? '…' : 'apply'}
              </button>
              <button onClick={() => remove(p.id)} title="Delete"
                      style={{
                        padding: '4px 7px', fontSize: 11,
                        background: 'transparent', color: '#f87171',
                        border: '1px solid rgba(248,113,113,0.28)',
                        borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'inherit', lineHeight: 1,
                      }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
