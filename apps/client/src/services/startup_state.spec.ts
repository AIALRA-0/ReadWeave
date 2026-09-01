import { describe, expect, it } from "vitest";

import { isAuthenticatedAppReady } from "./startup_state.js";

describe("authenticated application startup state", () => {
    it("starts protected services only for a fully initialized authenticated app", () => {
        expect(isAuthenticatedAppReady({ dbInitialized: true, passwordSet: true, loggedIn: true } as Window["glob"])).toBe(true);
    });

    it.each([
        { dbInitialized: false, passwordSet: undefined, loggedIn: undefined },
        { dbInitialized: true, passwordSet: false, loggedIn: undefined },
        { dbInitialized: true, passwordSet: true, loggedIn: false }
    ])("blocks protected services for pre-auth state %#", (state) => {
        expect(isAuthenticatedAppReady(state as Window["glob"])).toBe(false);
    });
});
