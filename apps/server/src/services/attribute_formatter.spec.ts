import type { AttributeRow } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import attributeFormatter from "./attribute_formatter.js";

describe("attribute formatter", () => {
    it("escapes backslashes before quoting attribute values", () => {
        const attribute = {
            type: "label",
            name: "example",
            value: 'path\\with"quote'
        } as AttributeRow;

        expect(attributeFormatter.formatAttrForSearch(attribute, true))
            .toBe(String.raw`#example="path\\with\"quote"`);
    });
});
