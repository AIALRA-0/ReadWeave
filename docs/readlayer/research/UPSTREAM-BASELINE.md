# ReadWeave（织读）调研基线与证据边界

> 调研日期：2026-07-14
> 目的：为 PRD 和技术路线提供可复查事实；本文不代表已经实现。

## 本地环境事实

- 当前工作目录在调研开始时为空，未发现同机其他 ReadLayer/UltraReader 源码目录。
- 本机正在运行 Trilium `0.101.3`，程序位于用户级安装目录。
- 本地 Trilium 数据目录存在常规 `document.db`、WAL、备份与日志结构。
- 浏览器访问本地实例时因没有该浏览器会话而收到 401，因此没有读取用户笔记内容；本轮仅使用用户提供的截图判断记录习惯。
- 截图显示用户习惯是在原文段落附近保存两类块：绿色术语/提示块、蓝色问答块；回答可能较长，且需要大量加粗、缩进和样式维护。

## 旧原型的可见边界

- 旧原型的公开未登录页面无法展示登录后的信息架构。
- 因此，关于旧流程问题的判断以产品所有者描述和所提供截图为准；当前版本不迁移旧原型的账户或私有数据。

## 上游版本

- 官方仓库：[TriliumNext/Trilium](https://github.com/TriliumNext/Trilium)
- 本轮确认的最新稳定发布：[v0.103.0](https://github.com/TriliumNext/Trilium/releases/tag/v0.103.0)，发布提交 `44f5be88b776078fe268dc9877411cb144df3a46`，日期 2026-05-13。
- 本项目已固定在该标签，并在 ReadWeave 开发仓库的 `main` 分支持续实现。
- v0.103.0 提升了数据库和同步版本；正式升级本地数据前必须同时考虑桌面端、服务器端、备份和回滚。
- 2026-07-14 再次通过官方远程标签核对，最高 Trilium 应用稳定标签仍为 v0.103.0；`web-clipper-*` 是单独的网页剪藏器版本，不能当成 Trilium 应用版本。

## Web 主端的官方依据

- Trilium 官方服务器安装指南明确说明服务器形态用于浏览器访问，并包含 Web 和移动前端。
- 官方快速开始把“服务器 + 仅 Web 访问”列为独立部署方式，数据保存在服务器并从浏览器访问。
- 因此 ReadWeave 以 Trilium Server/Web 为主不需要另写独立网页笔记系统；主要改动位于上游 Web 客户端和服务端。

证据：

- [Server Installation](https://docs.triliumnotes.org/user-guide/setup/server)
- [Quick Start](https://docs.triliumnotes.org/user-guide/quick-start)

## 可复用的上游能力

### LLM 与侧栏

发布说明与源码表明 v0.103.0 已重新引入实验性 AI/LLM：

- 右侧栏聊天与独立 `llmChat` 笔记类型。
- 流式响应、停止生成、聊天历史、引用和用量信息。
- 侧栏能感知当前笔记，并可选择启用笔记工具。
- 侧栏聊天持久化为隐藏笔记，能转存为普通聊天笔记。
- 笔记工具包含搜索、读取、创建、改写、追加、属性和树操作；修改笔记内容前会保存 LLM 来源修订。

证据：

- [AI 用户指南](https://docs.triliumnotes.org/user-guide/llm)
- `apps/client/src/widgets/sidebar/SidebarChat.tsx`
- `apps/client/src/widgets/type_widgets/llm_chat/useLlmChat.ts`
- `apps/server/src/services/llm/tools/`

限制：

- 0.103.0 原生 Provider 仅有 OpenAI、Anthropic、Google Gemini。
- 该标签中的 OpenAI Provider 只接受 API key，没有自定义 base URL，因此不能把 DeepSeek/OpenAI-compatible 当作已具备能力。
- 上游人工智能功能仍标记为实验性，权限控制也不够细；ReadWeave 不能直接把“允许修改所有笔记”的默认工具集视为成熟产品权限模型。

### 右侧栏与扩展

- 自定义组件可挂载到 `left-pane`、`center-pane`、`note-detail-pane` 和 `right-pane`。
- 从 0.101.0 起可使用 Preact/JSX 自定义组件。
- 右侧栏有专用 `RightPanelWidget` 抽象。

证据：[Custom Widgets 用户指南](https://docs.triliumnotes.org/user-guide/scripts/frontend-basics/custom-widget)。

### 单一事实源与实时引用

- Trilium 的 clone 不是数据副本，而是同一笔记的多个树位置；任一位置修改会在所有位置生效。
- `Include Note` 可以把另一篇笔记嵌入文本笔记，显示的是被包含笔记当前内容。
- v0.103.0 支持跨笔记 Anchor，可定位到目标笔记内部的特定位置。
- 关系和内部链接可以表达规范对象、来源文章和引用位置之间的连接。

证据：

- [Cloning Notes](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)
- [Include Note](https://docs.triliumnotes.org/user-guide/note-types/text/include-note)
- [Anchors](https://docs.triliumnotes.org/user-guide/note-types/text/bookmarks)
- [Relations](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes/relations)

### 编辑器扩展

- Trilium 文本笔记使用 CKEditor 5。
- 上游已包含多个自研插件：内部链接、Include Note、Mermaid、Admonition、脚注、数学公式等。
- `Include Note` 通过 CKEditor 模型保存 `data-note-id`，证明“文章内保存引用标识符、渲染时读取索引对象”与现有技术栈一致。

证据：

- `packages/ckeditor5/src/plugins.ts`
- `packages/ckeditor5/src/plugins/includenote.ts`
- `apps/client/src/services/content_renderer_text.ts`

## 数据库与索引的关键发现

Trilium 的真相数据由 `notes`、`blobs`、`attributes`、`branches`、`revisions` 等表组成，并通过实体变更机制完成同步。

上游迁移历史中：

1. migration 230 曾把 `note_embeddings`、`embedding_queue`、`embedding_providers` 加进主 `document.db`；
2. migration 232 又将这三张表及同步实体全部删除；
3. migration 234 将旧 AI Chat 笔记迁移回普通 Code 笔记；
4. v0.103.0 再以新聊天系统重做 AI。

这说明把不可替代知识或关键状态绑在某一代向量或人工智能实现上风险很高。本规划据此采用：

- 已审核问答、术语、来源和标识符连接保存在 Trilium 原生实体中；
- 精确键和内容哈希只用于检索与一致性，不充当对象连接键；
- 全文或未来向量相似度索引是服务端派生数据，可随时删除并从索引对象重建；
- 模型升级、索引损坏或离线时，不影响索引对象的阅读、人工编辑、备份和导出。

证据：`apps/server/src/migrations/migrations.ts`。

## 许可证与发布约束

- 上游代码许可证为 `AGPL-3.0-only`。
- 任何发布、网络服务和源码提供方式都必须在正式开发前完成许可证合规核对。
- 产品命名、图标和品牌不应默认继承上游商标或造成官方版本混淆。

## DeepSeek 官方接口事实

- 截至 2026-07-14，DeepSeek 官方文档说明其接口兼容 OpenAI/Anthropic 格式，OpenAI 兼容服务地址为 `https://api.deepseek.com`。
- 官方文档当前列出的主要模型名称已与较早版本不同，并预告旧别名在 2026-07-24 停用。因此 ReadWeave 不能把某个模型名写死到代码、对象模式或导出语义。
- “兼容”不代表每项能力完全相同。流式、停止、结构化结果、用量、错误和思考模式都需要真实契约测试。
- 聊天中已经出现的密钥视为暴露；本规划没有把它写入仓库或测试配置，真实调用必须等待轮换后的服务端秘密。

证据：

- [DeepSeek API 首次调用](https://api-docs.deepseek.com/)
- [DeepSeek API 更新日志](https://api-docs.deepseek.com/updates/)

## 公开评测来源

首轮评测选择以下官方或一手来源，覆盖工程手册、协议、体系结构、论文、标准和中英文技术文档：

- [AMD Vivado Design Flows Overview UG892](https://docs.amd.com/r/en-US/ug892-vivado-design-flows-overview)
- [RFC 8446: The Transport Layer Security Protocol Version 1.3](https://www.rfc-editor.org/info/rfc8446)
- [RISC-V Unprivileged ISA Specification](https://docs.riscv.org/reference/isa/unpriv/unpriv-index.html)
- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [Python 中文语言参考：执行模型](https://docs.python.org/zh-cn/3/reference/executionmodel.html)
- [TriliumNext User Guide](https://docs.triliumnotes.org/user-guide/)

完整问题分层、指标和端到端场景见 [`09-EVALUATION-HARNESS.md`](../09-EVALUATION-HARNESS.md)。

## 尚待补齐的研究

- 登录后的旧 ReadLayer 功能与数据结构；它只影响废弃/保留分析，不阻塞新架构。
- 用户选择的至少 3 篇真实文章和本地私有回归问题。
- Trilium 原生 note/attribute/relation 在 1 千、1 万和 5 万连接下的性能与权限行为。
- 段落锚点在编辑、复制、拆分和合并后的真实编辑器行为。
- 轮换后 DeepSeek 密钥下的流式、停止、结构化结果、错误和当前模型契约。
- 服务端部署、备份目录和反向代理的最终环境；当前不研究跨设备同步和本地模型。
