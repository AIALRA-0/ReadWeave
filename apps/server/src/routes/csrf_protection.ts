import crypto from "crypto";
import { doubleCsrf } from "csrf-csrf";

import sessionSecret from "../services/session_secret.js";
import { isElectron } from "../services/utils.js";

export const CSRF_COOKIE_NAME = "trilium-csrf";

// In Electron, API calls go through an IPC bypass (routes/electron.ts) that uses a
// FakeRequest with a static session ID, while the bootstrap request goes through real
// Express with a real session. This mismatch causes CSRF validation to always fail.
// We use a per-instance random identifier so each Electron process still gets unique tokens.
const electronSessionId = crypto.randomUUID();

const doubleCsrfUtilities = doubleCsrf({
    getSecret: () => sessionSecret,
    cookieOptions: {
        path: "/",
        secure: false,
        sameSite: "strict",
        httpOnly: !isElectron // set to false for Electron, see https://github.com/TriliumNext/Trilium/pull/966
    },
    cookieName: CSRF_COOKIE_NAME,
    getSessionIdentifier: (req) => isElectron ? electronSessionId : req.session.id
});

export const { generateCsrfToken, doubleCsrfProtection } = doubleCsrfUtilities;
