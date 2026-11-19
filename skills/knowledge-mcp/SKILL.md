---
name: knowledge-mcp
description: Work with authorized Knowledge libraries and cite the underlying sources. 在授权文库中管理资料和引用证据。
---

# Knowledge libraries

Start with `knowledge_list_libraries` to discover available libraries in the selected space. Use `knowledge_read_library` for the current revision and entry identifiers.

- Use `knowledge_search_evidence` to find candidate passages. Open the passages with `knowledge_read_document` and cite the source and location. Use `knowledge_search` for entry discovery.
- Before editing, inspect the current entry using `knowledge_read_entry` and its source using `knowledge_read_source`. Use the expected revision and idempotency key required by the operation.
- Use `knowledge_create_library` for an explicitly authorized new library, `knowledge_add_source` to record the source text, and `knowledge_set_entry` for a named entry. Organize existing entries with `knowledge_set_collection`.
- Use `knowledge_import_document` to import an authorized document for indexing and `knowledge_capture_project` to capture a permitted project. Use `knowledge_import_paper_statistics` to import a conference statistics snapshot. Read the result back in the target library.
- Apply bounded text edits with `knowledge_insert_document_text`, `knowledge_replace_document_text` or `knowledge_delete_document_text`. Verify the affected passage after each change.

## 简体中文

先列出当前空间允许访问的文库，再读取选定文库的版本和条目标识。回答问题时先检索证据，再回读原文并标明来源和位置。证据不足时说明缺口。导入文档、创建条目或修改段落要使用所选工具要求的版本和幂等键，完成后回读目标条目核对。导入项目资料或论文统计快照需要相应来源与目标文库的授权。

- 用 `knowledge_list_libraries` 发现有权限的文库，用 `knowledge_read_library` 获取最新版本和条目标识。
- 用 `knowledge_search_evidence` 检索原文段落，使用 `knowledge_read_document` 回读并引用位置。可用 `knowledge_search` 查找条目。
- 编辑前用 `knowledge_read_entry` 和 `knowledge_read_source` 检查条目与原文。`knowledge_create_library` 创建获准的新库，`knowledge_add_source` 保存来源，`knowledge_set_entry` 更新条目，`knowledge_set_collection` 整理现有条目。
- 用 `knowledge_import_document` 导入授权文档，用 `knowledge_capture_project` 采集指定项目，用 `knowledge_import_paper_statistics` 更新会议论文统计。操作完成后回读文库。
- 使用 `knowledge_insert_document_text`、`knowledge_replace_document_text` 或 `knowledge_delete_document_text` 修改指定段落，随后回读核对。
