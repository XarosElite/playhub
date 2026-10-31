import { initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';

// Firebase web config. These values are not secrets – they identify the
// Firebase project to the browser. Set them in the repo root .env.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

if (!isFirebaseConfigured) {
  console.error('Firebase is not configured: set the VITE_FIREBASE_* variables in .env');
}

/** Firebase Auth instance, or null when the VITE_FIREBASE_* variables are missing. */
export const auth: Auth | null = isFirebaseConfigured ? getAuth(initializeApp(firebaseConfig)) : null;

/** The current user's ID token (refreshed automatically when near expiry), or null if signed out. */
export async function getIdToken(): Promise<string | null> {
  return auth?.currentUser ? auth.currentUser.getIdToken() : null;
}
