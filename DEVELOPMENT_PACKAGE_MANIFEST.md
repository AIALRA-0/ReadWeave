# ReadWeave 开发包清单

此目录是 2026-07-18 制作的 MacBook 续开发快照，包含制作时工作目录内全部 Git 已跟踪文件，以及未被 `.gitignore` 排除的新增源码。

## 开箱入口

1. `MACBOOK_HANDOFF.md`：产品初衷、目标、交互契约、架构边界、当前状态和验证方法；
2. `CODEX_CONTINUATION_PROMPT.md`：可直接交给另一台 Codex 的第一条提示词；
3. `scripts/readweave/bootstrap-macos.sh`：安装锁定版本依赖、隐私扫描和生产构建；
4. `scripts/readweave/start-macos.sh`：以独立数据目录在 `127.0.0.1:8082` 启动；
5. `scripts/readweave/stop-macos.sh`：只停止由启动器记录的 ReadWeave 进程；
6. `docs/readlayer/`：完整 PRD、UX、架构、路线、追溯、风险、导出协议和评估 harness。

## 明确不包含

- Git 元数据和本机远程认证；
- `node_modules`、构建输出、缓存和覆盖率；
- Trilium / ReadWeave 数据库、真实笔记、上传文件、备份和日志；
- `.env`、API Key、密码、令牌、Cookie 和模型服务凭据；
- Playwright 报告、截图、录像、浏览器会话和私有评估材料；
- Windows 用户个人绝对路径。

MacBook 解压后必须重新安装依赖。压缩包不携带任何现有用户数据；如果需要迁移笔记，应另走 Trilium 的受控备份/恢复流程，并在传输前单独加密，不能把数据混入源码包或 Git。
