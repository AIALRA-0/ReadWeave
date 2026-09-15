import { vi } from "vitest";

// Install before the ordinary setup imports/constructs the production file logger.
// This replaces logging only; model calls, planning and judging remain real.
vi.mock("../../apps/server/src/log_provider.js", () => ({ default: class {
    log() {} info() {} error() {} banner() {} request() {}
    getLogContents() { return null; }
}}));
for (const method of ["log", "info", "warn", "error", "debug", "dir", "table", "trace"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
}
