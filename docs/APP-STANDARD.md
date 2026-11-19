# Praxis app standard / Praxis 应用标准

## English

### Design the app around the work and its result

Use the same model for built-in and independently built apps. Start with the result a person needs to read, watch or listen to. Define the business objects that hold that result and the typed, scoped actions an authorized agent can take to produce it. After intent, materials and authorization are in place, design routine execution for zero mandatory UI clicks. Give people a native view for using the result, checking evidence and making decisions. The built-in apps provide working examples of app-owned objects, operations and result views. [Product requirements](PRD.en.md)

Identify the checks the app or agent can perform automatically and the decisions that need a person. In the review view, show the result, relevant source or version, and the specific question. If the workflow sends reminders, let the employee review routine results at their preferred time and reserve immediate interruptions for blockers covered by a shared work rule. Direct each request to the person authorized to act.

An app can start with the records and workflow its owner needs, using external sources or services where useful. An AI coding agent can help build and maintain the app in a development environment. An agent operating business records uses a separate identity, environment and scoped business grant. Code and host access belong to development and platform administration.

An app owns its source, typed data and standalone entry. A maintained app has a named owner, PRD, roadmap, version, license, icon, English and Simplified Chinese interface, and documented storage/export and recovery behavior. Release the same function through the same renderer for every authorized record. Preserve content in its author's language. Write English controls, errors, accessibility labels and docs first. Ship their Chinese counterparts with the change. Use the saved `praxis.locale` preference (`en` or `zh`); the initial locale is English.

