import { beforeAll, describe, expect, it } from "vitest";
import { trimIndentation } from "@triliumnext/commons";
import { getMermaidDiagnostics } from "./mermaid.js";

describe("Mermaid linter", () => {
    // Mermaid's first import initializes every diagram parser. Under the full Windows
    // test matrix that one-time setup can exceed the ordinary assertion timeout even
    // though parsing itself takes milliseconds. Keep the product path lazy and isolate
    // dependency startup from the behavior assertions.
    beforeAll(async () => {
        await import("mermaid");
    }, 30_000);

    it("reports correctly bad diagram type", async () => {
        const input = trimIndentation`\
            stateDiagram-v23
            [*] -> Still
        `;

        const result = await getMermaidDiagnostics(input);
        expect(result).toMatchObject([{
            message: "Expecting 'SPACE', 'NL', 'SD', got 'ID'",
            fromLine: 1,
            fromColumn: 0,
            toLine: 1,
            toColumn: 1
        }]);
    });

    it("reports lexical errors by highlighting the whole line", async () => {
        const input = trimIndentation`\
            flowchart TDs
                A[Christmas] -->|Get money| B(Go shopping)
        `;

        const result = await getMermaidDiagnostics(input);
        expect(result).toMatchObject([{
            message: "Lexical error on line 1. Unrecognized text.",
            fromLine: 1,
            fromColumn: 0,
            toLine: 1,
            toColumn: "flowchart TDs".length
        }]);
    });

    it("reports correctly basic arrow missing in diagram", async () => {
        const input = trimIndentation`\
            xychart-beta horizontal
            title "Percentage usge"
            x-axis [data, sys, usr, var]
            y-axis 0--->100
            bar [20, 70, 0, 0]
        `;

        const result = await getMermaidDiagnostics(input);
        expect(result).toMatchObject([{
            message: "Expecting 'ARROW_DELIMITER', got 'MINUS'",
            fromLine: 4,
            fromColumn: 8,
            toLine: 4,
            toColumn: 9
        }]);
    });
});
