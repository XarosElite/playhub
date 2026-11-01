import { useContext, useState } from "react";
import { observer } from "mobx-react";
import { Location, Navigate, useLocation } from "react-router-dom";
import {
    ActionIcon,
    Alert,
    Button,
    Image,
    Paper,
    Stack,
    Text,
    Title,
    Tooltip,
    useMantineColorScheme,
} from "@mantine/core";
import { IconAlertCircle, IconMoon, IconSun } from "@tabler/icons-react";
import { isAxiosError } from "axios";
import { FirebaseError } from "firebase/app";

import { AuthContext } from "../Store/AuthStore";
import { isFirebaseConfigured } from "../Auth/firebase";

import bannerLight from '/playhub_logo_light.svg';
import bannerDark from '/playhub_logo_dark.svg';

import classes from './Login.module.scss';

// Popup errors that just mean the user backed out – not worth showing.
const IGNORED_FIREBASE_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

function describeSignInError(error: unknown): string | null {
    if (error instanceof FirebaseError) {
        if (IGNORED_FIREBASE_ERRORS.has(error.code)) return null;
        if (error.code === 'auth/popup-blocked') return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
        if (error.code === 'auth/unauthorized-domain') return `${window.location.hostname} is not an authorized domain in Firebase. Add it under Authentication → Settings → Authorized domains.`;
        return `Sign-in failed (${error.code}).`;
    }
    if (isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === 'string') return detail;
        return 'Signed in with Google, but the PlayHub server could not be reached.';
    }
    return 'Sign-in failed. Please try again.';
}

const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
);

const Login = observer(() => {
    const authStore = useContext(AuthContext);
    const location = useLocation();
    const [error, setError] = useState<string | null>(null);

    const { setColorScheme, colorScheme } = useMantineColorScheme();
    const darkMode = colorScheme === 'dark';

    // Already signed in (and not mid sign-in): go where the user was headed.
    if (authStore.user && !authStore.signingIn) {
        const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/';
        return <Navigate to={from} replace />;
    }

    const handleSignIn = () => {
        setError(null);
        authStore.signInWithGoogle().catch(err => setError(describeSignInError(err)));
    };

    return (
        <div className={classes.page}>
            <Tooltip label='Toggle color theme'>
                <ActionIcon
                    className={classes.themeToggle}
                    variant={darkMode ? 'outline' : 'filled'}
                    color={darkMode ? 'green' : 'green.6'}
                    size="md"
                    aria-label="Toggle color theme"
                    onClick={() => setColorScheme(darkMode ? 'light' : 'dark')}
                >
                    {darkMode ? <IconMoon stroke={1} /> : <IconSun stroke={1} />}
                </ActionIcon>
            </Tooltip>

            <Paper className={classes.card} withBorder shadow="md" radius="md" p="xl">
                <Stack align="center" gap="lg">
                    <Image src={darkMode ? bannerDark : bannerLight} className={classes.logo} alt="PlayHub" />

                    <Stack gap={4} align="center">
                        <Title order={2}>Welcome back</Title>
                        <Text c="dimmed" size="sm" ta="center">
                            Sign in to manage your game servers
                        </Text>
                    </Stack>

                    {!isFirebaseConfigured && (
                        <Alert color="yellow" icon={<IconAlertCircle />} title="Sign-in is not configured" w="100%">
                            Set the <code>VITE_FIREBASE_*</code> variables in <code>.env</code> and restart the frontend.
                        </Alert>
                    )}

                    {error && (
                        <Alert color="red" icon={<IconAlertCircle />} w="100%" withCloseButton onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    <Button
                        fullWidth
                        size="md"
                        variant="default"
                        leftSection={<GoogleIcon />}
                        loading={authStore.signingIn}
                        disabled={!isFirebaseConfigured}
                        onClick={handleSignIn}
                    >
                        Continue with Google
                    </Button>
                </Stack>
            </Paper>
        </div>
    );
});

export default Login;
