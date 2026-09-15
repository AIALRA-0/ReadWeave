import type { ReadWeaveClaim, ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { applyReadWeaveSourceSupport, inspectReadWeaveSourceSupport } from "./readweave_source_support.js";

const title = "Inference and computation for Gaussian process regression model";
const otherTitle = "Queue scheduling with bounded leases";
const doi = "10.5555/example.inference";
const otherDoi = "10.5555/example.queues";
const technical = "高斯过程由均值函数和核函数完全刻画";
const bibliographic = (paper = title, identifier = doi) => `论文《${paper}》的 DOI 是 ${identifier}`;
const claim = (text: string, sourceIds = ["S1"], claimId = "C1"): ReadWeaveClaim => ({
    claimId, text, sourceIds, confidence: "high", unresolved: false
});
const source = (paper = title, identifier = doi, sourceId = "S1", excerpt = `Publisher metadata; DOI ${identifier}`): ReadWeaveEvidenceSource => ({
    sourceId, sourceType: "external", provider: "Crossref", title: paper,
    url: `https://doi.org/${identifier}`, excerpt, accessedAt: "2026-09-15T00:00:00Z"
});

describe("local source support, distinct from citation validity", () => {
    it.each(["如果资料属实，", "可能", "Could "])("does not bound a conditional or uncertain body occurrence: %s", prefix => {
        const text = bibliographic(title, otherDoi);
        const body = `${prefix}${text}？`;
        expect(applyReadWeaveSourceSupport(body, [claim(text)], [source(otherTitle, otherDoi)]).body).toBe(body);
    });

    it("preserves suffix qualification while still bounding an independent positive sibling", () => {
        const text = bibliographic(title, otherDoi);
        const body = `${text}（待核实）。\n\n${text}。`;
        const result = applyReadWeaveSourceSupport(body, [claim(text)], [source(otherTitle, otherDoi)]);
        expect(result.body.startsWith(`${text}（待核实）。`)).toBe(true);
        expect(result.body.split("\n\n")[1]).toContain("尚无法确认");
    });

    it("preserves an explicit denial after the quoted association", () => {
        const text = bibliographic(title, otherDoi);
        const body = `${text}的说法不成立。`;
        expect(applyReadWeaveSourceSupport(body, [claim(text)], [source(otherTitle, otherDoi)]).body).toBe(body);
    });

    it("does not confuse punctuation-bearing titles with another work", () => {
        const text = bibliographic("Programming C++", doi);
        expect(inspectReadWeaveSourceSupport([claim(text)], [source("Programming C", doi)])[0].status).not.toBe("metadata-supported");
    });

    it("does not bind multiple DOI values to one title without a record-level association", () => {
        const record = source(title, doi, "S1", `Publisher metadata; DOI ${doi}; DOI ${otherDoi}`);
        expect(inspectReadWeaveSourceSupport([claim(bibliographic(title, otherDoi))], [record])[0].status).toBe("not-checked");
    });

    it("bounds only the mismatched association in a mixed raw claim", () => {
        const valid = bibliographic();
        const invalid = bibliographic(otherTitle, doi);
        const body = `${valid}；${invalid}。`;
        const result = applyReadWeaveSourceSupport(body, [claim(body)], [source()]);
        expect(result.body.startsWith(`${valid}；`)).toBe(true);
        expect(result.body).toContain(`《${otherTitle}》的 DOI 尚无法确认`);
    });

    it("keeps an identical association with a separate admitted supporting citation", () => {
        const text = bibliographic(title, otherDoi);
        const body = `${text}[S1]。\n\n${text}[S2]。`;
        const result = applyReadWeaveSourceSupport(body, [claim(text), claim(text, ["S2"], "C2")], [
            source(otherTitle, otherDoi), source(title, otherDoi, "S2")
        ]);
        expect(result.body.split("\n\n")[0]).toContain("尚无法确认");
        expect(result.body.split("\n\n")[0]).not.toContain("[S1]");
        expect(result.body.endsWith(`${text}[S2]。`)).toBe(true);
    });

    it("does not remove a larger assertion's citation using partial raw claim metadata", () => {
        const body = "高斯过程由均值函数和核函数完全刻画[S1]。";
        expect(applyReadWeaveSourceSupport(body, [claim("核函数完全刻画")], [source()]).body).toBe(body);
    });

    it("supports an exact title/DOI association without claiming general entailment", () => {
        const body = bibliographic();
        const result = applyReadWeaveSourceSupport(body, [claim(body)], [source()]);
        expect(result.body).toBe(body);
        expect(result.claims[0]).toMatchObject({ sourceIds: ["S1"], unresolved: false });
        expect(result.checks[0]).toMatchObject({ status: "metadata-supported", reason: "exact-title-doi" });
    });

    it("retains technical prose but cannot resolve its support from title/DOI metadata", () => {
        const input = claim(technical);
        const result = applyReadWeaveSourceSupport(technical, [input], [source()]);
        expect(result.body).toBe(technical);
        expect(result.claims[0]).toMatchObject({ text: technical, sourceIds: [], unresolved: true, status: "not-checked" });
        expect(result.checks[0]).toMatchObject({ status: "unsupported", reason: "metadata-only" });
        expect(input).toEqual(claim(technical));
    });

    it("removes only the rejected inline citation at its claim, preserving opaque and unrelated copies", () => {
        const text = `${technical}[S1][S2]`;
        const body = `\`${text}\`\n\n${text}。\n\n其他陈述[S1]。`;
        const result = applyReadWeaveSourceSupport(body, [claim(technical, ["S1", "S2"])], [
            source(), source(title, doi, "S2", "A substantive passage needs semantic verification.")
        ]);
        expect(result.body).toBe(`\`${text}\`\n\n${technical}[S2]。\n\n其他陈述[S1]。`);
        expect(result.claims[0].sourceIds).toEqual(["S2"]);
    });

    it("also removes a rejected inline marker already included in raw claim text", () => {
        const text = `${technical}[S1]`;
        const result = applyReadWeaveSourceSupport(text, [claim(text)], [source()]);
        expect(result.body).toBe(technical);
        expect(result.claims[0].text).toBe(technical);
    });

    it("bounds only the wrong-paper association and preserves sibling answers", () => {
        const wrong = bibliographic(title, otherDoi);
        const body = `🧭 已知条件。\r\n\r\n${wrong}。\r\n\r\n${technical}。`;
        const result = applyReadWeaveSourceSupport(body, [claim(wrong), claim(technical, [], "C2")], [source(otherTitle, otherDoi)]);
        expect(result.body).toBe(`🧭 已知条件。\r\n\r\n论文《${title}》的 DOI 尚无法确认；现有来源未确认该题名与此标识符的对应关系。\r\n\r\n${technical}。`);
        expect(result.claims[0]).toMatchObject({ unresolved: true, status: "not-checked", sourceIds: [] });
        expect(result.claims[0].text).not.toContain(otherDoi);
        expect(result.claims[1]).toEqual(claim(technical, [], "C2"));
        expect(result.checks[0].reason).toBe("bibliographic-binding-mismatch");
        expect(applyReadWeaveSourceSupport(result.body, result.claims, [source(otherTitle, otherDoi)]).body).toBe(result.body);
    });

    it.each([
        (value: string) => `“${value}”`, (value: string) => `\`${value}\``,
        (value: string) => `\`\`\`text\n${value}\n\`\`\``, (value: string) => `> ${value}\n`
    ])("preserves opaque copies of a wrong association while bounding the prose copy", opaque => {
        const wrong = bibliographic(title, otherDoi);
        const protectedText = opaque(wrong);
        const body = `${protectedText}\n\n${wrong}。\n\n${protectedText}`;
        const result = applyReadWeaveSourceSupport(body, [claim(wrong)], [source(otherTitle, otherDoi)]);
        expect(result.body.startsWith(`${protectedText}\n\n论文《${title}》的 DOI 尚无法确认`)).toBe(true);
        expect(result.body.endsWith(`\n\n${protectedText}`)).toBe(true);
    });

    it("keeps a quoted title intact while changing only its prose binding", () => {
        const text = `Paper "${title}" DOI is ${otherDoi}`;
        const result = applyReadWeaveSourceSupport(text, [claim(text)], [source(otherTitle, otherDoi)]);
        expect(result.body).toBe(`Paper "${title}" DOI could not be confirmed; the cited record does not establish this title–identifier association`);
    });

    it.each([
        technical,
        "A Gaussian process is determined by a mean function and covariance kernel.",
        "Short but substantive evidence.",
        "Publisher metadata; DOI 10.5555/example.inference; The experiment tests a technical mechanism."
    ])("does not reject substantive evidence using length or keyword overlap: %s", excerpt => {
        const input = claim(technical);
        const result = applyReadWeaveSourceSupport(technical, [input], [source(title, doi, "S1", excerpt)]);
        expect(result.body).toBe(technical);
        expect(result.claims[0]).toEqual(input);
        expect(result.checks[0]).toMatchObject({ status: "not-checked", reason: "semantic-support-not-checked" });
    });

    it("does not let an invalid metadata link erase a possibly supporting substantive source", () => {
        const text = bibliographic(title, otherDoi);
        const result = applyReadWeaveSourceSupport(text, [claim(text, ["S1", "S2"])], [
            source(otherTitle, otherDoi), source(title, otherDoi, "S2", "This full-text passage requires contextual verification.")
        ]);
        expect(result.body).toBe(text);
        expect(result.claims[0]).toMatchObject({ sourceIds: ["S2"], unresolved: true });
    });

    it("removes a bad record but preserves an exact independently supported association", () => {
        const text = bibliographic();
        const result = applyReadWeaveSourceSupport(text, [claim(text, ["S1", "S2"])], [
            source(otherTitle, doi), source(title, doi, "S2")
        ]);
        expect(result.body).toBe(text);
        expect(result.claims[0]).toMatchObject({ sourceIds: ["S2"], unresolved: false });
    });

    it("checks the DOI value as well as the paper title", () => {
        const text = bibliographic(title, otherDoi);
        expect(inspectReadWeaveSourceSupport([claim(text)], [source()])[0])
            .toMatchObject({ status: "unsupported", reason: "bibliographic-binding-mismatch" });
    });

    it("does not resolve an added mechanism merely because the same claim includes a correct DOI", () => {
        const text = `${bibliographic()}；${technical}`;
        const result = applyReadWeaveSourceSupport(text, [claim(text)], [source()]);
        expect(result.body).toBe(text);
        expect(result.claims[0].unresolved).toBe(true);
        expect(result.checks[0].reason).toBe("metadata-only");
    });

    it("normalizes harmless title punctuation and DOI case, not substantive title differences", () => {
        const text = bibliographic(title.toUpperCase(), doi.toUpperCase());
        expect(inspectReadWeaveSourceSupport([claim(text)], [source()])[0].status).toBe("metadata-supported");
        expect(inspectReadWeaveSourceSupport([claim(bibliographic(`${title} extended`, doi))], [source()])[0].status).toBe("unsupported");
    });

    it("leaves already qualified associations alone", () => {
        const text = `无法确认${bibliographic(title, otherDoi)}`;
        expect(applyReadWeaveSourceSupport(text, [claim(text)], [source(otherTitle, otherDoi)]).body).toBe(text);
    });

    it("does not promote unchecked authorship metadata to verified support", () => {
        const text = "该论文作者为顾清禾";
        expect(inspectReadWeaveSourceSupport([claim(text)], [source()])[0].status).toBe("not-checked");
    });

    it("marks missing sources unresolved without discarding the answer", () => {
        const result = applyReadWeaveSourceSupport(technical, [claim(technical)], []);
        expect(result.body).toBe(technical);
        expect(result.claims[0]).toMatchObject({ sourceIds: [], unresolved: true });
        expect(result.checks[0].reason).toBe("source-unavailable");
    });
});
