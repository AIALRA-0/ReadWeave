import fs from "node:fs";
import path from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import App from "./support/app";

test.describe.configure({ retries: 0 });

interface TestEditor {
    editing: {
        view: { domConverter: { domRangeToView: (range: Range) => unknown } };
        mapper: { toModelRange: (range: unknown) => unknown };
    };
    model: { change: (callback: (writer: { setSelection: (range: unknown) => void }) => void) => void };
}

interface TestAppWindow extends Window {
    glob: {
        appContext: {
            tabManager: {
                getActiveContext: () => { getTextEditor: () => Promise<TestEditor> };
            };
        };
    };
}

async function selectTextRange(page: Page, paragraph: Locator, selectedText: string) {
    await expect(paragraph).toBeVisible({ timeout: 15_000 });
    await paragraph.evaluate(async (element, text) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode: Text | null = null;
        let start = -1;
        while (walker.nextNode()) {
            const candidate = walker.currentNode as Text;
            const index = candidate.data.indexOf(text);
            if (index >= 0) {
                textNode = candidate;
                start = index;
                break;
            }
        }
        if (!textNode) throw new Error(`Could not find selected text: ${text}`);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + text.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        const noteContext = (window as unknown as TestAppWindow).glob.appContext.tabManager.getActiveContext();
        const editor = await noteContext.getTextEditor();
        const viewRange = editor.editing.view.domConverter.domRangeToView(range);
        const modelRange = editor.editing.mapper.toModelRange(viewRange);
        editor.model.change(writer => writer.setSelection(modelRange));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: range.getBoundingClientRect().right, clientY: range.getBoundingClientRect().top }));
    }, selectedText);
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
}

