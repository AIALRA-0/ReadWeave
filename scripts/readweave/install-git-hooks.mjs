import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("ReadWeave 本地隐私提交钩子已启用。");
