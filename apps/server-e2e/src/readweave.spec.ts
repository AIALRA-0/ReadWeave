import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import App from "./support/app";

test.describe.configure({ retries: 0 });

test("ReadWeave completes reviewed save, reuse, all edit modes and validated export", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Empty text");

    const editor = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
    const paragraphText = "NPU 神经网络处理器用于加速神经网络中的矩阵和张量运算。";
    await editor.fill(paragraphText);
    const paragraph = editor.locator("p", { hasText: paragraphText });
    await expect(async () => {
        await paragraph.hover();
        await expect(paragraph).toHaveClass(/readweave-paragraph-hover/, { timeout: 500 });
    }).toPass({ timeout: 5_000 });
    await paragraph.click();

    const panel = app.sidebar.locator("#readweave-panel");
    await expect(panel).toContainText("Selected paragraph");
    await expect(panel).toContainText(paragraphText);

    const question = panel.getByRole("textbox", { name: "One question", exact: true });
    const answer = panel.getByRole("textbox", { name: "Answer or definition", exact: true });
    await question.fill("NPU 是什么？");
    await panel.getByRole("button", { name: "Generate one answer", exact: true }).click();

    await expect(answer).toHaveValue(/测试回答：NPU 是什么？/);
    await expect(panel).toContainText("Draft ready. Review or edit it before saving.");
    await expect(panel.locator(".readweave-entry")).toHaveCount(0);
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(panel.locator(".readweave-entry")).toContainText("NPU 是什么？");

    await question.fill("NPU 是什么？");
    const candidate = panel.locator(".readweave-candidate");
    await expect(candidate).toContainText("Reuse");
    await expect(panel.getByRole("button", { name: "Generate one answer", exact: true })).toBeEnabled();
    await candidate.hover();
    await candidate.getByRole("button", { name: "Use this object", exact: true }).click();
    await expect(answer).toHaveValue(/测试回答：NPU 是什么？/);
    await expect(panel).toContainText("Saving will link the selected existing object instead of creating a duplicate.");
    await panel.getByRole("button", { name: "I reviewed it — save", exact: true }).click();
    await expect(panel.locator(".readweave-entry")).toHaveCount(1);

    const savedEntry = panel.locator(".readweave-entry");
    await savedEntry.hover();
    await savedEntry.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(panel).toContainText("This object has 1 links across 1 articles.");

    const updatedAnswer = "NPU（神经网络处理器，Neural Processing Unit）是用于加速神经网络矩阵与张量运算的专用处理器。";
    const impact = panel.locator(".readweave-impact");
    await impact.locator("textarea").fill(updatedAnswer);
    await impact.getByRole("radio", { name: "Update globally", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await savedEntry.hover();
    await expect(savedEntry).toContainText(updatedAnswer);

    await savedEntry.getByRole("button", { name: "Edit", exact: true }).click();
    const displayAnswer = "仅在本文锚点显示的 NPU 解释。";
    await impact.locator("textarea").fill(displayAnswer);
    await impact.getByRole("radio", { name: "Change this display only", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await savedEntry.hover();
    await expect(savedEntry).toContainText(displayAnswer);

    await savedEntry.getByRole("button", { name: "Edit", exact: true }).click();
    const variantAnswer = "本文专用的 NPU 变体定义。";
    await impact.locator("textarea").fill(variantAnswer);
    await impact.getByRole("radio", { name: "Create an article variant", exact: true }).check();
    await impact.getByRole("button", { name: "Apply change", exact: true }).click();
    await savedEntry.hover();
    await expect(savedEntry).toContainText(variantAnswer);

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
        schemaVersion: "1.0",
        generator: { name: "ReadWeave", workflowVersion: "context-v1" },
        scope: { type: "articles", articleIds: [ expect.any(String) ], includeContent: true },
        integrity: { valid: true, articleCount: 1, anchorCount: 1, objectCount: 1, linkCount: 1 }
    });
    expect(exported.integrity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.links).toHaveLength(1);
    expect(exported.objects).toHaveLength(1);
});
