import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    isDbInitialized: vi.fn()
}));

vi.mock("../services/sql.js", () => ({
    default: {
        execute: mocks.execute
    }
}));

vi.mock("../services/sql_init.js", () => ({
    default: {
        isDbInitialized: mocks.isDbInitialized
    }
}));

import { cleanupExpiredSessions } from "./session_parser.js";

describe("session cleanup before initial setup", () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.isDbInitialized.mockReset();
    });

    it("does not query the sessions table before the database is initialized", () => {
        mocks.isDbInitialized.mockReturnValue(false);

        cleanupExpiredSessions();

        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("cleans expired sessions after the database is initialized", () => {
        mocks.isDbInitialized.mockReturnValue(true);
        mocks.execute.mockReturnValue({ changes: 0 });

        cleanupExpiredSessions();

        expect(mocks.execute).toHaveBeenCalledOnce();
    });
});
