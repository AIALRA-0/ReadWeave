import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { applyReadWeaveClaimBoundaries, applyReadWeaveClaimPatch, readWeaveClaimBoundaryTargets } from "./readweave_claim_boundaries.js";

const role = "顾清禾目前任职于星原研究院";
const claim = (text: string, sourceIds: unknown = []) => ({ text, sourceIds });
const source = (sourceId: string, excerpt = "已接纳的来源内容", sourceType: "local" | "external" = "external"): ReadWeaveEvidenceSource => ({
    sourceId, sourceType, provider: "fixture", title: "来源", excerpt, accessedAt: "2026-09-15T00:00:00Z"
});

describe("time-sensitive claim boundaries", () => {
    it.each([
        [ role, "任职" ],
        [ "顾清禾目前是星原研究院院长", "任职" ],
        [ "顾清禾目前在星原研究院工作", "任职" ],
        [ "Orbit 当前版本为 3.2.1", "版本" ],
        [ "Orbit 最新稳定版是 4.1", "版本" ],
        [ "星舟目前售价为199元", "价格" ],
        [ "星舟目前售价为1,299元", "价格" ],
        [ "星舟当前用户数为120万", "用户数" ],
        [ "星舟目前市场份额为20%", "市场份额" ],
        [ "Mira currently works at Star Institute", "任职" ],
        [ "Orbit current version is 3.2.1", "版本" ],
        [ "Orbit current price is $29", "价格" ]
    ])("finds an uncited positive assertion: %s", (text, reason) => {
        const targets = readWeaveClaimBoundaryTargets(`${text}。`, [ claim(text, [ "S1" ]) ], []);
        expect(targets).toEqual([ { original: text, reason: expect.stringContaining(reason) } ]);
        expect(targets[0].reason).toContain("ID 未被接纳");
    });

    it.each([ undefined, null, {}, "bad claims", [ null, {}, { text: 42 } ], [ claim(role, "S1") ] ])(
        "handles raw unknown claims without trusting their shape: %j", raw => {
            expect(readWeaveClaimBoundaryTargets(`${role}。`, raw, [])).toEqual([
                { original: role, reason: expect.stringContaining("缺少") }
            ]);
        }
    );

    it.each([
        "二叉树是每个节点最多有两个子节点的树结构",
        "HTTP 是应用层协议",
        "当前问题是如何理解二叉树",
        "当前问题涉及版本3.2的语法",
        "目前没有证据证明顾清禾任职于星原研究院",
        "顾清禾目前并非星原研究院的研究员",
        "顾清禾目前不在星原研究院工作",
        "顾清禾目前可能任职于星原研究院",
        "顾清禾目前任职于哪家机构？",
        "星舟当前价格不是199元",
        "星舟当前价格未知",
        "如果星舟目前售价为199元，则需要重新计算预算",
        "Orbit current version might be 3.2.1",
        "Mira does not currently work at Star Institute"
    ])("leaves stable knowledge and non-assertions unchanged: %s", text => {
        expect(readWeaveClaimBoundaryTargets(text, [ claim(text) ], [])).toEqual([]);
        expect(applyReadWeaveClaimBoundaries(text, [ claim(text) ], [])).toBe(text);
    });

    it.each([
        `尚无法确认${role}。`,
        `如果资料属实，${role}。`,
        `目前没有证据证明${role}。`,
        `${role}（待核实）。`,
        `${role}，前提是所述资料属实。`
    ])("respects qualifications around an exact raw claim: %s", body => {
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [])).toEqual([]);
        expect(applyReadWeaveClaimBoundaries(body, [ claim(role) ], [])).toBe(body);
    });

    it("does not let uncertainty in a sibling sentence exempt a positive assertion", () => {
        const body = `无法确认历史职位，但${role}。`;
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [])).toHaveLength(1);
    });

    it("uses admitted citation IDs, not the existence of unrelated sources", () => {
        expect(readWeaveClaimBoundaryTargets(role, [ claim(role, [ "S1" ]) ], [ source("S2") ])).toHaveLength(1);
        expect(readWeaveClaimBoundaryTargets(role, [ claim(role, [ "S1" ]) ], [ source("S1", role) ])).toEqual([]);
        expect(readWeaveClaimBoundaryTargets(role, [ claim(role, [ "S1", "missing" ]) ], [ source("S1", role) ])).toEqual([]);
    });

    it("cannot certify the contents or freshness of a valid citation", () => {
        const sources = [ source("S1", "This citation's contents have not been checked here.") ];
        expect(readWeaveClaimBoundaryTargets(role, [ claim(role, [ "S1" ]) ], sources)).toEqual([]);
    });

    it.each([
        `没有证据证明${role}。`,
        "尚无证据确认顾清禾任职于星原研究院。",
        "顾清禾目前不任职于星原研究院。",
        "顾清禾目前并未任职于星原研究院。"
    ])("does not treat an admitted negative snippet as positive evidence: %s", excerpt => {
        const raw = [ claim(role, [ "S1" ]) ];
        const sources = [ source("S1", excerpt) ];
        expect(readWeaveClaimBoundaryTargets(role, raw, sources)).toEqual([
            { original: role, reason: expect.stringContaining("明确否定或未证实") }
        ]);
        const body = `稳定的一般知识。\r\n\r\n${role}。\r\n\r\n另一段内容  保持原样。`;
        expect(applyReadWeaveClaimBoundaries(body, raw, sources)).toBe(body.replace(role,
            "尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告"));
    });

    it("does not invalidate a cited assertion because the snippet negates an unrelated fact", () => {
        const sources = [ source("S1", `${role}，没有提供出生日期。`) ];
        expect(applyReadWeaveClaimBoundaries(role, [ claim(role, [ "S1" ]) ], sources)).toBe(role);
    });

    it("does not use a negative local snippet to exempt an article-scoped assertion", () => {
        const body = `文章在2020年记载，${role}。`;
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [ source("L1", `没有证据证明${role}`, "local") ])).toHaveLength(1);
    });

    it("recognizes a citation attached to the exact assertion in the body", () => {
        const body = `${role}[S1]。`;
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [ source("S1") ])).toEqual([]);
        expect(readWeaveClaimBoundaryTargets(body, [ claim(`${role}[S1]`) ], [ source("S1") ])).toEqual([]);
        expect(readWeaveClaimBoundaryTargets(body, [], [])).toHaveLength(1);
    });

    it("leaves an article-scoped historical statement when local evidence actually matches", () => {
        const body = `文章在2020年记载，${role}。`;
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [ source("L1", role, "local") ])).toEqual([]);
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [ source("L1", "无关内容", "local") ])).toHaveLength(1);
        expect(readWeaveClaimBoundaryTargets(role, [ claim(role) ], [ source("L1", role, "local") ])).toHaveLength(1);
    });

    it("does not trust raw unresolved or low-confidence labels over an unqualified writer assertion", () => {
        expect(readWeaveClaimBoundaryTargets(role, [ { ...claim(role), unresolved: true, confidence: "low" } ], [])).toHaveLength(1);
    });

    it.each([ "顾清禾", "顾清禾目前", "星原研究院" ])(
        "scans the full assertion when raw metadata only contains %s", partial => {
            const body = `稳定定义。\r\n\r\n${role}。\r\n\r\n其他段落  保持原样。`;
            const raw = [ claim(partial, [ "S1" ]) ];
            const sources = [ source("S1", partial) ];
            expect(readWeaveClaimBoundaryTargets(body, raw, sources)).toEqual([
                { original: role, reason: expect.stringContaining("缺少") }
            ]);
            expect(applyReadWeaveClaimBoundaries(body, raw, sources)).toBe(body.replace(role,
                "尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告"));
        }
    );

    it("does not let a harmless cited substring hide an uncited full raw assertion", () => {
        const raw = [ claim("顾清禾", [ "S1" ]), claim(role) ];
        expect(readWeaveClaimBoundaryTargets(role, raw, [ source("S1", "顾清禾") ])).toHaveLength(1);
        expect(readWeaveClaimBoundaryTargets(role, [ ...raw, claim(role, [ "S2" ]) ], [ source("S1"), source("S2") ])).toEqual([]);
    });

    it("does not apply a prefix citation to the complete value", () => {
        const body = "Orbit 当前版本为 3.2.1";
        const raw = [ claim("Orbit 当前版本为 3", [ "S1" ]) ];
        expect(readWeaveClaimBoundaryTargets(body, raw, [ source("S1") ])).toEqual([
            { original: body, reason: expect.stringContaining("缺少") }
        ]);
    });

    it("does not apply a cited predicate fragment to a full subject assertion", () => {
        const raw = [ claim("目前任职于星原研究院", [ "S1" ]) ];
        expect(readWeaveClaimBoundaryTargets(role, raw, [ source("S1") ])).toEqual([
            { original: role, reason: expect.stringContaining("缺少") }
        ]);
    });

    it("does not apply an inline citation on a name to the surrounding assertion", () => {
        const body = "顾清禾[S1]目前任职于星原研究院";
        expect(readWeaveClaimBoundaryTargets(body, [ claim("顾清禾", [ "S1" ]) ], [ source("S1") ])).toEqual([
            { original: body, reason: expect.stringContaining("缺少") }
        ]);
    });

    it("scans an uncovered assertion after a separate cited assertion in the same clause", () => {
        const valid = "Orbit 当前版本为 3.2.1";
        const body = `${valid}且${role}。`;
        const raw = [ claim(valid, [ "S1" ]), claim("顾清禾", [ "S1" ]) ];
        expect(readWeaveClaimBoundaryTargets(body, raw, [ source("S1") ])).toEqual([
            { original: role, reason: expect.stringContaining("缺少") }
        ]);
        expect(applyReadWeaveClaimBoundaries(body, raw, [ source("S1") ])).toBe(body.replace(role,
            "尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告"));
    });

    it.each([
        `目前没有证据证明${role}。`,
        `如果资料属实，${role}。`,
        "顾清禾目前不任职于星原研究院。",
        `\`${role}\``, `\`\`\`text\n${role}\n\`\`\``, `“${role}”`, `$\\text{${role}}$`
    ])("preserves negation and opaque content with partial raw claims: %s", body => {
        const raw = [ claim("顾清禾", [ "S1" ]) ];
        expect(readWeaveClaimBoundaryTargets(body, raw, [ source("S1") ])).toEqual([]);
        expect(applyReadWeaveClaimBoundaries(body, raw, [ source("S1") ])).toBe(body);
    });

    it("bounds only the exact unresolved span and retains the subject without asserting the invented role", () => {
        const stable = "二叉树是每个节点最多有两个子节点的树结构。";
        const valid = "Orbit 当前版本为 3.2.1";
        const body = `# 回答\r\n\r\n${stable}\r\n\r\n${role}。\r\n\r\n${valid}。\r\n\r\n结尾  保留。`;
        const raw = [ claim(role, [ "S1" ]), claim(valid, [ "S2" ]) ];
        const bounded = applyReadWeaveClaimBoundaries(body, raw, [ source("S2", valid) ]);
        const replacement = "尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告";
        expect(bounded).toBe(body.replace(role, replacement));
        expect(bounded).not.toContain("星原研究院");
        expect(bounded).not.toContain("目前任职于");
        expect(applyReadWeaveClaimBoundaries(bounded, raw, [ source("S2", valid) ])).toBe(bounded);
    });

    it("preserves a stable sibling even inside the same clause", () => {
        const body = `${role}且二叉树最多有两个子节点。`;
        const bounded = applyReadWeaveClaimBoundaries(body, [ claim(role) ], []);
        expect(bounded.endsWith("且二叉树最多有两个子节点。")).toBe(true);
        expect(bounded).not.toContain(role);
    });

    it.each([
        [ "3M 当前版本为 3.2.1", "3M的当前版本", "官方发布记录", "3.2.1" ],
        [ "星舟目前售价为1,299元", "星舟的当前价格", "币种与计价时间", "1,299" ],
        [ "星舟当前用户数为120万", "星舟的当前用户数", "统计时间与口径", "120万" ]
    ])("bounds a specific property with a useful next step: %s", (text, scope, next, fabricatedValue) => {
        const bounded = applyReadWeaveClaimBoundaries(`${text}。`, [ claim(text) ], []);
        expect(bounded).toContain(scope);
        expect(bounded).toContain(next);
        expect(bounded).not.toContain(fabricatedValue);
    });

    it("does not replace a cited specific claim due to an overlapping broad uncited record", () => {
        const broad = `${role}且二叉树最多有两个子节点`;
        const raw = [ claim(broad), claim(role, [ "S1" ]) ];
        expect(applyReadWeaveClaimBoundaries(broad, raw, [ source("S1", role) ])).toBe(broad);
    });

    it("keeps adjacent English sentences when raw claim metadata is missing", () => {
        const original = "Mira currently works at Star Institute";
        const body = `Earlier roles are unknown. ${original}. Binary trees have at most two children per node.`;
        expect(readWeaveClaimBoundaryTargets(body, null, [])).toEqual([
            { original, reason: expect.any(String) }
        ]);
        expect(applyReadWeaveClaimBoundaries(body, null, [])).toBe(body.replace(original,
            "The current role of Mira could not be verified; check a recent official profile or appointment notice"));
    });

    it("rechecks model repairs rather than applying old targets", () => {
        const raw = [ claim(role, [ "S1" ]) ];
        expect(readWeaveClaimBoundaryTargets(role, raw, [])).toHaveLength(1);
        expect(applyReadWeaveClaimBoundaries(role, raw, [])).not.toContain(role);
        const repaired = "尚无法核实顾清禾的当前任职信息，可查阅近期任职公告。";
        expect(applyReadWeaveClaimBoundaries(repaired, raw, [])).toBe(repaired);
        expect(applyReadWeaveClaimBoundaries(role, raw, [ source("S1", role) ])).toBe(role);
    });

    it.each([
        `“${role}”`, `"${role}"`, `\`${role}\``,
        `\`\`\`text\n${role}\n\`\`\``, `> ${role}\n`,
        `$\\text{${role}}$`, `\\(${role}\\)`,
        `| 原句 |\n| --- |\n| ${role} |`
    ])("protects quoted and opaque content: %s", body => {
        expect(readWeaveClaimBoundaryTargets(body, [ claim(role) ], [])).toEqual([]);
        expect(applyReadWeaveClaimBoundaries(body, [ claim(role) ], [])).toBe(body);
    });

    it("changes only the prose occurrence when identical text also appears in a quote or formula", () => {
        const body = `“${role}”\n\n${role}。\n\n$\\text{${role}}$`;
        const bounded = applyReadWeaveClaimBoundaries(body, [ claim(role) ], []);
        expect(bounded).toBe(`“${role}”\n\n尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告。\n\n$\\text{${role}}$`);
    });

    it.each([
        `“${role}”`, `"${role}"`, `\`${role}\``,
        `\`\`\`text\r\n${role}\r\n\`\`\``, `> ${role}\r\n`,
        `$\\text{${role}}$`, `\\(${role}\\)`,
        `| 原句 |\r\n| --- |\r\n| ${role} |`
    ])("patches identical prose but preserves opaque bytes: %s", opaque => {
        const body = `${opaque}\r\n\r\n${role}。\r\n\r\n${opaque}\r\n\r\n${role}。`;
        const replacement = "尚无法核实顾清禾的当前任职信息";
        expect(applyReadWeaveClaimPatch(body, role, replacement)).toBe(
            `${opaque}\r\n\r\n${replacement}。\r\n\r\n${opaque}\r\n\r\n${replacement}。`
        );
        const fallback = "尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告";
        expect(applyReadWeaveClaimBoundaries(body, [ claim(role) ], [])).toBe(
            `${opaque}\r\n\r\n${fallback}。\r\n\r\n${opaque}\r\n\r\n${fallback}。`
        );
    });

    it("patches only the unresolved occurrence, not identical qualified or cited prose", () => {
        const body = `尚无法确认${role}。\n\n${role}[S1]。\n\n${role}。\n\n如果资料属实，${role}。`;
        const replacement = "该任职信息尚未核实";
        const raw = [ claim(role) ];
        const sources = [ source("S1", role) ];
        expect(applyReadWeaveClaimPatch(body, role, replacement, raw, sources)).toBe(
            `尚无法确认${role}。\n\n${role}[S1]。\n\n${replacement}。\n\n如果资料属实，${role}。`
        );
        expect(applyReadWeaveClaimBoundaries(body, raw, sources)).toBe(
            `尚无法确认${role}。\n\n${role}[S1]。\n\n尚无法核实顾清禾的当前任职信息；可查阅近期官方人员页面或任职公告。\n\n如果资料属实，${role}。`
        );
    });

    it("does not patch a substring, stale original, opaque-only match or newly supported assertion", () => {
        const body = `${role}。`;
        expect(applyReadWeaveClaimPatch(body, "顾清禾", "其他人")).toBe(body);
        expect(applyReadWeaveClaimPatch(body, "不存在的断言", "其他内容")).toBe(body);
        expect(applyReadWeaveClaimPatch(body, "", "其他内容")).toBe(body);
        const quoted = `“${role}”`;
        expect(applyReadWeaveClaimPatch(quoted, role, "其他内容")).toBe(quoted);
        expect(applyReadWeaveClaimPatch(body, role, "其他内容", [ claim(role, [ "S1" ]) ], [ source("S1", role) ])).toBe(body);
    });

    it("recomputes spans for sequential patches and preserves CRLF, Unicode and siblings", () => {
        const version = "Orbit 当前版本为 3.2.1";
        const raw = [ claim(role), claim(version) ];
        const body = `🧭 稳定事实。\r\n\r\n\`${role}\`\r\n\r\n${role}且二叉树最多有两个子节点。\r\n\r\n${version}。`;
        const first = applyReadWeaveClaimPatch(body, role, "任职尚未核实", raw, []);
        expect(applyReadWeaveClaimPatch(first, version, "版本尚未核实", raw, [])).toBe(
            `🧭 稳定事实。\r\n\r\n\`${role}\`\r\n\r\n任职尚未核实且二叉树最多有两个子节点。\r\n\r\n版本尚未核实。`
        );
        expect(applyReadWeaveClaimPatch(first, role, "任职尚未核实", raw, [])).toBe(first);
    });

    it("inserts replacement text literally, without recursively patching inserted matches", () => {
        const replacement = `据称${role} $& $1`;
        expect(applyReadWeaveClaimPatch(`${role}。\n\n${role}。`, role, replacement))
            .toBe(`${replacement}。\n\n${replacement}。`);
    });
});
