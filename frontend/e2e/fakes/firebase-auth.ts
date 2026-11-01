/** Stand-in for the `firebase/auth` package in browser tests (see fakes/firebase.ts). */
import { E2EUser, listen, setUser } from './firebase';

export type User = E2EUser;

export class GoogleAuthProvider {
  setCustomParameters() {}
}

export function onAuthStateChanged(_auth: unknown, callback: (user: E2EUser | null) => void) {
  return listen(callback);
}

/** The "Google account" picked in the popup; tests can override it with window.__e2eGoogleAccount. */
export async function signInWithPopup() {
  const chosen = (window as unknown as { __e2eGoogleAccount?: E2EUser | 'closed' }).__e2eGoogleAccount;
  if (chosen === 'closed') {
    const { FirebaseError } = await import('firebase/app');
    throw new FirebaseError('auth/popup-closed-by-user', 'Popup closed');
  }
  const user = chosen ?? { uid: 'uid-me', email: 'jacob@example.com', displayName: 'Jacob Poling', photoURL: null };
  setUser(user);
  return { user };
}

export async function signOut() {
  setUser(null);
}
