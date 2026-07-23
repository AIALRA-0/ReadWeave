import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const mode = process.argv.includes("--staged") ? "staged" : "all-changes";
const initialWorkingDirectory = process.cwd();
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: initialWorkingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
}).trim();
const baseline = process.env.READWEAVE_PRIVACY_BASELINE || "v0.103.0";

const forbiddenFilePatterns = [
    /(^|\/)\.env($|\.)/i,
    /(^|\/)(credentials?|secrets?)(\.[^/]+)?$/i,
    /\.(?:db|db-wal|db-shm|sqlite|sqlite3|p12|pfx|pem|key|log)$/i,
    /(^|\/)(?:document|session|cookies?)\.(?:json|txt|db)$/i
];

const allowedFilePatterns = [/(^|\/)\.env\.example$/i, /(^|\/)pnpm-lock\.yaml$/i];
const placeholderValue = /^(?:<[^>]+>|\$\{\{|\$\{[^}]+\}|\$[A-Z_]+|process\.env\.[A-Z0-9_]+|example|placeholder|changeme|redacted|none|null|undefined|true|false)$/i;

const secretPatterns = [
    ["通用模型密钥", /\bsk-[A-Za-z0-9_-]{16,}\b/g],
    ["GitHub 访问令牌", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
    ["AWS 访问密钥", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ["私钥内容", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["Bearer 凭据", /\bAuthorization\s*:\s*Bearer\s+(?!\$|<|\{|example|placeholder|redacted)[A-Za-z0-9._~+/=-]{12,}/gi]
];

const assignmentPattern = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*(["'])([^"'\r\n]+)\2/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const windowsUserPathPattern = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+/gi;
const unixUserPathPattern = /\/(?:Users|home)\/([^/\s"'<>]+)/gi;
const allowedUnixUsers = new Set(["node", "user", "username", "example", "runner", "root"]);
const localUserName = path.basename(os.homedir()).toLowerCase();

const findings = [];
const changedFiles = getChangedFiles();

for (const relativePath of changedFiles) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (allowedFilePatterns.some((pattern) => pattern.test(normalizedPath))) {
        continue;
    }

    if (forbiddenFilePatterns.some((pattern) => pattern.test(normalizedPath))) {
        findings.push({ file: normalizedPath, line: 0, reason: "禁止提交的敏感文件类型" });
        continue;
    }

    const content = readCandidateContent(relativePath);
    if (content === null || content.includes("\0")) {
        continue;
    }

    scanContent(normalizedPath, content);
}

if (findings.length > 0) {
    console.error("ReadWeave 隐私扫描失败：");
    for (const finding of findings) {
        const location = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
        console.error(`- ${location} — ${finding.reason}`);
    }
    console.error("请删除真实秘密或个人信息，改用占位符和服务端环境变量后重试。");
    process.exit(1);
}

console.log(`ReadWeave 隐私扫描通过：${changedFiles.length} 个变更文件，模式 ${mode}。`);

function getChangedFiles() {
    const files = new Set();
    const args = mode === "staged"
        ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
        : ["diff", baseline, "--name-only", "--diff-filter=ACMR"];

    for (const file of splitLines(execGit(args))) {
        files.add(file);
    }

    if (mode === "all-changes") {
        for (const file of splitLines(execGit(["ls-files", "--others", "--exclude-standard"]))) {
            files.add(file);
        }
    }

    return [...files].sort();
}

function readCandidateContent(relativePath) {
    try {
        if (mode === "staged") {
            return execGit(["show", `:${relativePath}`]);
        }

        const absolutePath = path.join(repositoryRoot, relativePath);
        if (fs.existsSync(absolutePath)) {
            return fs.readFileSync(absolutePath, "utf8");
        }

        return execGit(["show", `HEAD:${relativePath}`]);
    } catch {
        return null;
    }
}

function scanContent(file, content) {
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineNumber = index + 1;

        for (const [reason, pattern] of secretPatterns) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
                findings.push({ file, line: lineNumber, reason });
            }
        }

        assignmentPattern.lastIndex = 0;
        for (const match of line.matchAll(assignmentPattern)) {
            if (!placeholderValue.test(match[3])) {
                findings.push({ file, line: lineNumber, reason: `疑似真实凭据赋值：${match[1]}` });
            }
        }

        windowsUserPathPattern.lastIndex = 0;
        if (windowsUserPathPattern.test(line)) {
            findings.push({ file, line: lineNumber, reason: "Windows 用户个人路径" });
        }

        unixUserPathPattern.lastIndex = 0;
        for (const match of line.matchAll(unixUserPathPattern)) {
            if (!allowedUnixUsers.has(match[1].toLowerCase())) {
                findings.push({ file, line: lineNumber, reason: "Unix 用户个人路径" });
            }
        }

        emailPattern.lastIndex = 0;
        for (const match of line.matchAll(emailPattern)) {
            const email = match[0].toLowerCase();
            if (!isAllowedEmail(email)) {
                findings.push({ file, line: lineNumber, reason: "新增个人邮箱地址" });
            }
        }

        if (localUserName && line.toLowerCase().includes(localUserName) && !file.endsWith("privacy-scan.mjs")) {
            findings.push({ file, line: lineNumber, reason: "当前设备用户名或主目录名称" });
        }
    }
}

function isAllowedEmail(email) {
    return email.endsWith("@users.noreply.github.com")
        || email.endsWith("@example.com")
        || email.endsWith("@triliumnotes.org")
        || email.endsWith("@trilium.thisgreat.party")
        || email === "contact@eliandoran.me";
}

function execGit(args) {
    return execFileSync("git", args, {
        cwd: repositoryRoot || process.cwd(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
    });
}

function splitLines(value) {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
