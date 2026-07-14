# ReadWeave（织读）索引导出规范

> 版本：1.0
> 日期：2026-07-14
> 模式文件：[`schemas/readweave-index-export.schema.json`](./schemas/readweave-index-export.schema.json)

## 1. 目的

该导出与普通文章导出分开，专门保存“文章—段落锚点—问答/术语对象”的连接。它用于：

- 离线审计问题与原文位置的对应关系；
- 在其他工具中构建索引或未来知识图谱；
- 检查备份恢复后的引用完整性；
- 未来在不依赖对象名称的情况下交换数据。

它不是数据库快照，也不替代 Trilium 原生备份。

## 2. 顶层内容

| 字段 | 含义 |
|---|---|
| `schemaVersion` | 导出协议版本，首版为 `1.0` |
| `exportId` | 本次导出的唯一标识符 |
| `exportedAt` | 生成时间，采用 ISO 8601（国际标准化组织 8601 日期时间格式，International Organization for Standardization 8601 Date and Time Format） |
| `generator` | ReadWeave 版本、源 Trilium 版本和工作流版本 |
| `scope` | 全库或指定文章集合；1.0 固定包含已审核正文 |
| `articles` | 文章标识符和可选标题 |
| `anchors` | 稳定段落锚点、选择器和可选原文摘要 |
| `objects` | 已审核问答或术语定义 |
| `links` | 文章锚点到对象的标识符连接和显示设置 |
| `integrity` | 记录数、校验状态和内容摘要 |

## 3. 必须保持的语义

1. `objectId`、`articleId`、`anchorId`、`linkId` 是连接真相；标题和名称不是外键。
2. 每个 `link.objectId` 必须能解析到本导出的 `objects`，除非范围明确允许外部对象引用。
3. 每个 `link.anchorId` 必须能解析到同一 `articleId` 下的 `anchors`。
4. 同名术语保留为不同对象，不自动合并。
5. 对象只导出当前已审核修订；可选 `revisionHistory` 必须由未来次版本单独定义。
6. “只改显示”字段保存在连接内，不得覆盖对象正文。
7. 草稿检查点、服务密钥、派生向量和模型内部推理不进入导出。

## 4. 隐私与权限

- 导出前按当前 Trilium 用户权限过滤文章、对象和连接。
- 若用户不能读取对象，不导出它的标题、答案、摘要或来源。
- 1.0 的 `scope.includeContent` 固定为 `true`；仅标识符导出留给后续协议版本。
- 当前文章导出由文章侧栏单独触发，不混入普通文章导出。
- 生成的文件可能包含敏感学习内容，界面必须提醒用户自行保护。

## 5. 完整性校验

导出完成需依次执行：

1. JSON 语法校验；
2. JSON Schema（JSON 模式，JSON Schema）结构校验；
3. 标识符唯一性校验；
4. 连接外键校验；
5. 锚点与文章一致性校验；
6. 对象类型字段校验；
7. 术语显示格式校验；
8. 禁止字段和秘密模式扫描；
9. 规范化内容的 SHA-256（安全散列算法 256 位，Secure Hash Algorithm 256-bit）摘要校验。

`integrity.valid` 只有在全部校验通过后才为 `true`。失败导出可以留作诊断，但文件名和界面必须明确标记无效，不能用于恢复或交换。

## 6. 导入边界

首发只承诺导出，不承诺直接导入。未来导入必须单独设计：

- 标识符冲突和来源库标识；
- 对象已存在时的修订合并；
- 锚点在目标文章不存在时的处理；
- 权限不匹配；
- 预览、应用、回滚和重复执行。

不得把“有导出文件”误解为已经完成安全导入。

## 7. 最小示例

```json
{
  "schemaVersion": "1.0",
  "exportId": "exp_01J00000000000000000000000",
  "exportedAt": "2026-07-14T08:00:00.000Z",
  "generator": {
    "name": "ReadWeave",
    "version": "0.1.0",
    "triliumVersion": "0.103.0",
    "workflowVersion": "context-v1"
  },
  "scope": {
    "type": "articles",
    "articleIds": ["article_1"],
    "includeContent": true
  },
  "articles": [
    { "articleId": "article_1", "title": "示例文章" }
  ],
  "anchors": [
    {
      "anchorId": "anchor_1",
      "articleId": "article_1",
      "selector": { "type": "readweave-paragraph-v1", "value": "anchor_1" },
      "excerpt": "示例原文段落"
    }
  ],
  "objects": [
    {
      "objectId": "object_1",
      "schemaVersion": "1.0",
      "kind": "question",
      "title": "这段话的核心限制是什么？",
      "body": "已审核答案",
      "normalizedTitle": "这段话的核心限制是什么",
      "revision": 1,
      "sourceArticleId": "article_1",
      "sourceAnchorId": "anchor_1",
      "sourceExcerpt": "示例原文段落",
      "createdAt": "2026-07-14T07:55:00.000Z",
      "updatedAt": "2026-07-14T07:55:00.000Z"
    }
  ],
  "links": [
    {
      "linkId": "link_1",
      "schemaVersion": "1.0",
      "articleId": "article_1",
      "anchorId": "anchor_1",
      "objectId": "object_1",
      "sourceExcerpt": "示例原文段落",
      "createdAt": "2026-07-14T07:55:00.000Z",
      "updatedAt": "2026-07-14T07:55:00.000Z"
    }
  ],
  "integrity": {
    "valid": true,
    "articleCount": 1,
    "anchorCount": 1,
    "objectCount": 1,
    "linkCount": 1,
    "contentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```
