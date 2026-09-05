import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..", "evals", "readweave");
const groups = [ "dev", "heldout" ];
const seen = new Map();
const forbiddenPathParts = [ "candidate-test-data", "production", "book" ];

for (const group of groups) {
    const directory = join(root, group);
    for (const name of await readdir(directory)) {
        if (!name.endsWith(".json")) continue;
        const path = join(directory, name);
        const relativePath = relative(root, path).replaceAll("\\", "/");
        if (forbiddenPathParts.some(part => relativePath.includes(part))) {
            throw new Error(`eval fixture is not isolated: ${relativePath}`);
        }
        const content = await readFile(path);
        const digest = createHash("sha256").update(content).digest("hex");
        const previous = seen.get(digest);
        if (previous) throw new Error(`duplicate fixture content: ${previous} and ${relativePath}`);
        seen.set(digest, relativePath);
        const parsed = JSON.parse(content);
        if (!parsed.id || parsed.id.startsWith("prod-") || parsed.id.includes("forest")) {
            throw new Error(`fixture id is not an isolated evaluation id: ${relativePath}`);
        }
    }
}

console.log(`ReadWeave evaluation isolation passed: ${seen.size} fixtures, ${groups.length} isolated groups`);
