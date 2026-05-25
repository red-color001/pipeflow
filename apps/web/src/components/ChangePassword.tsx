import { useState } from 'react';
import { apiChangePassword, updateUser } from '../auth';

export function ChangePassword({
  forced,
  onClose,
}: {
  forced?: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next.length < 4) { setErr('new password must be at least 4 chars'); return; }
    if (next !== confirm) { setErr('passwords do not match'); return; }
    setBusy(true);
    try {
      await apiChangePassword(current, next);
      updateUser({ must_change: false });
      onClose();
    } catch (e: any) {
      setErr(e.message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onClick={forced ? undefined : onClose}>
      <form className="modalCard" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="modalHeader">
          <h3>{forced ? 'Set a new password' : 'Change password'}</h3>
          {!forced && <button type="button" className="modalX" onClick={onClose}>×</button>}
        </div>
        {forced && (
          <div className="modalNote">
            Default credentials detected. Please choose a new password before continuing.
          </div>
        )}
        <label className="loginField">
          <span>current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <label className="loginField">
          <span>new password</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="loginField">
          <span>confirm new password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {err && <div className="loginErr">{err}</div>}
        <div className="modalRow">
          {!forced && <button type="button" className="modalBtn ghost" onClick={onClose}>Cancel</button>}
          <button type="submit" className="modalBtn" disabled={busy || !current || !next}>
            {busy ? '…' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  );
}
