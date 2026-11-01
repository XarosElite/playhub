import { useEffect } from "react";
import { NavigateOptions, To, useNavigate } from "react-router-dom";

/**
 * Like react-router's <Navigate>, but navigates once, on mount. <Navigate>
 * navigates on every render, which loops while AnimatePresence keeps the old
 * page rendered during the login ↔ app transition.
 */
const Redirect: React.FC<{ to: To } & NavigateOptions> = ({ to, ...options }) => {
    const navigate = useNavigate();
    useEffect(() => {
        navigate(to, options);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
};

export default Redirect;
