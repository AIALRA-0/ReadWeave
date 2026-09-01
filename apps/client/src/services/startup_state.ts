import type { BootstrapDefinition } from "@triliumnext/commons";

type StartupState = Pick<BootstrapDefinition, "dbInitialized" | "passwordSet" | "loggedIn">;

/** Protected services start only after setup, password creation and login. */
export function isAuthenticatedAppReady(state: StartupState = window.glob): boolean {
    return state.dbInitialized === true
        && state.passwordSet !== false
        && state.loggedIn !== false;
}
