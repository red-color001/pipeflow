// Lightweight auth store: persists JWT + user in localStorage, exposes a tiny
// subscribe API so the App shell can render <Login/> until a token is present.
const TOKEN_KEY = 'pipeflow.token';
const USER_KEY  = 'pipeflow.user';

export interface AuthUser {
  id: number;
  username: string;
  must_change: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

const listeners = new Set<(s: AuthState) => void>();

function read(): AuthState {
  const token = localStorage.getItem(TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  let user: AuthUser | null = null;
  if (userRaw) {
    try { user = JSON.parse(userRaw) as AuthUser; } catch { user = null; }
  }
  return { token, user };
}

let state: AuthState = read();

function emit() {
  for (const l of listeners) l(state);
}

export function getAuth(): AuthState { return state; }

export function subscribeAuth(l: (s: AuthState) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  state = { token, user };
  emit();
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  state = { token: null, user: null };
  emit();
}

export function updateUser(patch: Partial<AuthUser>) {
  if (!state.user) return;
  state = { ...state, user: { ...state.user, ...patch } };
  localStorage.setItem(USER_KEY, JSON.stringify(state.user));
  emit();
}

const API = (import.meta as any).env?.VITE_API_URL ?? '/api';

export async function apiLogin(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `login failed (${r.status})`);
  }
  return r.json();
}

export async function apiChangePassword(current: string, next: string): Promise<void> {
  const tok = state.token;
  if (!tok) throw new Error('not logged in');
  const r = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tok}`,
    },
    body: JSON.stringify({ current, next }),
  });
  if (r.status === 204) return;
  const j = await r.json().catch(() => ({}));
  throw new Error(j.error || `change-password failed (${r.status})`);
}

export function authHeaders(): Record<string, string> {
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}
