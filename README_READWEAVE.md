# ReadWeave（织读）

ReadWeave 是基于 TriliumNext `v0.103.0` 的个人 Web 阅读工作流修改版。它不替用户猜问题，而是在用户选中段落并主动提问后，自动完成上下文整理、联网回答、人工审核、知识复用和格式化保存。

## 当前核心流程

1. 在文本笔记中把鼠标移到段落上并点击，选择完整段落。
2. 在右侧 ReadWeave 面板输入一个问题或术语。
3. 服务端从当前文章选择最小充分上下文，并调用 DeepSeek。
4. 回答先留在当前浏览器会话中；只有点击“已审核并保存”才写入 Trilium。
5. 相似对象会突出“复用”，同时始终允许新建或创建本文变体。
6. 修改已有对象前先查看影响范围，再选择全局修改、本文变体或只改显示。
7. 当前文章可导出文章、锚点、对象和连接，并附带完整性摘要。

## 安全配置

真实密钥只配置在运行 Web 服务的服务端环境中。复制 [`.env.example`](./.env.example) 的变量名并在部署环境赋值，不要把真实值写入任何仓库文件、笔记、截图或聊天记录。

```text
READWEAVE_DEEPSEEK_API_KEY=<server-only-key>
READWEAVE_DEEPSEEK_MODEL=deepseek-chat
```

曾经通过聊天或其他公开渠道传递的密钥必须先在提供方控制台吊销，再创建新密钥。

## 验证与文档

- [产品与实现总览](./docs/readlayer/README.md)
- [当前实现和验收状态](./docs/readlayer/10-IMPLEMENTATION-STATUS.md)
- [全量需求追溯清单](./docs/readlayer/05-TRACEABILITY-CHECKLIST.md)
- [独立索引导出协议](./docs/readlayer/08-INDEX-EXPORT.md)

开发和测试必须使用匿名隔离数据库。第一次连接日常数据库前，先在完整副本上完成升级、备份和恢复演练。
