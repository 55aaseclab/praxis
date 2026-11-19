# Praxis app standard / Praxis 应用标准

## English

### Design the app around the work and its result

Use the same model for built-in and independently built apps. Start with the result a person needs to read, watch or listen to. Define the business objects that hold that result and the typed, scoped actions an authorized agent can take to produce it. After intent, materials and authorization are in place, design routine execution for zero mandatory UI clicks. Give people a native view for using the result, checking evidence and making decisions. The built-in apps provide working examples of app-owned objects, operations and result views. [Product requirements](PRD.en.md)

Identify the checks the app or agent can perform automatically and the decisions that need a person. In the review view, show the result, relevant source or version, and the specific question. If the workflow sends reminders, let the employee review routine results at their preferred time and reserve immediate interruptions for blockers covered by a shared work rule. Direct each request to the person authorized to act.

An app can start with the records and workflow its owner needs, using external sources or services where useful. An AI coding agent can help build and maintain the app in a development environment. An agent operating business records uses a separate identity, environment and scoped business grant. Code and host access belong to development and platform administration.

An app owns its source, typed data and standalone entry. A maintained app has a named owner, PRD, roadmap, version, license, icon, English and Simplified Chinese interface, and documented storage/export and recovery behavior. Release the same function through the same renderer for every authorized record. Preserve content in its author's language. Write English controls, errors, accessibility labels and docs first. Ship their Chinese counterparts with the change. Use the saved `praxis.locale` preference (`en` or `zh`); the initial locale is English.

Managed entry permissions cover the HTML, scripts and app endpoints. Resource grants apply to every business read or write. Handle revoked access, transient failures, empty state, retry and navigation back. Gateway-managed pages receive the shared Home control at the bottom left. Keep controls above the safe area and reserve space for it. Verify an actual workbench → app → Home round trip at desktop and phone widths. Use synthetic data for writes. See the [UI/UX design guide](../skills/praxis-operator/references/ui-style-guide.en.md) and [first-release record](DOCKER.en.md#new-app-release-record).

### Run your own app locally

Use the manifest to preview the entry for an independently running app in your local workbench. The official registry keeps the English name and description in the default fields and the Chinese pair in `labels.zh`. The local manifest below supplies both languages and is normalized to the same launcher representation.

1. Serve your app separately, for example on `http://127.0.0.1:8000/`. Keep your private data and manifest outside the Praxis repository.
2. Save this JSON array as `~/my-praxis-apps.json`.

```json
[{
  "id": "lab-notes",
  "name": {"en": "Lab notes", "zh": "实验笔记"},
  "description": {"en": "My local notebook", "zh": "我的本地笔记"},
  "url": "http://127.0.0.1:8000/"
}]
```

3. In the Praxis checkout, run `npm ci`, then `npm run apps:dev -- ~/my-praxis-apps.json`. Open `http://127.0.0.1:4180/`. Your entry appears in that local workbench. Stop with Ctrl+C. The local launcher opens a separate loopback origin and grants no production session, data or agent tools.

### Integrate and deploy a managed app

Managed operation requires explicit registration and deployment, with the owning app's identity integration, resource grants and operation contracts configured as applicable. For agent-operated workflows, verify tool discovery, authorization, execution and readback using the app's scoped interfaces. See the [managed deployment guide](MANAGED-DEPLOYMENT.md) and [verification plan](VERIFICATION.en.md).

For inclusion in the maintained distribution, propose the app in an issue with a user task, screenshots in both languages, owner, license, data and permission contract, tests, and rollback. Maintainers review, register the app explicitly and perform the normal Docker release.

## 简体中文

### 围绕业务工作和结果设计应用

内置应用和自建应用遵循同一种设计思路。先明确人需要读、看或听到什么结果，再定义保存结果的业务对象，以及获授权的 agent 可以执行的类型明确、范围受控的操作。意图、材料与授权就绪后，日常执行以零次必需点击为设计目标。提供原生界面供人使用结果、查证和决策。内置应用是业务对象、操作和结果界面的参考实现。[产品需求](PRD.md)

明确哪些检查可以由应用或 agent 自动完成，哪些决定需要人来做。复核界面应同时展示结果、相关原文或版本，以及待判断的具体问题。如果流程发送提醒，例行结果由员工选择何时查看，只有符合团队约定的阻塞才即时打断。每项复核请求交给有权处理的人。

自建应用可以从自己需要的记录和流程出发，按需使用外部来源或服务。AI 编程智能体可以在开发环境中构建和维护应用。操作业务记录的 agent 使用独立的身份、环境和限定范围的业务授权。源码和宿主机访问权限属于开发与平台管理。

应用独立维护源码、类型化数据和独立入口。受维护应用需有负责人、PRD、路线图、版本、许可证、图标、英中界面及存储、导出和恢复说明。同类功能共用界面，用户内容保留原语言。先更新英文控件、错误、无障碍标签和文档，再在同一变更中同步中文。语言偏好使用 `praxis.locale` 中的 `en` 或 `zh`，首次默认英文。

受管入口对页面、资源和接口执行准入，业务访问另按资源逐次验权。提供撤权、暂时失败、空状态、重试和返回路径。受管页由网关注入左下角小房子，要给按钮和安全区留出空间。用桌面与手机宽度实际从工作台打开应用，再点小房子返回。写操作测试使用合成数据。设计和发布步骤见上方链接。

交互细则与首次发布的验收项目见 [UI/UX 设计指南](../skills/praxis-operator/references/ui-style-guide.md)和[新增应用首发记录](DOCKER.md#新增应用首发)。

### 本地开发自己的应用

用清单在本机工作台预览独立运行的应用入口。正式目录在默认名称和描述字段填写英文，`labels.zh` 填写中文。本地清单使用上方示例中的双语字段，启动时转换为相同的入口格式。

1. 在独立端口启动自己的应用，例如 `http://127.0.0.1:8000/`。私有数据和清单放在 Praxis 仓库之外。
2. 将上方示例保存为 `~/my-praxis-apps.json`，填写唯一 ID、英中名称和描述以及本机回环地址。
3. 在主仓运行 `npm ci` 和 `npm run apps:dev -- ~/my-praxis-apps.json`，打开 `http://127.0.0.1:4180/`。入口只出现在本地工作台，Ctrl+C 停止。它使用独立来源，且不会获得生产会话、数据或工具权限。

### 接入和部署受管应用

受管运行需要显式登记和部署，并按应用实际需要配置身份接入、资源授权和业务操作契约。由 agent 执行的流程还需通过应用的受控接口验证工具发现、授权、执行和回读。参见[受管部署指南](MANAGED-DEPLOYMENT.md)和[验证方案](VERIFICATION.md)。

如希望纳入受维护的发行版，用 Issue 提交用户任务、双语截图、负责人、许可证、数据与权限合同、测试和回滚说明。维护者评审、显式登记后再按标准 Docker 流程上线。
