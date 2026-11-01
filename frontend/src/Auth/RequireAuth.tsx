import React, { useContext } from "react";
import { observer } from "mobx-react";
import { Navigate, useLocation } from "react-router-dom";
import { Center, Loader } from "@mantine/core";

import { AuthContext } from "../Store/AuthStore";

/**
 * Renders its children only for a signed-in user; otherwise redirects to
 * /login, remembering where the user was headed.
 */
const RequireAuth: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const authStore = useContext(AuthContext);
    const location = useLocation();

    if (authStore.initializing) {
        return (
            <Center h="100vh">
                <Loader />
            </Center>
        );
    }

    if (!authStore.user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return <>{children}</>;
});

export default RequireAuth;
