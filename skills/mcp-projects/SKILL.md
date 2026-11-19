---
name: mcp-projects
description: Manage authorized project goals, work items and source references across research, engineering, marketing and support. 通过 Projects MCP 管理获授权项目的科研、工程、市场、支持工作及资料引用；不修改项目应用代码。
---

# Projects operations

English · [简体中文](#projects-业务操作)

One app manages multiple independent project records. Identify the exact space and `resourceId`. A project record requires no separate repository, service or interface. Research, engineering, marketing and support are work dimensions within the same project.

| Tool | When and how to use it |
| --- | --- |
| `projects_list` | Discover IDs, names and versions of readable projects. The result gives no information about inaccessible projects. |
| `projects_read` | Before making changes, read the project goal, work items, references and revision. |
| `projects_create` | On a request for a new project, create an authorized project ID. Reuse the existing app. |
| `projects_update` | Patch permitted fields such as name, goal, owner or status. Avoid whole-record replacement. |
| `projects_set_work_item` | Maintain the dimension, dependencies, acceptance criteria and status of one item. Dependencies must exist. Verify that prerequisites are satisfied before marking completion. |
| `projects_set_reference` | Link a stable Knowledge reading URL or HTTPS deliverable. The source remains in its owning app and its access rules still apply. |
| `projects_find_references` | Search by stable URL for references visible to the caller. Report results within that scope. |

For mutations, follow the discovered schema for current `expectedRevision` and intent-specific `idempotencyKey`. Reread on conflict and reassess. Confirm the intended item and reference by reading back. Report actual 400/403/409 errors. Do not claim an update when no tool ran or the save failed.

# Projects 业务操作

一套应用承载多个独立项目记录。先定位确切`resourceId`和空间，不为一个项目创建仓库、服务或新界面。科研、工程、市场、支持是同一项目内的协作维度。

| 工具 | 选择与操作 |
|---|---|
| `projects_list` | 只发现当前可读项目的 ID、名称和版本；不能推断不可见项目存在或可访问。 |
| `projects_read` | 修改前读当前目标、工作项、资料引用和修订号。 |
| `projects_create` | 仅在用户要求新项目时创建一个获授权的项目 ID；不复制另一项目的实现。 |
| `projects_update` | 修改给定名称、目标、负责人或状态等允许字段，不以整条 JSON 替换项目。 |
| `projects_set_work_item` | 维护一个工作项的维度、依赖、验收和状态；依赖引用须存在，未满足依赖不能直接宣称完成。 |
| `projects_set_reference` | 关联 Knowledge 的稳定阅读地址或 HTTPS 交付物；资料仍由原应用持有，不因引用而扩大访问权限。 |
| `projects_find_references` | 按稳定资料 URL 查找当前调用者可见的项目引用，不把结果当作全平台引用总数。 |

变更带当前`expectedRevision`和固定`idempotencyKey`，冲突回读后重新判断，不能盲目覆盖。回读验证目标工作项及引用，不改无关项目。400／403／409等错误按实际结果报告，未调用工具或保存失败不得宣称项目已更新。
