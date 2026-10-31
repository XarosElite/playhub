import { makeAutoObservable, runInAction } from "mobx";
import { createContext } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth";

import { auth } from "../Auth/firebase";
import { AuthApi } from "../Api/Auth";

/**
 * Holds the Firebase session. Account data lives in Firebase; the backend
 * verifies the ID token on every request.
 */
class AuthStore {
    public user: User | null = null;
    // True until Firebase has restored (or ruled out) a saved session on page load.
    public initializing: boolean = true;
    // True while a sign-in is in progress, so the login page doesn't redirect
    // before the backend has accepted the account.
    public signingIn: boolean = false;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });

        if (!auth) {
            this.initializing = false;
            return;
        }
        onAuthStateChanged(auth, user => {
            runInAction(() => {
                this.user = user;
                this.initializing = false;
            });
        });
    }

    /**
     * Signs in with a Google popup, then confirms the backend accepts the
     * account. Throws (and signs back out) if it doesn't.
     */
    public async signInWithGoogle(): Promise<void> {
        if (!auth) throw new Error('Firebase is not configured.');

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        this.signingIn = true;
        try {
            await signInWithPopup(auth, provider);
            await AuthApi.getMe();
        } catch (error) {
            await signOut(auth);
            throw error;
        } finally {
            runInAction(() => {
                this.signingIn = false;
            });
        }
    }

    public async signOut(): Promise<void> {
        if (auth) await signOut(auth);
    }
}

export const authStore = new AuthStore();
export const AuthContext = createContext(authStore);