Managed entry permissions cover the HTML, scripts and app endpoints. Resource grants apply to every business read or write. Handle revoked access, transient failures, empty state, retry and navigation back. Gateway-managed pages receive the shared Home control at the bottom left. Keep controls above the safe area and reserve space for it. Verify an actual workbench → app → Home round trip at desktop and phone widths. Use synthetic data for writes. See the [UI/UX design guide](../skills/praxis-operator/references/ui-style-guide.en.md) and [first-release record](DOCKER.en.md#new-app-release-record).

### Supply read-only workbench cards

Maintain a reviewed `praxis-provider.mjs` at the app repository root. Its version-1 `describe`, `getCards` and `getDataInventory` exports own the card projection and storage descriptors; Praxis discovers them from the installed catalog. The current distribution has thirteen card sources. Polaris is classified as a runtime component and supplies inventory metadata, without contributing workbench cards. All fourteen apps remain in the data inventory. [Provider contract](APP-PROVIDERS.md#english)

Cards represent an authorized result or question with stable object identity, a real revision or stable content hash, a concrete title, its source and reason, an optional source-backed preview, and evidence. The primary action opens the exact object in its own native app. Source references can lead to another registered app or an HTTPS original, whose own access rules still apply. Missing text must stay missing. Group updates to one object, report partial failures and distinguish a true empty source from an unavailable or unsupported source. Follow the [card interaction design](design/workbench-cards.en.md).

Server projections use bound, authorized read callbacks. Browser projections use the current native identity and app-owned reading or device state. Keep browser data bound to its owner and current reader context; do not copy session credentials, Matrix keys or other protected stores into a workbench projection. Browser-native HTTP and external-agent MCP remain separate authenticated entries to app-owned semantics. MCP does not render the workbench. Reading, Later, Hide and Undo affect personal presentation, leaving the source deadline, assignment, approval and completion unchanged.

### Describe data in Settings

Declare data sources in the same provider, including server records, browser-only data, originals and externally owned material where applicable. The Settings inventory is read-only. It follows installed app descriptors and verified runtime bindings rather than a manually maintained app table. Personal display preferences remain separate from administrator-only physical path and storage metadata.

Preserve `applicationPath` when only the app namespace is known. Report host paths, container paths and volume names only from verified bindings. Identify missing configuration, conflicts and browser/export omissions honestly. Descriptors and inventory contain metadata rather than business bodies, tokens, signing keys or recovery material. This provider contract adds no record creation, import, export, deletion, backup or restore operation; those remain governed by their owning app and the [storage contract](STORAGE.en.md).

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

For inclusion in the maintained distribution, document the user task, screenshots in both languages, owner, license, data and permission contract, tests, and rollback. Administrators and maintainers can register, verify and publish the app directly within existing authorization. External contributors propose the app in an issue and submit it for maintainer review. Follow the normal Docker release and [contribution workflow](../CONTRIBUTING.md).

## 简体中文

### 围绕业务工作和结果设计应用

内置应用和自建应用遵循同一种设计思路。先明确人需要读、看或听到什么结果，再定义保存结果的业务对象，以及获授权的 agent 可以执行的类型明确、范围受控的操作。意图、材料与授权就绪后，日常执行以零次必需点击为设计目标。提供原生界面供人使用结果、查证和决策。内置应用是业务对象、操作和结果界面的参考实现。[产品需求](PRD.md)

明确哪些检查可以由应用或 agent 自动完成，哪些决定需要人来做。复核界面应同时展示结果、相关原文或版本，以及待判断的具体问题。如果流程发送提醒，例行结果由员工选择何时查看，只有符合团队约定的阻塞才即时打断。每项复核请求交给有权处理的人。

自建应用可以从自己需要的记录和流程出发，按需使用外部来源或服务。AI 编程智能体可以在开发环境中构建和维护应用。操作业务记录的 agent 使用独立的身份、环境和限定范围的业务授权。源码和宿主机访问权限属于开发与平台管理。

应用独立维护源码、类型化数据和独立入口。受维护应用需有负责人、PRD、路线图、版本、许可证、图标、英中界面及存储、导出和恢复说明。同类功能共用界面，用户内容保留原语言。先更新英文控件、错误、无障碍标签和文档，再在同一变更中同步中文。语言偏好使用 `praxis.locale` 中的 `en` 或 `zh`，首次默认英文。

受管入口对页面、资源和接口执行准入，业务访问另按资源逐次验权。提供撤权、暂时失败、空状态、重试和返回路径。受管页由网关注入左下角小房子，要给按钮和安全区留出空间。用桌面与手机宽度实际从工作台打开应用，再点小房子返回。写操作测试使用合成数据。设计和发布步骤见上方链接。

交互细则与首次发布的验收项目见 [UI/UX 设计指南](../skills/praxis-operator/references/ui-style-guide.md)和[新增应用首发记录](DOCKER.md#新增应用首发)。

### 提供只读工作台卡片

在应用仓库根目录维护经审核的 `praxis-provider.mjs`，通过版本 1 的 `describe`、`getCards`、`getDataInventory` 导出应用自己的卡片投影与存储描述；Praxis 从已安装目录发现这些合同。当前发行版有十三个卡片来源。Polaris 归为运行时组件，仅提供数据清单元数据，不生成工作台卡片；十四款应用均保留在数据清单中。[供数合同](APP-PROVIDERS.md#简体中文)

卡片展示一个获授权的结果或问题，包含稳定对象身份、真实版本或稳定内容摘要、具体标题、来源和出现原因、可选的原文预览及依据。主要操作进入所属应用的准确原生对象。来源引用可以进入另一已登记应用或 HTTPS 原件，目标仍按自己的规则验权。缺少原文时不生成替代简报。同一对象更新合并，明确说明部分失败，区分真正空态、不可用与不支持。交互遵循[卡片设计](design/workbench-cards.md)。

服务端投影使用限定范围的已授权只读回调；浏览器投影使用当前原生身份以及应用已有阅读状态或设备数据。浏览器数据绑定本人及当前阅读上下文，不把会话凭据、Matrix 密钥或其他受保护存储复制到工作台投影。原生 HTTP 与外部智能体 MCP 分别认证，调用应用自己的业务语义；MCP 不负责渲染工作台。阅读、稍后看、隐藏与撤销只改变本人展示，不修改来源截止时间、分配、审批或完成状态。

### 在 Settings 中说明数据

在同一 provider 中声明数据来源，按实际情况包括服务端记录、浏览器独有数据、原件和外部服务保存的材料。Settings 数据清单只读，跟随已安装应用合同与核验后的运行绑定变化，不依赖人工逐项维护应用总表。个人展示偏好与管理员可见的物理路径、存储元数据分开。

只知道应用内位置时保留 `applicationPath`；宿主机路径、容器路径和卷名必须有已核验的绑定。准确说明未配置、冲突以及尚未导出的浏览器数据等覆盖缺口。描述与清单只包含元数据，不含业务正文、令牌、签名密钥或恢复材料。本供数合同不新增创建记录、导入、导出、删除、备份或恢复操作，相关能力继续遵循所属应用及[存储合同](STORAGE.md)。

### 本地开发自己的应用

用清单在本机工作台预览独立运行的应用入口。正式目录在默认名称和描述字段填写英文，`labels.zh` 填写中文。本地清单使用上方示例中的双语字段，启动时转换为相同的入口格式。

1. 在独立端口启动自己的应用，例如 `http://127.0.0.1:8000/`。私有数据和清单放在 Praxis 仓库之外。
2. 将上方示例保存为 `~/my-praxis-apps.json`，填写唯一 ID、英中名称和描述以及本机回环地址。
3. 在主仓运行 `npm ci` 和 `npm run apps:dev -- ~/my-praxis-apps.json`，打开 `http://127.0.0.1:4180/`。入口只出现在本地工作台，Ctrl+C 停止。它使用独立来源，且不会获得生产会话、数据或工具权限。

### 接入和部署受管应用

受管运行需要显式登记和部署，并按应用实际需要配置身份接入、资源授权和业务操作契约。由 agent 执行的流程还需通过应用的受控接口验证工具发现、授权、执行和回读。参见[受管部署指南](MANAGED-DEPLOYMENT.md)和[验证方案](VERIFICATION.md)。

纳入维护发行版时，记录用户任务、中英文截图、负责人、许可证、数据与权限合同、测试和回滚方案。管理员和 maintainer 可在已有授权范围直接登记、验证并发布；外部贡献者先开 issue 提议，再提交给 maintainer 评审。遵循正常 Docker 发布流程和[贡献规范](../CONTRIBUTING.md#简体中文)。