async function createTextNote(app: App, title: string, body: string) {
    await app.addNewTab();
    const autocomplete = app.currentNoteSplit.locator(".note-autocomplete");
    await expect(autocomplete).toBeVisible();
    const results = app.currentNoteSplit.locator(".note-detail-empty-results");
    const createSuggestion = results.locator(".aa-suggestion", { hasText: title }).first();
    await expect(async () => {
        await autocomplete.fill("");
        await autocomplete.fill(title);
        await expect(createSuggestion).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await createSuggestion.click();
    const noteTypeDialog = app.page.locator(".note-type-chooser-dialog");
    await expect(noteTypeDialog).toBeVisible();
    await noteTypeDialog.locator('.dropdown-item[data-value="text,"]').click();

    // The empty-tab editor can remain visible briefly while the newly created note
    // becomes active. Wait for the title first so we never fill the stale editor.
    await expect(app.currentNoteSplitTitle).toHaveValue(title, { timeout: 15_000 });
    const editor = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
    await expect(editor.locator("p").first()).toBeVisible({ timeout: 15_000 });
    const firstBodyLine = body.split("\n", 1)[0];
    await expect(async () => {
        await editor.focus();
        await editor.fill(body);
        if (!(await editor.innerText()).includes(firstBodyLine)) {
            await editor.focus();
            await app.page.keyboard.press("ControlOrMeta+A");
            await app.page.keyboard.insertText(body);
        }
        await expect(editor).toContainText(firstBodyLine, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    return editor;
}

function uniqueTitle(prefix: string): string {
    return `${prefix} · ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openSelectionEditor(page: Page, app: App, paragraph: Locator, excerpt: string, action: "Ask" | "Define") {
    await selectTextRange(page, paragraph, excerpt);
    await page.locator(".readweave-selection-actions").getByRole("button", { name: action, exact: true }).click();
    const panel = app.sidebar.locator("#readweave-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".readweave-selection")).toContainText(excerpt);
    return panel;
}

function professionalAnswer(conclusion: string): string {
    return `${[
        `定义与命名：${conclusion}`,
        "底层构造：由可验证的输入、处理部件与输出路径共同构成",
        "层次关系：对象按整体与部分、主用与备用及上下游关系组织",
        "参数配置：只采用资料明确给出的开关、阈值、地址与默认值",
        "行为语义：正常、异常、切换与恢复状态分别具有可观察结果",
        "测试判据：固定输入与环境后比较实际状态和预期结果",
        "数字推导：资料没有给出可验证数字，因此不能进行数字推导",
        "实现选择与证据闭环：最终选择由资料证据、机制解释与测试结果共同支持"
    ].join("；")  }；`;
}

test("ReadWeave completes range anchoring, reviewed Q&A, term definition, reuse, editing, hover and export", async ({ page, context }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(7_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const app = new App(page, context);
    await app.goto();

    const paragraphText = "NPU 用于加速神经网络中的矩阵和张量运算，能够提高推理效率。";
    const secondParagraphText = "第二段用于验证每个锚点拥有独立草稿。";
    const editor = await createTextNote(
        app,
        uniqueTitle("ReadWeave E2E · Core workflow"),
        `${paragraphText}\n\n${secondParagraphText}`
    );
    const paragraph = editor.locator("p", { hasText: paragraphText });

    await selectTextRange(page, paragraph, "NPU");
    await page.mouse.move(5, 5);
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
    await page.locator(".readweave-selection-actions").getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("#readweave-panel")).toBeVisible();
    expect(pageErrors).toEqual([]);

    const panel = app.sidebar.locator("#readweave-panel");
    const undecoratedAnchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(undecoratedAnchor).not.toHaveClass(/readweave-range-anchor/);
    await expect(panel).toContainText("Selected text anchor");
    await expect(panel.locator(".readweave-selection")).toContainText("NPU");
    const questionKind = panel.getByRole("button", { name: "Question", exact: true });
    const termKind = panel.getByRole("button", { name: "Term", exact: true });
    expect(await questionKind.evaluate(element => getComputedStyle(element).color)).toBe(await termKind.evaluate(element => getComputedStyle(element).color));
    const noteCallout = panel.getByRole("button", { name: "Note", exact: true });
    const tipCallout = panel.getByRole("button", { name: "Tip", exact: true });
    const importantCallout = panel.getByRole("button", { name: "Important", exact: true });
    const warningCallout = panel.getByRole("button", { name: "Warning", exact: true });
    const cautionCallout = panel.getByRole("button", { name: "Caution", exact: true });
    await expect(noteCallout).toHaveAttribute("aria-pressed", "true");
    const calloutStyle = (locator: Locator) => locator.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, borderWidth: style.borderTopWidth, color: style.color, outline: style.outlineStyle };
    });
    const inactiveStyles = await Promise.all([ tipCallout, importantCallout, warningCallout, cautionCallout ].map(calloutStyle));
    expect(new Set(inactiveStyles.map(style => JSON.stringify(style))).size).toBe(1);
    const selectedNoteStyle = await calloutStyle(noteCallout);
    expect(selectedNoteStyle.background).not.toBe(inactiveStyles[0].background);
    expect(selectedNoteStyle.borderWidth).toBe("1px");
    expect(selectedNoteStyle.outline).toBe("none");

    const question = panel.getByRole("textbox", { name: "Question", exact: true });
    const answer = panel.getByRole("textbox", { name: "Answer or definition", exact: true }).last();
    await question.fill("NPU 是啥，有啥用？");
    await panel.getByTestId("readweave-optimize-question").check();
    await importantCallout.click();
    await expect(importantCallout).toHaveAttribute("aria-pressed", "true");
    expect(await calloutStyle(noteCallout)).toEqual(await calloutStyle(tipCallout));
    const selectedImportantStyle = await calloutStyle(importantCallout);
    expect(selectedImportantStyle.background).not.toBe((await calloutStyle(tipCallout)).background);
    expect(selectedImportantStyle.borderWidth).toBe("1px");
    expect(selectedImportantStyle.outline).toBe("none");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();

    await expect(question).toHaveValue("NPU 是什么，有什么用途？");
    await expect(answer).toHaveValue(/定义与命名：NPU 神经网络处理单元（Neural Processing Unit）是用于加速神经网络计算的专用处理单元/);
    await expect(answer).toHaveValue(/实现选择与证据闭环：/);
    await expect(answer).not.toHaveValue(/。/);
    await expect(panel).toContainText("The question passed information-preservation optimization.");
    await expect(panel).toContainText("no fallback answer was used");
    await expect(panel.locator(".readweave-generation-progress")).toContainText("全部检查通过");

    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const rangeAnchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(rangeAnchor).toHaveAttribute("data-readweave-question-count", "1");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-callout-important/);
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    const badgeMetrics = await rangeAnchor.evaluate(element => {
        const badge = getComputedStyle(element, "::after");
        const anchor = getComputedStyle(element);
        return {
            display: badge.display,
            badgeFontSize: Number.parseFloat(badge.fontSize),
            anchorFontSize: Number.parseFloat(anchor.fontSize),
            borderWidth: badge.borderTopWidth,
            background: badge.backgroundColor
        };
    });
    expect(badgeMetrics.display).toBe("inline-block");
    expect(badgeMetrics.badgeFontSize).toBeLessThan(badgeMetrics.anchorFontSize);
    expect(badgeMetrics.borderWidth).toBe("0px");
    expect(badgeMetrics.background).toBe("rgba(0, 0, 0, 0)");
    const questionEntry = panel.locator(".readweave-entry", { hasText: "NPU 是什么，有什么用途？" });
    await expect(questionEntry).toHaveClass(/readweave-callout-important/);

    await rangeAnchor.evaluate(element => {
        const textNode = element.firstChild!;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const nativeSelection = window.getSelection()!;
        nativeSelection.removeAllRanges();
        nativeSelection.addRange(range);
    });
    const responseTestParagraph = editor.locator("p", { hasText: secondParagraphText });
    await responseTestParagraph.click();
    await expect(panel.locator(".readweave-selection")).toContainText(secondParagraphText);
    await rangeAnchor.click();
    await expect(panel.locator(".readweave-selection")).toContainText("NPU");

    await rangeAnchor.hover();
    const hoverPreview = page.locator(".readweave-hover-preview");
    await expect(hoverPreview).toBeHidden();
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-hover/);

    await rangeAnchor.click();
    await panel.getByRole("button", { name: "Term", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Tip", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("textbox", { name: "Abbreviation (optional; generated if blank)", exact: true })).toHaveValue("");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "Abbreviation (optional; generated if blank)", exact: true })).toHaveValue("NPU");
    await expect(panel.getByRole("textbox", { name: "Chinese full name (optional; generated if blank)", exact: true })).toHaveValue("神经网络处理单元");
    await expect(panel.getByRole("textbox", { name: "English full name (optional; generated if blank)", exact: true })).toHaveValue("Neural Processing Unit");
    await expect(answer).toHaveValue(/NPU 神经网络处理单元（Neural Processing Unit）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(rangeAnchor).toHaveAttribute("data-readweave-question-count", "1");

    await rangeAnchor.hover();
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-hover/);
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain("underline");
    await expect(hoverPreview).toBeVisible();
    await expect(hoverPreview).toContainText("Term definitions");
    await expect(hoverPreview).toContainText("NPU 神经网络处理单元（Neural Processing Unit）");
    await expect(hoverPreview.locator(".readweave-hover-question")).toHaveCount(0);
    const hoverTerm = hoverPreview.locator(".readweave-hover-term").first();
    await expect(hoverTerm.locator(".readweave-hover-definition")).toBeVisible();
    await expect(hoverTerm).toContainText("当前测试资料所定义的概念");

    await rangeAnchor.click();
    await panel.getByRole("button", { name: "Question", exact: true }).click();
    await question.fill("NPU 是什么，有什么用途？");
    const candidate = panel.locator(".readweave-candidate").first();
    await expect(candidate).toContainText("Reuse");
    await expect(candidate).toContainText("Title similarity 100%");
    expect(await candidate.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("0px");
    await candidate.hover();
    await candidate.getByRole("button", { name: "Use this object", exact: true }).click();
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(rangeAnchor).toHaveAttribute("data-readweave-question-count", "1");

    await questionEntry.hover();
    await questionEntry.getByRole("button", { name: "Edit", exact: true }).click();
    const impact = panel.locator(".readweave-impact");
    await expect(impact).toContainText("This object has 1 links across 1 articles.");
    await impact.locator("textarea").fill(professionalAnswer("这是经过全局审核的直接答案"));
    await impact.getByRole("button", { name: "Warning", exact: true }).click();
    await impact.getByRole("radio", { name: "Update globally", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await expect(questionEntry).toHaveClass(/readweave-callout-warning/);

    await questionEntry.hover();
    await questionEntry.getByRole("button", { name: "Edit", exact: true }).click();
    await impact.locator("textarea").fill(professionalAnswer("这是只在本文显示的直接答案"));
    await impact.getByRole("radio", { name: "Change this display only", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await questionEntry.hover();
    await expect(questionEntry).toContainText("这是只在本文显示的直接答案；");

    await questionEntry.getByRole("button", { name: "Edit", exact: true }).click();
    await impact.locator("textarea").fill(professionalAnswer("这是本文专用变体的直接答案"));
    await impact.getByRole("radio", { name: "Create an article variant", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await questionEntry.hover();
    await expect(questionEntry).toContainText("这是本文专用变体的直接答案；");

    const secondParagraph = editor.locator("p", { hasText: secondParagraphText });
    await selectTextRange(page, secondParagraph, "独立草稿");
    await page.locator(".readweave-selection-actions").getByRole("button", { name: "Ask", exact: true }).click();
    const failedAnchor = secondParagraph.locator("[data-readweave-range-anchor-id]");
    await expect(failedAnchor).not.toHaveClass(/readweave-range-anchor/);
    await question.fill("[FAIL] 验证定点修复错误");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    const generationError = panel.locator(".readweave-status-error[role='alert']");
    await expect(generationError).toContainText("定点修复重试已耗尽");
    await expect(failedAnchor).not.toHaveClass(/readweave-range-anchor/);

    await question.fill("[REVIEW] 验证保留待人工审核草稿");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await expect(panel.locator(".readweave-status-warning")).toContainText("自动检查未确认测试草稿");
    await expect(panel.getByRole("button", { name: "I reviewed it — save", exact: true })).toBeEnabled();

    const downloadPromise = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export this article's question-anchor index", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("readweave-index.json");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const schema = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../../docs/readlayer/schemas/readweave-index-export.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv as unknown as Parameters<typeof addFormats>[0]);
    const validate = ajv.compile(schema);
    expect(validate(exported), JSON.stringify(validate.errors)).toBe(true);
    expect(exported).toMatchObject({
        schemaVersion: "1.1",
        generator: { name: "ReadWeave", workflowVersion: "context-v2-no-fallback" },
        scope: { type: "articles", articleIds: [ expect.any(String) ], includeContent: true },
        anchors: [ { selector: { type: "readweave-range-v1", quote: "NPU" } } ],
        integrity: { valid: true, articleCount: 1, anchorCount: 1, objectCount: 2, linkCount: 2 }
    });
    expect(exported.integrity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
});

test("ReadWeave splits a Tip subrange from its Note anchor and uses hover without requiring clicks", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await app.goto();

    const source = "默认只运行龙猫，备选链路包括 WARP 与 Hiddify。";
    const editor = await createTextNote(
        app,
        uniqueTitle("ReadWeave E2E · Split anchors"),
        source
    );
    const paragraph = editor.locator("p", { hasText: source });
    const panel = await openSelectionEditor(page, app, paragraph, source, "Ask");
    const question = panel.getByRole("textbox", { name: "Question", exact: true });
    const answer = panel.getByRole("textbox", { name: "Answer or definition", exact: true }).last();
    await question.fill("为什么默认只运行龙猫，还有哪些备选链路？");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();

    const originalAnchor = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: source });
    await expect(originalAnchor).toHaveClass(/readweave-anchor-callout-note/);
    await originalAnchor.hover();
    await expect(originalAnchor).toHaveClass(/readweave-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();

    await openSelectionEditor(page, app, paragraph, "WARP", "Define");
    await panel.getByRole("textbox", { name: "Chinese full name (optional; generated if blank)", exact: true }).fill("应急网络服务");
    await panel.getByRole("textbox", { name: "English full name (optional; generated if blank)", exact: true }).fill("WARP");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/应急网络服务（WARP）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();

    const tipAnchor = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "WARP" });
    const notePrefix = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "默认只运行龙猫" });
    const noteSuffix = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "与 Hiddify" });
    await expect(tipAnchor).toHaveClass(/readweave-anchor-callout-tip/);
    await expect(notePrefix).toHaveClass(/readweave-anchor-callout-note/);
    await expect(noteSuffix).toHaveClass(/readweave-anchor-callout-note/);
    await expect(noteSuffix).toHaveAttribute("data-readweave-question-count", "1");

    await notePrefix.hover();
    await expect(notePrefix).toHaveClass(/readweave-anchor-hover/);
    await expect(noteSuffix).toHaveClass(/readweave-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();

    await tipAnchor.hover();
    await expect(tipAnchor).toHaveClass(/readweave-anchor-hover/);
    await expect(notePrefix).not.toHaveClass(/readweave-anchor-hover/);
    await expect(noteSuffix).not.toHaveClass(/readweave-anchor-hover/);
    const preview = page.locator(".readweave-hover-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("应急网络服务（WARP）");

    await page.mouse.move(5, 5);
    await expect(preview).toBeHidden();
    await expect(paragraph.locator(".readweave-anchor-hover")).toHaveCount(0);
});

test("ReadWeave handles diverse source articles and keeps cross-article term references synchronized", async ({ page, context }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(8_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const app = new App(page, context);
    await app.goto();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rfcTitle = `ReadWeave E2E · RFC 9000 技术标准 · ${runId}`;
    const rfcBody = [
        "来源：https://www.rfc-editor.org/rfc/rfc9000.html",
        "QUIC is a secure transport protocol that carries packets in UDP datagrams and integrates TLS into its handshake.",
        "Independent streams can continue making progress when loss blocks data belonging to a different stream."
    ].join("\n\n");
    const rfcEditor = await createTextNote(app, rfcTitle, rfcBody);
    const rfcParagraph = rfcEditor.locator("p", { hasText: "QUIC is a secure transport protocol" });
    let panel = await openSelectionEditor(page, app, rfcParagraph, "QUIC", "Ask");
    const question = panel.getByRole("textbox", { name: "Question", exact: true });
    const answer = panel.getByRole("textbox", { name: "Answer or definition", exact: true }).last();
    await question.fill("Why does QUIC use UDP, how is TLS involved, and what happens to unrelated streams after packet loss?");
    await panel.getByTestId("readweave-optimize-question").check();
    await panel.getByRole("button", { name: "Warning", exact: true }).click();
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await expect(answer).toHaveValue(/实现选择与证据闭环：/);
    await expect(panel.locator(".readweave-generation-progress")).toContainText("全部检查通过");
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const quicAnchor = rfcParagraph.locator("[data-readweave-range-anchor-id]");
    await expect(quicAnchor).toHaveAttribute("data-readweave-question-count", "1");
    await quicAnchor.hover();
    await expect(quicAnchor).toHaveClass(/readweave-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();
    await page.mouse.move(5, 5);
    await expect.poll(() => quicAnchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe("none");

    const nasaTitle = `ReadWeave E2E · NASA 凌日法科普 · ${runId}`;
    const nasaBody = [
        "来源：https://science.nasa.gov/exoplanets/whats-a-transit/",
        "The transit method detects an exoplanet when the planet passes in front of its star and produces a measurable dip in brightness.",
        "TESS surveys large areas of the sky and records repeated brightness changes for follow-up analysis."
    ].join("\n\n");
    const nasaEditor = await createTextNote(app, nasaTitle, nasaBody);
    const tessParagraph = nasaEditor.locator("p", { hasText: "TESS surveys large areas" });
    panel = await openSelectionEditor(page, app, tessParagraph, "TESS", "Define");
    const abbreviation = panel.getByRole("textbox", { name: "Abbreviation (optional; generated if blank)", exact: true });
    const chineseName = panel.getByRole("textbox", { name: "Chinese full name (optional; generated if blank)", exact: true });
    const englishName = panel.getByRole("textbox", { name: "English full name (optional; generated if blank)", exact: true });
    await abbreviation.fill("TESS");
    await chineseName.fill("凌日系外行星巡天卫星");
    await englishName.fill("Transiting Exoplanet Survey Satellite");
    await panel.getByRole("button", { name: "Important", exact: true }).click();
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(abbreviation).toHaveValue("TESS");
    await expect(chineseName).toHaveValue("凌日系外行星巡天卫星");
    await expect(englishName).toHaveValue("Transiting Exoplanet Survey Satellite");
    await expect(answer).toHaveValue(/TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const tessAnchor = tessParagraph.locator("[data-readweave-range-anchor-id]");
    await expect(tessAnchor).not.toHaveAttribute("data-readweave-question-count", /.+/);
    await tessAnchor.hover();
    const hoverPreview = page.locator(".readweave-hover-preview");
    await expect(hoverPreview).toBeVisible();
    await expect(hoverPreview.locator(".readweave-hover-question")).toHaveCount(0);
    await expect(hoverPreview).toContainText("TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）");
    await page.mouse.move(5, 5);
    await expect(hoverPreview).toBeHidden();
    await expect.poll(() => tessAnchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe("none");

    const referenceTitle = `ReadWeave E2E · NASA 任务中文解读 · ${runId}`;
    const referenceBody = [
        "来源：https://science.nasa.gov/missions/tess/",
        "这份中文解读再次提到 TESS，并说明同一术语在不同文章中应复用同一个定义对象。",
        "文章可以补充自己的上下文，但被索引的规范定义需要保持全局一致。"
    ].join("\n\n");
    const referenceEditor = await createTextNote(app, referenceTitle, referenceBody);
    const referenceParagraph = referenceEditor.locator("p", { hasText: "这份中文解读再次提到" });
    panel = await openSelectionEditor(page, app, referenceParagraph, "TESS", "Define");
    const candidate = panel.locator(".readweave-candidate", { hasText: "TESS 凌日系外行星巡天卫星" });
    await expect(candidate).toContainText("Reuse");
    await candidate.hover();
    await candidate.getByRole("button", { name: "Use this object", exact: true }).click();
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const referencedEntry = panel.locator(".readweave-entry", { hasText: "TESS 凌日系外行星巡天卫星" });
    await referencedEntry.hover();
    await referencedEntry.getByRole("button", { name: "Edit", exact: true }).click();
    const impact = panel.locator(".readweave-impact");
    await expect(impact).toContainText("2 links across 2 articles");
    const synchronizedDefinition = "TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）用于通过恒星亮度的周期性下降寻找候选系外行星；";
    await impact.locator("textarea").fill(synchronizedDefinition);
    await impact.getByRole("radio", { name: "Update globally", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await expect(referencedEntry).toContainText(synchronizedDefinition);

    const nasaTab = app.tabBar.locator(".note-tab-wrapper", { hasText: nasaTitle });
    await expect(nasaTab).toBeVisible();
    await nasaTab.click();
    await expect(app.currentNoteSplitTitle).toHaveValue(nasaTitle);
    const reopenedNasaEditor = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
    const reopenedTessAnchor = reopenedNasaEditor.locator("[data-readweave-range-anchor-id]", { hasText: "TESS" });
    await reopenedTessAnchor.click();
    panel = app.sidebar.locator("#readweave-panel");
    await expect(panel.locator(".readweave-entry", { hasText: synchronizedDefinition })).toBeVisible();

    const unescoTitle = `ReadWeave E2E · UNESCO 文献遗产说明 · ${runId}`;
    const unescoBody = [
        "来源：https://www.unesco.org/en/memory-world/about",
        "世界记忆计划旨在促进文献遗产保存、推动普遍获取，并提高公众对文献遗产重要性的认识。",
        "同一段落同时包含中文标点、并列目标和较长的解释性结构，用于验证中文锚点稳定性。"
    ].join("\n\n");
    const unescoEditor = await createTextNote(app, unescoTitle, unescoBody);
    const unescoParagraph = unescoEditor.locator("p", { hasText: "世界记忆计划旨在" });
    panel = await openSelectionEditor(page, app, unescoParagraph, "世界记忆计划", "Ask");
    await question.fill("世界记忆计划是啥，它的三个目标各自有啥用，彼此是什么关系？");
    await panel.getByTestId("readweave-optimize-question").check();
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(question).toHaveValue("世界记忆计划是什么，它的三个目标各自有什么用途，彼此是什么关系？");
    await expect(answer).not.toHaveValue(/。/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(unescoParagraph.locator("[data-readweave-question-count]")) .toHaveAttribute("data-readweave-question-count", "1");

    expect(pageErrors).toEqual([]);
});

test("ReadWeave settings store a masked server-side key and expose model selection", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToSettings();
    await app.clickNoteOnNoteTreeByTitle("AI / LLM");

    const settings = app.currentNoteSplit.locator(".note-detail-content-widget-content", { hasText: "ReadWeave model settings" });
    await expect(settings).toBeVisible();
    const fakeSecret = "test-not-a-real-api-key-6789";
    await settings.getByTestId("readweave-base-url").fill("https://api.deepseek.com");
    await settings.getByTestId("readweave-api-key").fill(fakeSecret);
    await settings.getByTestId("readweave-model").selectOption("deepseek-chat");
    await settings.getByTestId("readweave-settings-save").click();
    await expect(settings).toContainText("Settings saved.");
    await expect(settings).toContainText("tes••••••••6789");
    await expect(settings.getByTestId("readweave-api-key")).toHaveValue("");
    await expect(settings).not.toContainText(fakeSecret);

    const origin = new URL(page.url()).origin;
    const dedicated = await page.request.get(`${origin}/api/readweave/settings`);
    expect(dedicated.ok()).toBe(true);
    expect(await dedicated.text()).not.toContain(fakeSecret);
    const generic = await page.request.get(`${origin}/api/options`);
    expect(generic.ok()).toBe(true);
    const genericText = await generic.text();
    expect(genericText).not.toContain(fakeSecret);
    expect(genericText).not.toContain("readWeaveApiKey");
});
