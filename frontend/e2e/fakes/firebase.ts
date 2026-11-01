/**
 * Stand-in for src/Auth/firebase.ts in browser tests (aliased when
 * PLAYHUB_E2E=1, see vite.config.ts). The signed-in user lives in
 * localStorage so tests can start signed in and reloads keep the session.
 */
import type { Auth } from 'firebase/auth';

export const E2E_USER_KEY = 'playhub-e2e-user';

export interface E2EUser {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

type Listener = (user: E2EUser | null) => void;
const listeners = new Set<Listener>();

function read(): E2EUser | null {
  const raw = localStorage.getItem(E2E_USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export const fakeAuth = {
  get currentUser() {
    const user = read();
    return user ? { ...user, getIdToken: async () => `e2e-token-${user.uid}` } : null;
  },
  signOut: async () => setUser(null),
};

export function setUser(user: E2EUser | null) {
  if (user) localStorage.setItem(E2E_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(E2E_USER_KEY);
  listeners.forEach(listener => listener(user));
}

export function listen(listener: Listener) {
  listeners.add(listener);
  // Firebase reports the restored session asynchronously.
  setTimeout(() => listener(read()), 50);
  return () => listeners.delete(listener);
}

export const auth = fakeAuth as unknown as Auth;
export const isFirebaseConfigured = true;

export async function getIdToken(): Promise<string | null> {
  return fakeAuth.currentUser ? fakeAuth.currentUser.getIdToken() : null;
}
