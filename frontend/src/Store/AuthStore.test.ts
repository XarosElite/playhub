import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => {
  let listener: ((user: unknown) => void) | null = null;
  return {
    onAuthStateChanged: vi.fn((_auth: unknown, callback: (user: unknown) => void) => { listener = callback; return () => {}; }),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    GoogleAuthProvider: vi.fn(function (this: { setCustomParameters: unknown; params?: unknown }) {
      this.setCustomParameters = vi.fn((params: unknown) => { this.params = params; });
    }),
    emit: (user: unknown) => listener?.(user),
  };
});
vi.mock('firebase/auth', () => firebaseAuth);

const config = vi.hoisted(() => ({ auth: { name: 'auth' } as unknown }));
vi.mock('../Auth/firebase', () => ({
  get auth() { return config.auth; },
  getIdToken: vi.fn(),
  isFirebaseConfigured: true,
}));

const getMe = vi.hoisted(() => vi.fn());
vi.mock('../Api/Auth', () => ({ AuthApi: { getMe } }));

async function freshStore() {
  vi.resetModules();
  return (await import('./AuthStore')).authStore;
}

beforeEach(() => {
  config.auth = { name: 'auth' };
  firebaseAuth.signInWithPopup.mockResolvedValue({ user: { uid: 'uid-me' } });
  firebaseAuth.signOut.mockResolvedValue(undefined);
  getMe.mockResolvedValue({ uid: 'uid-me' });
});

describe('restoring the session', () => {
  it('is initializing until Firebase reports', async () => {
    const store = await freshStore();
    expect(store.initializing).toBe(true);
    expect(store.user).toBeNull();
    expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalledWith(config.auth, expect.any(Function));

    firebaseAuth.emit({ uid: 'uid-me', email: 'me@example.com' });
    expect(store.initializing).toBe(false);
    expect(store.user).toEqual({ uid: 'uid-me', email: 'me@example.com' });
  });

  it('signed out', async () => {
    const store = await freshStore();
    firebaseAuth.emit(null);
    expect(store.initializing).toBe(false);
    expect(store.user).toBeNull();
  });

  it('follows later sign-outs', async () => {
    const store = await freshStore();
    firebaseAuth.emit({ uid: 'uid-me' });
    firebaseAuth.emit(null);
    expect(store.user).toBeNull();
  });

  it('without Firebase configured there is nothing to wait for', async () => {
    config.auth = null;
    firebaseAuth.onAuthStateChanged.mockClear();
    const store = await freshStore();
    expect(store.initializing).toBe(false);
    expect(firebaseAuth.onAuthStateChanged).not.toHaveBeenCalled();
  });
});

describe('signInWithGoogle', () => {
  it('opens the Google popup with the account chooser, then checks the backend accepts the account', async () => {
    const store = await freshStore();
    const signingIn: boolean[] = [];
    firebaseAuth.signInWithPopup.mockImplementation(async () => { signingIn.push(store.signingIn); return {}; });
    await store.signInWithGoogle();
    expect(signingIn).toEqual([true]);
    expect(store.signingIn).toBe(false);
    const provider = firebaseAuth.signInWithPopup.mock.calls[0][1] as { params: unknown };
    expect(provider.params).toEqual({ prompt: 'select_account' });
    expect(getMe).toHaveBeenCalledOnce();
    expect(firebaseAuth.signOut).not.toHaveBeenCalled();
  });

  it('signs back out if the backend rejects the account', async () => {
    const store = await freshStore();
    const forbidden = Object.assign(new Error('403'), { response: { status: 403 } });
    getMe.mockRejectedValue(forbidden);
    await expect(store.signInWithGoogle()).rejects.toBe(forbidden);
    expect(firebaseAuth.signOut).toHaveBeenCalledWith(config.auth);
    expect(store.signingIn).toBe(false);
  });

  it('a closed popup is passed on', async () => {
    const store = await freshStore();
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    await expect(store.signInWithGoogle()).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
    expect(getMe).not.toHaveBeenCalled();
    expect(store.signingIn).toBe(false);
  });

  it('fails clearly when Firebase is not configured', async () => {
    config.auth = null;
    const store = await freshStore();
    await expect(store.signInWithGoogle()).rejects.toThrow('Firebase is not configured.');
  });
});

describe('signOut', () => {
  it('signs out of Firebase', async () => {
    const store = await freshStore();
    await store.signOut();
    expect(firebaseAuth.signOut).toHaveBeenCalledWith(config.auth);
  });

  it('is a no-op without Firebase', async () => {
    config.auth = null;
    const store = await freshStore();
    await store.signOut();
    expect(firebaseAuth.signOut).not.toHaveBeenCalled();
  });
});
