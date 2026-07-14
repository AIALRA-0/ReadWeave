import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse } from "@triliumnext/commons";

import ValidationError from "../errors/validation_error.js";
import { selectReadWeaveContext } from "./readweave_engine.js";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

interface DeepSeekResponse {
    model?: string;
    choices?: Array<{
        message?: { content?: string };
    }>;
    error?: { message?: string };
}

function buildSystemPrompt(kind: ReadWeaveGenerateRequest["kind"]): string {
    const task = kind === "question"
        ? "回答用户提出的一个问题。"
        : "给出用户指定名词的准确、紧凑定义。";
    return [
        "你是 ReadWeave 阅读辅助器。",
        task,
        "只输出一个可直接保存的答案，不聊天，不反问，不附加寒暄。",
        "只能依据提供的上下文；上下文不足时必须明确说明缺少什么，不得编造。",
        "保留必要的技术细节，优先先给结论。",
        "涉及英文名词时严格使用“缩写 中文全称（English Full Name）”格式；没有缩写时使用“中文全称（English Full Name）”。"
    ].join("\n");
}

export async function generateReadWeaveAnswer(request: ReadWeaveGenerateRequest): Promise<ReadWeaveGenerateResponse> {
    if (request.kind !== "question" && request.kind !== "term") throw new ValidationError("kind must be question or term.");
    if (typeof request.title !== "string" || !request.title.trim() || request.title.length > 1_000) {
        throw new ValidationError("A title of at most 1000 characters is required.");
    }
    if (!Array.isArray(request.fragments) || request.fragments.length === 0 || request.fragments.length > 200) {
        throw new ValidationError("Context fragments are required.");
    }

    const selected = selectReadWeaveContext(request.title, request.fragments, request.characterBudget);
    const contextText = selected.fragments
        .map(fragment => `[${fragment.role}:${fragment.id}]\n${fragment.text}`)
        .join("\n\n");

    if (process.env.TRILIUM_INTEGRATION_TEST === "memory" && process.env.READWEAVE_TEST_AI === "mock") {
        return {
            body: `测试回答：${request.title.trim()}\n\n依据：${selected.fragments[0]?.text ?? "无"}`,
            context: selected.decision,
            provider: "readweave-test",
            model: "deterministic-mock"
        };
    }

    const apiKey = process.env.READWEAVE_DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new ValidationError("ReadWeave AI is not configured on the server.");
    }
    const model = process.env.READWEAVE_DEEPSEEK_MODEL || "deepseek-chat";
    const response = await fetch(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            stream: false,
            messages: [
                { role: "system", content: buildSystemPrompt(request.kind) },
                { role: "user", content: `题目：${request.title.trim()}\n\n上下文：\n${contextText}` }
            ]
        }),
        signal: AbortSignal.timeout(90_000)
    });

    const payload = await response.json() as DeepSeekResponse;
    if (!response.ok) {
        throw new Error(`DeepSeek request failed (${response.status}): ${payload.error?.message || "unknown error"}`);
    }
    const body = payload.choices?.[0]?.message?.content?.trim();
    if (!body) throw new Error("DeepSeek returned an empty answer.");
    return {
        body,
        context: selected.decision,
        provider: "deepseek",
        model: payload.model || model
    };
}
