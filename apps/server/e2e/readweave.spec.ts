import fs from "node:fs";
import path from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import App from "../../../packages/trilium-e2e/src/support/app";

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

async function selectTextRange(page: Page, paragraph: Locator, selectedText: string, backward = false) {
    await expect(paragraph).toBeVisible({ timeout: 15_000 });
    await paragraph.evaluate(async (element, { text, backward }) => {
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
        if (backward) selection.setBaseAndExtent(textNode, start + text.length, textNode, start);
    }, { text: selectedText, backward });
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
}

async function createTextNote(app: App, title: string, body: string) {
    await app.addNewTab();
    const autocomplete = app.currentNoteSplit.locator(".note-autocomplete");
    await expect(autocomplete).toBeVisible();
    const results = app.currentNoteSplit.locator(".note-detail-empty-results");
    const createSuggestion = results.locator(".aa-suggestion", { hasText: title }).first();
    await expect(async () => {
        await autocomplete.click();
        await autocomplete.clear();
        // The note autocomplete opens from keyboard events; synthetic fill-only
        // input intermittently leaves its suggestion list stale in long suites.
        await autocomplete.pressSequentially(title);
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

async function gotoReadWeave(app: App, page: Page) {
    await app.goto({ preserveTabs: true });
    // The shared upstream fixture can refer to a tab that no longer exists. Trilium reports
    // that once during startup; wait for the transient toast before clicking the tab beneath it.
    await expect(page.locator("#toast-container .toast:visible")).toHaveCount(0, { timeout: 15_000 });
    await app.closeAllTabs();
}

async function openSelectionEditor(page: Page, app: App, paragraph: Locator, excerpt: string, action: "Ask" | "Define") {
    await selectTextRange(page, paragraph, excerpt);
    const liveSelection = app.sidebar.locator("#readweave-panel .readweave-selection");
    await expect(liveSelection).toBeVisible();
    await expect(liveSelection).toContainText(excerpt.trim());
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
    await gotoReadWeave(app, page);
    const launcherChildren = page.locator("#launcher-pane.vertical > *");
    await expect(launcherChildren.nth(0)).toHaveClass(/global-menu/);
    await expect(launcherChildren.nth(1)).toHaveClass(/left-pane-toggle-button/);
    await expect(page.locator(".readweave-selection-actions")).toBeHidden();

    const paragraphText = "NPU 用于加速神经网络中的矩阵和张量运算，能够提高推理效率。";
    const secondParagraphText = "第二段用于验证每个锚点拥有独立草稿。";
    const editor = await createTextNote(
        app,
        uniqueTitle("ReadWeave E2E · Core workflow"),
        `${paragraphText}\n\n${secondParagraphText}`
    );
    const paragraph = editor.locator("p", { hasText: paragraphText });

    await selectTextRange(page, paragraph, "NPU");
    await selectTextRange(page, paragraph, "矩阵和张量");
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
    await selectTextRange(page, paragraph, "NPU", true);
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("NPU");
    await page.mouse.move(5, 5);
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect(page.locator(".readweave-selection-actions")).toBeVisible();
    await page.locator(".readweave-selection-actions").getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("#readweave-panel")).toBeVisible();
    const rightPanelHeaderOverlaps = await page.locator("#right-pane > .card").evaluateAll(cards => cards
        .slice(0, -1)
        .map((card, index) => ({
            headerBottom: card.querySelector(".card-header")?.getBoundingClientRect().bottom ?? 0,
            nextTop: cards[index + 1].getBoundingClientRect().top
        }))
        .filter(rect => rect.headerBottom > rect.nextTop + 0.5));
    expect(rightPanelHeaderOverlaps).toEqual([]);
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
    for (const callout of [ noteCallout, tipCallout, importantCallout, warningCallout, cautionCallout ]) {
        await expect(callout).toBeEnabled();
    }
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
    const answer = panel.getByTestId("readweave-answer");
    await expect(panel.getByRole("textbox", { name: "Answer", exact: true })).toBeVisible();
    await question.fill("NPU 是啥，有啥用？");
    await panel.getByTestId("readweave-optimize-question").check();
    await importantCallout.click();
    await expect(importantCallout).toHaveAttribute("aria-pressed", "true");
    expect(await calloutStyle(noteCallout)).toEqual(await calloutStyle(tipCallout));
    const selectedImportantStyle = await calloutStyle(importantCallout);
    expect(selectedImportantStyle.background).not.toBe((await calloutStyle(tipCallout)).background);
    expect(selectedImportantStyle.borderWidth).toBe("1px");
    expect(selectedImportantStyle.outline).toBe("none");
    const generateAnswer = panel.getByTestId("readweave-generate");
    await expect(generateAnswer).toHaveAccessibleName("Generate answer");
    await generateAnswer.click();
    await expect(generateAnswer).toHaveAttribute("aria-busy", "true");
    await expect(generateAnswer).toContainText("Generating a draft");
    await expect(undecoratedAnchor).toHaveClass(/readweave-anchor-draft/);

    await expect(question).toHaveValue("NPU 是什么，有什么用途？");
    await expect(answer).toHaveValue(/定义与命名：NPU 神经网络处理单元（Neural Processing Unit）是用于加速神经网络计算的专用处理单元/);
    await expect(answer).toHaveValue(/实现选择与证据闭环：/);
    await expect(answer).toHaveValue(/\n\n/);
    await expect(answer).not.toHaveValue(/\n{3,}/);
    await expect(answer).toHaveAttribute("readonly", "");
    await panel.getByRole("button", { name: "Edit answer", exact: true }).click();
    await expect(answer).not.toHaveAttribute("readonly", "");
    await panel.getByRole("button", { name: "Finish editing", exact: true }).click();
    await expect(answer).toHaveAttribute("readonly", "");
    await expect(panel).toContainText("no fallback answer was used");
    const generationMonitor = panel.getByTestId("readweave-generation-monitor");
    await expect(generationMonitor).toContainText("全部检查通过");
    await generationMonitor.locator(".readweave-generation-summary").click();
    await expect(generationMonitor.locator(".readweave-generation-log")).toBeVisible();
    await expect(panel.locator(".readweave-generation-monitor")).toHaveCount(1);

    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const rangeAnchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-callout-important/);
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await paragraph.evaluate(element => getComputedStyle(element).boxShadow)).toBe("none");
    await rangeAnchor.hover();
    await expect(paragraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    expect(await paragraph.evaluate(element => getComputedStyle(element).textDecorationLine)).not.toContain("underline");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-end/);
    await expect(rangeAnchor).toHaveText("NPU");
    await expect.poll(() => rangeAnchor.evaluate(element => getComputedStyle(element, "::after").opacity)).toBe("1");
    const badgeMetrics = await rangeAnchor.evaluate(element => {
        const badge = getComputedStyle(element, "::after");
        const anchor = getComputedStyle(element);
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        return {
            content: badge.content,
            opacity: badge.opacity,
            position: badge.position,
            zIndex: badge.zIndex,
            display: badge.display,
            width: Number.parseFloat(badge.width),
            margin: badge.margin,
            transform: badge.transform,
            transformY: new DOMMatrixReadOnly(badge.transform).m42,
            height: Number.parseFloat(badge.height),
            badgeFontSize: Number.parseFloat(badge.fontSize),
            anchorFontSize: Number.parseFloat(anchor.fontSize),
            background: badge.backgroundColor,
            color: badge.color,
            anchorWidth: element.getBoundingClientRect().width,
            textWidth: textRange.getBoundingClientRect().width
        };
    });
    expect(badgeMetrics.content.replaceAll('"', "")).toBe("1");
    expect(badgeMetrics.content).not.toMatch(/[QT]/);
    expect(badgeMetrics.opacity).toBe("1");
    expect(badgeMetrics.position).toBe("relative");
    expect(badgeMetrics.zIndex).toBe("4");
    // The zero-width inline painting point follows the final rendered glyph even
    // when an anchor wraps, while still consuming no horizontal space.
    expect(badgeMetrics.display).toBe("inline-block");
    expect(badgeMetrics.width).toBe(0);
    expect(badgeMetrics.margin).toBe("0px");
    expect(badgeMetrics.transform).toBe("none");
    expect(badgeMetrics.transformY).toBe(0);
    expect(Math.abs(badgeMetrics.anchorWidth - badgeMetrics.textWidth)).toBeLessThan(1);
    expect(badgeMetrics.badgeFontSize).toBeGreaterThanOrEqual(10);
    expect(badgeMetrics.background).toBe("rgba(0, 0, 0, 0)");
    expect(badgeMetrics.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(await paragraph.evaluate(element => getComputedStyle(element, "::after").content)).toBe("none");
    const questionEntry = panel.locator(".readweave-entry", { hasText: "NPU 是什么，有什么用途？" });
    await expect(questionEntry).toHaveClass(/readweave-callout-important/);

    const paragraphBox = await paragraph.boundingBox();
    expect(paragraphBox).not.toBeNull();
    await page.mouse.move(paragraphBox!.x + paragraphBox!.width - 4, paragraphBox!.y + Math.min(10, paragraphBox!.height / 2));
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();
    await expect(paragraph).not.toHaveClass(/readweave-paragraph-anchor-hover/);

    await rangeAnchor.evaluate(element => {
        const textNode = element.firstChild!;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const nativeSelection = window.getSelection()!;
        nativeSelection.removeAllRanges();
        nativeSelection.addRange(range);
    });
    const responseTestParagraph = editor.locator("p", { hasText: secondParagraphText });
    await page.mouse.move(4, 4);
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();
    await responseTestParagraph.click({ force: true });
    await expect(panel.locator(".readweave-selection")).toContainText("NPU");
    await expect(responseTestParagraph).not.toHaveAttribute("data-readweave-anchor-id", /.+/);
    await expect(page.locator(".readweave-selection-actions")).toBeHidden();
    await rangeAnchor.click();
    await expect(panel.locator(".readweave-selection")).toContainText("NPU");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-locked/);
    await rangeAnchor.click();
    await expect(rangeAnchor).not.toHaveClass(/readweave-anchor-locked/);
    await expect(page.locator(".readweave-hover-preview")).toBeHidden();
    await page.mouse.move(4, 4);

    await rangeAnchor.hover();
    const hoverPreview = page.locator(".readweave-hover-preview");
    await expect(hoverPreview).toBeVisible();
    await expect(hoverPreview).toContainText("NPU 是什么，有什么用途？");
    const previewPlacement = await page.evaluate(() => {
        const preview = document.querySelector<HTMLElement>(".readweave-hover-preview")!.getBoundingClientRect();
        const rightPane = document.querySelector<HTMLElement>("#right-pane")!.getBoundingClientRect();
        return { previewRight: preview.right, rightPaneLeft: rightPane.left };
    });
    expect(previewPlacement.previewRight).toBeLessThanOrEqual(previewPlacement.rightPaneLeft);
    const hoverQuestion = hoverPreview.locator(".readweave-hover-question").first();
    const hoverAnswer = hoverQuestion.locator(".readweave-hover-answer");
    await expect(hoverAnswer).not.toBeVisible();
    await expect(paragraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    await hoverQuestion.hover();
    await expect(hoverAnswer).toBeVisible();
    await expect(hoverAnswer).toContainText("NPU 神经网络处理单元");

    await rangeAnchor.click();
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-locked/);
    await page.mouse.move(5, 5);
    await expect(hoverPreview).toBeVisible();
    await rangeAnchor.click();
    await expect(rangeAnchor).not.toHaveClass(/readweave-anchor-locked/);
    await expect(hoverPreview).toBeHidden();

    await panel.getByRole("button", { name: "Term", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Important", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("textbox", { name: "Abbreviation (optional)", exact: true })).toHaveValue("");
    await expect(panel.getByRole("textbox", { name: "Definition", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Generate definition", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "Abbreviation (optional)", exact: true })).toHaveValue("NPU");
    await expect(panel.getByRole("textbox", { name: "Chinese full name (optional)", exact: true })).toHaveValue("神经网络处理单元");
    await expect(panel.getByRole("textbox", { name: "English full name (optional)", exact: true })).toHaveValue("Neural Processing Unit");
    await expect(answer).toHaveValue(/NPU 神经网络处理单元（Neural Processing Unit）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-term-count", "1");
    await expect(panel).toContainText("This text fragment already has one definition");
    await expect(panel.getByRole("button", { name: "Generate definition", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "I reviewed it — save", exact: true })).toBeDisabled();

    await rangeAnchor.hover();
    const combinedBadge = await rangeAnchor.evaluate(element => {
        const badge = getComputedStyle(element, "::after");
        return { content: badge.content, backgroundImage: badge.backgroundImage };
    });
    expect(combinedBadge.content).not.toMatch(/[QT]/);
    expect(combinedBadge.content.replaceAll('"', "").trim().split(/\s+/)).toEqual([ "1", "1" ]);
    expect(combinedBadge.backgroundImage).not.toBe("none");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-hover/);
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await rangeAnchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain("underline");
    await expect(hoverPreview).toBeVisible();
    await expect(hoverPreview).toContainText("Term definitions");
    await expect(hoverPreview).toContainText("NPU 神经网络处理单元（Neural Processing Unit）");
    await expect(hoverPreview.locator(".readweave-hover-question")).toHaveCount(1);
    const hoverTerm = hoverPreview.locator(".readweave-hover-term").first();
    await expect(hoverTerm.locator(".readweave-hover-definition")).toBeVisible();
    await expect(hoverTerm).toContainText("当前测试资料所定义的概念");

    await panel.getByRole("button", { name: "Question", exact: true }).click();
    await question.fill("NPU 是什么，有什么用途？");
    const candidate = panel.locator(".readweave-candidate").first();
    await expect(candidate).toContainText("Reuse");
    await expect(candidate).toContainText("Title similarity 100%");
    expect(await candidate.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("0px");
    await candidate.hover();
    await candidate.getByRole("button", { name: "Use this object", exact: true }).click();
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");

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
    const failedMonitor = panel.getByTestId("readweave-generation-monitor");
    await expect(failedMonitor).toContainText("生成失败");
    await failedMonitor.locator(".readweave-generation-summary").click();
    const failedEvent = failedMonitor.locator(".readweave-generation-log > li.failed");
    await expect(failedEvent.locator(".readweave-issue-group")).toContainText("定点修复重试已耗尽");
    await expect(failedMonitor.locator(".readweave-generation-detail > .readweave-issue-group")).toHaveCount(0);
    await expect(failedAnchor).toHaveClass(/readweave-anchor-draft/);
    await expect(failedAnchor).toHaveClass(/readweave-anchor-status-error/);
    await panel.getByRole("button", { name: "Don't save", exact: true }).click();
    await expect(secondParagraph.locator("[data-readweave-range-anchor-id]")).toHaveCount(0);

    await openSelectionEditor(page, app, secondParagraph, "独立草稿", "Ask");
    await panel.getByRole("button", { name: "Term", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Tip", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Generate definition", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Question", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Note", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Generate answer", exact: true })).toBeEnabled();
    await question.fill("[REVIEW] 验证保留待人工审核草稿");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await expect(panel.getByTestId("readweave-generation-monitor")).toContainText("自动检查未确认测试草稿");
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

test("ReadWeave keeps launcher and right-panel headers separated across desktop viewport sizes", async ({ page, context }) => {
    const app = new App(page, context);
    await gotoReadWeave(app, page);
    await createTextNote(app, uniqueTitle("ReadWeave E2E · Responsive layout"), "用于验证不同窗口尺寸下的侧栏布局。");

    for (const viewport of [ { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 } ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator("#readweave-panel")).toBeVisible();

        const launcherMetrics = await page.locator("#launcher-pane.vertical").evaluate(element => {
            const globalMenu = element.querySelector<HTMLElement>(".global-menu")?.getBoundingClientRect();
            const toggle = element.querySelector<HTMLElement>(".left-pane-toggle-button")?.getBoundingClientRect();
            return { globalBottom: globalMenu?.bottom ?? 0, toggleTop: toggle?.top ?? 0 };
        });
        expect(launcherMetrics.globalBottom).toBeLessThanOrEqual(launcherMetrics.toggleTop + 0.5);

        const layoutIssues = await page.locator("#right-pane > .card").evaluateAll(cards => cards.flatMap((card, index) => {
            const issues: string[] = [];
            const rect = card.getBoundingClientRect();
            const header = card.querySelector<HTMLElement>(".card-header")?.getBoundingClientRect();
            const title = card.querySelector<HTMLElement>(".card-header-title")?.getBoundingClientRect();
            const buttons = card.querySelector<HTMLElement>(".card-header-buttons")?.getBoundingClientRect();
            const next = cards[index + 1]?.getBoundingClientRect();
            if (header && (header.top < rect.top - 0.5 || header.bottom > rect.bottom + 0.5)) issues.push(`${card.id}:header-outside-card`);
            if (next && rect.bottom > next.top + 0.5) issues.push(`${card.id}:overlaps-next-card`);
            if (title && buttons && title.right > buttons.left + 0.5) issues.push(`${card.id}:title-overlaps-buttons`);
            return issues;
        }));
        expect(layoutIssues, JSON.stringify(viewport)).toEqual([]);
    }
});

test("ReadWeave confirms a pending selection from the right panel and enables generation", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await gotoReadWeave(app, page);
    const source = "该论文发表于 ASP-DAC，并讨论了三维集成电路中的宏布局。";
    const editor = await createTextNote(app, uniqueTitle("ReadWeave E2E · Pending selection"), source);
    const paragraph = editor.locator("p", { hasText: source });
    await selectTextRange(page, paragraph, "ASP-DAC");

    const panel = app.sidebar.locator("#readweave-panel");
    await expect(panel).toContainText("Text selection awaiting confirmation");
    const generate = panel.getByRole("button", { name: "Generate answer", exact: true });
    await expect(generate).toBeDisabled();
    const question = panel.getByRole("textbox", { name: "Question", exact: true });
    await question.focus();
    await expect(page.locator(".readweave-selection-actions")).toBeHidden();
    await expect(question).toHaveValue("What does “ASP-DAC” mean in this context?");
    await question.fill("[SLOW] What does ASP-DAC mean in this context?");
    await expect(generate).toBeEnabled();
    await generate.click();
    const provisionalAnchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(provisionalAnchor).toHaveClass(/readweave-anchor-status-running/);
    expect(await provisionalAnchor.evaluate(element => getComputedStyle(element, "::before").content)).toBe('"●"');
    const generationMonitor = panel.getByTestId("readweave-generation-monitor");
    const runningState = generationMonitor.locator(".readweave-generation-state");
    await expect(runningState).toHaveClass(/running/);
    const runningStateStyle = await runningState.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, borderWidth: style.borderTopWidth };
    });
    expect(runningStateStyle.borderWidth).toBe("0px");
    expect(runningStateStyle.background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(panel.getByTestId("readweave-answer")).toHaveValue(/定义与命名：/);

    const saveButton = panel.getByRole("button", { name: "I reviewed it — save", exact: true });
    const discardButton = panel.getByRole("button", { name: "Don't save", exact: true });
    const regenerateButton = panel.getByRole("button", { name: "Regenerate", exact: true });
    const [ saveBox, discardBox, regenerateBox ] = await Promise.all([
        saveButton.boundingBox(),
        discardButton.boundingBox(),
        regenerateButton.boundingBox()
    ]);
    expect(saveBox).not.toBeNull();
    expect(discardBox).not.toBeNull();
    expect(regenerateBox).not.toBeNull();
    expect(Math.abs(saveBox!.x - discardBox!.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(saveBox!.x + saveBox!.width - regenerateBox!.x - regenerateBox!.width)).toBeLessThanOrEqual(0.5);

    await regenerateButton.click();
    const optionalFeedback = panel.getByRole("textbox", { name: "Correction instructions (optional)", exact: true });
    await expect(optionalFeedback).toHaveValue("");
    const startRegeneration = panel.getByRole("button", { name: "Start regeneration", exact: true });
    await expect(startRegeneration).toBeEnabled();
    await startRegeneration.click();
    const freshLog = generationMonitor.locator(".readweave-generation-log");
    await expect(freshLog.locator("li")).toHaveCount(1);
    await expect(freshLog).toContainText("已按原问题重新排队");
    await expect(freshLog).not.toContainText("全部检查通过");
    await expect(panel.getByTestId("readweave-answer")).toHaveValue(/定义与命名：/);
    await discardButton.click();
});

test("ReadWeave keeps a wrapped fragment badge at the inline end without shifting following text", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await gotoReadWeave(app, page);
    const source = "该论文发表于 ASP-DAC，并讨论了三维集成电路中的宏布局。";
    const editor = await createTextNote(app, uniqueTitle("ReadWeave E2E · Wrapped fragment badge"), source);
    const paragraph = editor.locator("p", { hasText: source });
    const panel = await openSelectionEditor(page, app, paragraph, "ASP-DAC", "Define");

    await panel.getByRole("textbox", { name: "Abbreviation (optional)", exact: true }).fill("ASP-DAC");
    await panel.getByRole("textbox", { name: "Chinese full name (optional)", exact: true }).fill("亚洲及南太平洋设计自动化会议");
    await panel.getByRole("textbox", { name: "English full name (optional)", exact: true }).fill("Asia and South Pacific Design Automation Conference");
    await panel.getByRole("button", { name: "Generate definition", exact: true }).click();
    await expect(panel.getByTestId("readweave-answer")).not.toHaveValue("");
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();

    const rangeAnchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-end/);
    await expect(rangeAnchor).toHaveText("ASP-DAC");

    let wrappedViewportWidth: number | undefined;
    for (const width of [ 520, 480, 440, 420, 400, 380, 360 ]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const rectCount = await rangeAnchor.evaluate(element => {
            const textRange = document.createRange();
            textRange.selectNodeContents(element);
            return Array.from(textRange.getClientRects()).filter(rect => rect.width > 0.5).length;
        });
        if (rectCount > 1) {
            wrappedViewportWidth = width;
            break;
        }
    }
    expect(wrappedViewportWidth).toBeDefined();

    const readLayout = () => rangeAnchor.evaluate(element => {
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        const textRects = Array.from(textRange.getClientRects())
            .filter(rect => rect.width > 0.5)
            .map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
        const anchorRects = Array.from(element.getClientRects())
            .filter(rect => rect.width > 0.5)
            .map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
        const paragraph = element.closest("p");
        if (!paragraph) throw new Error("Wrapped ReadWeave anchor has no paragraph.");

        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        let passedAnchor = false;
        let followingRect: DOMRect | undefined;
        while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            if (element.contains(node)) {
                passedAnchor = true;
                continue;
            }
            if (!passedAnchor || node.data.length === 0) continue;
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, 1);
            followingRect = range.getBoundingClientRect();
            break;
        }
        if (!followingRect) throw new Error("Wrapped ReadWeave anchor has no following text.");
        const paragraphRect = paragraph.getBoundingClientRect();
        return {
            anchorRects,
            textRects,
            following: {
                left: followingRect.left,
                right: followingRect.right,
                top: followingRect.top,
                bottom: followingRect.bottom
            },
            paragraph: {
                left: paragraphRect.left,
                right: paragraphRect.right,
                top: paragraphRect.top,
                bottom: paragraphRect.bottom,
                height: paragraphRect.height
            }
        };
    });
    const expectSameLayout = (actual: Awaited<ReturnType<typeof readLayout>>, expected: Awaited<ReturnType<typeof readLayout>>) => {
        expect(actual.anchorRects.length).toBe(expected.anchorRects.length);
        expect(actual.textRects.length).toBe(expected.textRects.length);
        for (const [ index, rect ] of actual.anchorRects.entries()) {
            expect(rect.left).toBeCloseTo(expected.anchorRects[index].left, 1);
            expect(rect.right).toBeCloseTo(expected.anchorRects[index].right, 1);
            expect(rect.top).toBeCloseTo(expected.anchorRects[index].top, 1);
            expect(rect.bottom).toBeCloseTo(expected.anchorRects[index].bottom, 1);
        }
        expect(actual.following.left).toBeCloseTo(expected.following.left, 1);
        expect(actual.following.right).toBeCloseTo(expected.following.right, 1);
        expect(actual.following.top).toBeCloseTo(expected.following.top, 1);
        expect(actual.following.bottom).toBeCloseTo(expected.following.bottom, 1);
        expect(actual.paragraph.height).toBeCloseTo(expected.paragraph.height, 1);
    };

    const initialLayout = await readLayout();
    expect(initialLayout.anchorRects.length).toBeGreaterThan(1);
    expect(initialLayout.textRects.length).toBeGreaterThan(1);
    expect(initialLayout.textRects.at(-1)!.top).toBeGreaterThan(initialLayout.textRects[0].top);

    await rangeAnchor.hover();
    await expect.poll(() => rangeAnchor.evaluate(element => getComputedStyle(element, "::after").opacity)).toBe("1");
    const badgeMetrics = await rangeAnchor.evaluate(element => {
        const badge = getComputedStyle(element, "::after");
        return {
            content: badge.content,
            display: badge.display,
            position: badge.position,
            width: Number.parseFloat(badge.width),
            margin: badge.margin,
            color: badge.color
        };
    });
    expect(badgeMetrics.content.replaceAll('"', "")).toBe("1");
    expect(badgeMetrics.position).toBe("relative");
    expect(badgeMetrics.display).toBe("inline-block");
    expect(badgeMetrics.width).toBe(0);
    expect(badgeMetrics.margin).toBe("0px");
    expect(badgeMetrics.color).not.toBe("rgba(0, 0, 0, 0)");
    expectSameLayout(await readLayout(), initialLayout);

    await rangeAnchor.click();
    await expect(rangeAnchor).toHaveClass(/readweave-anchor-locked/);
    await page.mouse.move(4, 4);
    await expect.poll(() => rangeAnchor.evaluate(element => getComputedStyle(element, "::after").opacity)).toBe("1");
    expectSameLayout(await readLayout(), initialLayout);

    await rangeAnchor.click();
    await expect(rangeAnchor).not.toHaveClass(/readweave-anchor-locked/);
    expectSameLayout(await readLayout(), initialLayout);
});

test("ReadWeave ignores a delayed generation response after switching to another anchor", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await gotoReadWeave(app, page);

    const sourceA = "锚点 A 用于启动一个响应被故意延迟的后台回答任务。";
    const sourceB = "锚点 B 必须继续保有自己独立且可操作的回答表单。";
    const editor = await createTextNote(
        app,
        uniqueTitle("ReadWeave E2E · Delayed generation isolation"),
        `${sourceA}\n\n${sourceB}`
    );
    const paragraphA = editor.locator("p", { hasText: sourceA });
    const paragraphB = editor.locator("p", { hasText: sourceB });

    let releaseStartResponse!: () => void;
    const startResponseGate = new Promise<void>(resolve => { releaseStartResponse = resolve; });
    let delayedJobId: string | undefined;
    let delayedResponseFulfilled = false;
    await page.route("**/api/readweave/generation-jobs", async route => {
        const request = route.request();
        if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/readweave/generation-jobs") {
            await route.continue();
            return;
        }

        // Let the server accept and start A, but hold its POST response so the
        // client can move to B before A's async generate() continuation resumes.
        const response = await route.fetch();
        const payload = await response.json() as { job: { jobId: string } };
        delayedJobId = payload.job.jobId;
        await startResponseGate;
        await route.fulfill({ response });
        delayedResponseFulfilled = true;
    });

    try {
        let panel = await openSelectionEditor(page, app, paragraphA, "锚点 A", "Ask");
        await panel.getByRole("textbox", { name: "Question", exact: true }).fill("[SLOW] 锚点 A 的作用是什么？");
        await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
        await expect.poll(() => delayedJobId, { timeout: 10_000 }).toBeTruthy();

        panel = await openSelectionEditor(page, app, paragraphB, "锚点 B", "Ask");
        const selection = panel.locator(".readweave-selection");
        const question = panel.getByRole("textbox", { name: "Question", exact: true });
        const answer = panel.getByTestId("readweave-answer");
        const generate = panel.getByRole("button", { name: "Generate answer", exact: true });
        await expect(selection).toContainText("锚点 B");
        await expect(question).toHaveValue(/锚点 B/);
        await expect(answer).toHaveValue("");
        await expect(generate).toBeEnabled();
        await expect(panel.getByTestId("readweave-generation-monitor")).toHaveCount(0);

        releaseStartResponse();
        await expect.poll(() => delayedResponseFulfilled).toBe(true);

        const origin = new URL(page.url()).origin;
        await expect.poll(async () => {
            const response = await page.request.get(`${origin}/api/readweave/generation-jobs/${encodeURIComponent(delayedJobId!)}`);
            if (!response.ok()) return "missing";
            return ((await response.json()) as { job: { status: string } }).job.status;
        }, { timeout: 10_000 }).toBe("complete");

        // A's accepted response and completed result may update global anchor
        // indicators, but neither is allowed to claim B's active editor state.
        await page.waitForTimeout(250);
        await expect(selection).toContainText("锚点 B");
        await expect(question).toHaveValue(/锚点 B/);
        await expect(answer).toHaveValue("");
        await expect(generate).toBeEnabled();
        await expect(generate).not.toHaveAttribute("aria-busy", "true");
        await expect(panel.getByTestId("readweave-generation-monitor")).toHaveCount(0);
    } finally {
        releaseStartResponse();
        if (delayedJobId) {
            const origin = new URL(page.url()).origin;
            await page.request.delete(`${origin}/api/readweave/generation-jobs/${encodeURIComponent(delayedJobId)}`).catch(() => undefined);
        }
    }
});

test("ReadWeave restores a background result after switching away and clears the unread marker only when viewed", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await gotoReadWeave(app, page);
    const title = uniqueTitle("ReadWeave E2E · Background recovery");
    const source = "后台任务应在用户离开当前页面后继续，并在返回时恢复审核草稿。";
    const editor = await createTextNote(app, title, source);
    const paragraph = editor.locator("p", { hasText: source });
    let panel = await openSelectionEditor(page, app, paragraph, "后台任务", "Ask");
    await panel.getByRole("textbox", { name: "Question", exact: true }).fill("[SLOW] 后台任务如何恢复？");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    const anchor = paragraph.locator("[data-readweave-range-anchor-id]");
    await expect(anchor).toHaveClass(/readweave-anchor-draft/);
    await expect(anchor).toHaveClass(/readweave-anchor-status-running/);

    await app.addNewTab();
    await page.waitForTimeout(1_200);
    await app.tabBar.locator(".note-tab-wrapper", { hasText: title }).click();
    await expect(app.currentNoteSplitTitle).toHaveValue(title);
    const restoredAnchor = app.currentNoteSplit.locator("[data-readweave-range-anchor-id]", { hasText: "后台任务" });
    await expect(restoredAnchor).toHaveClass(/readweave-anchor-draft/);
    await expect(restoredAnchor).toHaveClass(/readweave-anchor-status-unread/);

    const restoredBox = await restoredAnchor.boundingBox();
    expect(restoredBox).not.toBeNull();
    await page.mouse.click(restoredBox!.x + restoredBox!.width / 2, restoredBox!.y + restoredBox!.height / 2);
    panel = app.sidebar.locator("#readweave-panel");
    await expect(panel.locator(".readweave-selection")).toContainText("后台任务");
    await expect(panel.getByTestId("readweave-answer")).toHaveValue(/定义与命名：/);
    await expect(panel.getByTestId("readweave-generation-monitor")).toContainText("全部检查通过");
    await expect(restoredAnchor).not.toHaveClass(/readweave-anchor-status-unread/);
    await expect(restoredAnchor).toHaveClass(/readweave-anchor-draft/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(restoredAnchor).not.toHaveClass(/readweave-anchor-draft/);
    await expect(app.currentNoteSplit.locator("p", { hasText: source })).toHaveAttribute("data-readweave-paragraph-question-count", "1");
});

test("ReadWeave splits a Tip subrange from its Note anchor and uses hover without requiring clicks", async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = new App(page, context);
    await gotoReadWeave(app, page);

    const source = "默认只运行龙猫，备选链路包括 WARP 与 Hiddify。";
    const editor = await createTextNote(
        app,
        uniqueTitle("ReadWeave E2E · Split anchors"),
        source
    );
    const paragraph = editor.locator("p", { hasText: source });
    const panel = await openSelectionEditor(page, app, paragraph, source, "Ask");
    const question = panel.getByRole("textbox", { name: "Question", exact: true });
    const answer = panel.getByTestId("readweave-answer");
    await question.fill("为什么默认只运行龙猫，还有哪些备选链路？");
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();

    const originalAnchor = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: source });
    await expect(originalAnchor).toHaveClass(/readweave-anchor-callout-note/);
    await originalAnchor.hover();
    await expect(paragraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeVisible();
    await expect(page.locator(".readweave-hover-preview")).toContainText("为什么默认只运行龙猫，还有哪些备选链路？");
    // Background job polling refreshes persistent decorations every two seconds.
    // The transient hover state must survive that refresh while the pointer stays put.
    await page.waitForTimeout(2_300);
    await expect(paragraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeVisible();
    const fullAnchorPreviewOverlap = await page.evaluate(() => {
        const anchor = document.querySelector<HTMLElement>("[data-readweave-range-anchor-id]")!.getBoundingClientRect();
        const preview = document.querySelector<HTMLElement>(".readweave-hover-preview")!.getBoundingClientRect();
        return preview.left < anchor.right && preview.right > anchor.left && preview.top < anchor.bottom && preview.bottom > anchor.top;
    });
    expect(fullAnchorPreviewOverlap).toBe(false);

    await openSelectionEditor(page, app, paragraph, " WARP ", "Define");
    await panel.getByRole("textbox", { name: "Chinese full name (optional)", exact: true }).fill("应急网络服务");
    await panel.getByRole("textbox", { name: "English full name (optional)", exact: true }).fill("WARP");
    await panel.getByRole("button", { name: "Generate definition", exact: true }).click();
    await expect(answer).toHaveValue(/应急网络服务（WARP）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();

    const tipAnchor = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "WARP" });
    const notePrefix = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "默认只运行龙猫" });
    const noteSuffix = paragraph.locator("[data-readweave-range-anchor-id]", { hasText: "与 Hiddify" });
    await expect(tipAnchor).toHaveClass(/readweave-anchor-callout-tip/);
    await expect(tipAnchor).toHaveText("WARP");
    await expect(notePrefix).toHaveClass(/readweave-anchor-callout-note/);
    await expect(noteSuffix).toHaveClass(/readweave-anchor-callout-note/);
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");
    await expect(paragraph).toHaveAttribute("data-readweave-paragraph-term-count", "1");

    await notePrefix.hover();
    await expect(paragraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeVisible();
    await expect(page.locator(".readweave-hover-preview")).toContainText("为什么默认只运行龙猫，还有哪些备选链路？");

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
    await gotoReadWeave(app, page);
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
    const answer = panel.getByTestId("readweave-answer");
    await question.fill("Why does QUIC use UDP, how is TLS involved, and what happens to unrelated streams after packet loss?");
    await panel.getByTestId("readweave-optimize-question").check();
    await panel.getByRole("button", { name: "Warning", exact: true }).click();
    await panel.getByRole("button", { name: "Generate answer", exact: true }).click();
    await expect(answer).toHaveValue(/定义与命名：/);
    await expect(answer).toHaveValue(/实现选择与证据闭环：/);
    await expect(panel.getByTestId("readweave-generation-monitor")).toContainText("全部检查通过");
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const quicAnchor = rfcParagraph.locator("[data-readweave-range-anchor-id]");
    await expect(rfcParagraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");
    await quicAnchor.hover();
    await expect(rfcParagraph).toHaveClass(/readweave-paragraph-anchor-hover/);
    await expect(page.locator(".readweave-hover-preview")).toBeVisible();
    await expect(page.locator(".readweave-hover-preview")).toContainText("Why does QUIC use UDP");
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
    const abbreviation = panel.getByRole("textbox", { name: "Abbreviation (optional)", exact: true });
    const chineseName = panel.getByRole("textbox", { name: "Chinese full name (optional)", exact: true });
    const englishName = panel.getByRole("textbox", { name: "English full name (optional)", exact: true });
    await abbreviation.fill("TESS");
    await chineseName.fill("凌日系外行星巡天卫星");
    await englishName.fill("Transiting Exoplanet Survey Satellite");
    await panel.getByRole("button", { name: "Important", exact: true }).click();
    await panel.getByRole("button", { name: "Generate definition", exact: true }).click();
    await expect(abbreviation).toHaveValue("TESS");
    await expect(chineseName).toHaveValue("凌日系外行星巡天卫星");
    await expect(englishName).toHaveValue("Transiting Exoplanet Survey Satellite");
    await expect(answer).toHaveValue(/TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）/);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    const tessAnchor = tessParagraph.locator("[data-readweave-range-anchor-id]");
    await expect(tessParagraph).not.toHaveAttribute("data-readweave-paragraph-question-count", /.+/);
    await expect(tessParagraph).toHaveAttribute("data-readweave-paragraph-term-count", "1");
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
    await expect(answer).toHaveValue(/。\n\n.+。\n\n.+。/s);
    expect((await answer.inputValue()).split(/\n\n/)).toHaveLength(3);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(unescoParagraph).toHaveAttribute("data-readweave-paragraph-question-count", "1");

    expect(pageErrors).toEqual([]);
});

test("ReadWeave settings store a masked server-side key and expose model selection", async ({ page, context }) => {
    const app = new App(page, context);
    await gotoReadWeave(app, page);
    await app.goToSettings();
    await app.goToSettingsPage("_optionsLlm");

    const settings = app.optionsDialogContent.locator(".note-detail-content-widget-content", { hasText: "ReadWeave model settings" });
    await expect(settings).toBeVisible();
    const fakeSecret = "test-not-a-real-api-key-6789";
    await settings.getByTestId("readweave-base-url").fill("https://api.deepseek.com");
    await settings.getByTestId("readweave-api-key").fill(fakeSecret);
    await settings.getByTestId("readweave-model").selectOption("deepseek-v4-pro");
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
