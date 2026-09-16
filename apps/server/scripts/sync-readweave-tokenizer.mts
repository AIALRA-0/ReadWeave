import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Public tokenizer assets only, never model weights, credentials or user text.
const revision = "7872f01b1d1fe23eabc4c98b48bffcef5a386062";
const base = `https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/resolve/${revision}/`;
const root = new URL("../src/assets/readweave-tokenizer/", import.meta.url);
await mkdir(root, {recursive:true});
const files = await Promise.all(["tokenizer.json", "tokenizer_config.json", "LICENSE"].map(async name => {
    const response = await fetch(base + name);
    if (!response.ok) throw new Error(`Public tokenizer download failed: ${name}, ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(new URL(name, root), bytes);
    return {name, sha256:createHash("sha256").update(bytes).digest("hex"), bytes:bytes.length};
}));
await writeFile(new URL("provenance.json",root), JSON.stringify({model:"deepseek-ai/DeepSeek-V4-Flash-0731",revision,files},null,2)+"\n");
console.log(JSON.stringify({directory:fileURLToPath(root),revision,files}));
