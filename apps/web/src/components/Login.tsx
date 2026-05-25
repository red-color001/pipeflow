import { useState } from 'react';
import { apiLogin, setSession } from '../auth';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { token, user } = await apiLogin(username.trim(), password);
      setSession(token, user);
    } catch (e: any) {
      setErr(e.message || 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginShell">
      <form className="loginCard" onSubmit={onSubmit}>
        <div className="loginTitle">
          <span className="loginDot"/>
          <h2>Pipeflow</h2>
        </div>
        <label className="loginField">
          <span>username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="username"
          />
        </label>
        <label className="loginField">
          <span>password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {err && <div className="loginErr">{err}</div>}
        <button className="loginBtn" type="submit" disabled={busy || !username || !password}>
          {busy ? '…' : 'sign in'}
        </button>
      </form>
    </div>
  );
}
