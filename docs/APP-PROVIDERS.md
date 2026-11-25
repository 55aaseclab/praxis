# App providers / 应用供数合同

## English

The app owns its projection and data-source description. Praxis owns discovery, the card presentation, private display preferences and authorized aggregation. This version-1 contract supplies read-only workbench cards and the Settings data inventory. App operations, stored records and storage recovery keep their existing owners and authorization. [App standard](APP-STANDARD.md) · [Card design](design/workbench-cards.en.md) · [Authorization](BUSINESS-AUTH.en.md)

### Installed sources and execution

Each maintained app publishes a reviewed `praxis-provider.mjs` at its pinned public `main` revision. The platform loads the fixed installed source from the catalog. A local launcher manifest only adds an entry; it does not install a provider or grant access. This contract accepts no caller-supplied HTML, executable source or remote module URL.

| Source | Card execution | Data inventory |
| --- | --- | --- |
| Reminder, Knowledge, Travel, Projects, Memo, TingProof, Lattice | Server; existing signed, resource-filtered app reads | App-owned descriptors resolved against private configuration and runtime metadata |
| Intelligence | Server; explicitly configured, fixed native read routes | App-owned descriptors; the current permission granularity is the native view |
| Calendar, Matrix Reader | Current browser and native account/context | Browser, derived and external ownership metadata |
| Letters, Profiles | Current browser; existing protected native document reads | Server-resolved originals metadata, subject to administrator access |
| Polaris | Runtime classification; no workbench cards | Read-only runtime observation metadata |

There are thirteen card sources and fourteen inventory entries. A source can return a real empty state. An app's presence does not establish that it has records, an external account is connected or a device has exported its local data. Runtime lifecycle and workflow execution are outside this provider interface.

### Exports

| Export | Contract |
| --- | --- |
| `describe()` | Version, catalog `appId`, card support/execution, declared projection-read operations or native paths, and `dataSources` |
| `getCards(context)` | `{status, items, errors?}` containing authorized app-owned projections |
| `getDataInventory(context)` | `{status, items, errors?}` containing storage metadata resolved only from declared sources |

Provider statuses are `ready`, `empty`, `partial`, `unavailable` and `unsupported`. Keep successful items when an independent source fails and report partial coverage. Sanitize diagnostic codes; do not return credentials, request bodies or raw private errors. Do not label a failed read as empty.

An example descriptor follows. It declares a location, without reading a database or supplying a credential.

```js
export function describe() {
  return {
    version: 1,
    appId: 'projects',
    cards: { supported: true },
    readOperations: ['list_projects', 'read_project'],
    nativeReads: [],
    dataSources: [{
      id: 'database',
      label: 'Project records',
      labels: { zh: '项目记录' },
      kind: 'sqlite',
      location: { env: 'PROJECTS_DATA_DIR', relative: 'projects.db' },
    }],
  };
}
```

### Secure read contexts

The server supplies `spaces: string[]`, `actor: {userId, username}` and `invoke({spaceId, operation, resourceId?, input})`. The callback is bound to that app's adapter. The app declares the projection-read allowlist, and the host checks the effective native account, app entry, space, resource and operation before delivering data. Recheck authority after asynchronous reads. A projection-read declaration must exclude mutations and job-control side effects. A broad action label alone is not evidence that an operation has no side effects.

Lattice uses catalog ID `lattice-slides`, adapter ID `slides` and native `/apps/slides/` links. These identifiers have separate purposes. App-owned projections preserve their actual authorization resource even when several cards refer to different items within that resource.

Intelligence uses `resourceMode: 'native-view'`, a fixed `nativeResourceId` and declared `nativeReads`. The host's `readNative({path, resourceId})` requires an explicit `appProviders.<appId>.url` origin in private core configuration. An absent origin makes the source unavailable; the host must not guess a localhost production service. Calls use the configured origin, declared path and current native app access. These existing whole-view reads do not become fine-grained MCP grants.

Browser modules declare `cards.execution: 'browser'`. The host obtains an account-filtered manifest from `/api/workbench/providers` and imports only the matching reviewed `/app-providers/<appId>.mjs` module. It supplies `identity: {userId, username}` and a GET-only `read(path)` bound to the app's own same-origin native route. The target app still authorizes its records. Provider source is reviewed application code; these interfaces are not a sandbox for untrusted uploads.

Calendar device events are keyed to the native owner. Matrix cards use selected-room excerpts already readable in that browser, bound to the native account, Matrix account and allowed event context. The projection expires after fifteen minutes without a reader refresh. It contains no session token, encryption key or arbitrary SDK database dump. Owner changes, expired context and lost access must not reuse the preceding user's cards. Letters and Profiles retain the configured document-owner and native authorization checks. Browser-provider discovery uses the same gateway predicate as their native entry. Private core configuration sets `appProviders.letters.ownerId` and `appProviders.profiles.ownerId` to that same owner; Core combines it with the platform-administrator check for source placeholders and personal card preferences. The included initializer supplies this metadata without changing accounts or grants.

### Card data and native actions

The server attention endpoint is `GET /api/business/workbench/attention`. Its envelope is `{schemaVersion: 1, generatedAt, items, sources, partial}`. Browser sources merge into this view after their independent checks. Source entries identify `appId` and status; `browser` means the browser must supply that source, while `denied` differs from an unavailable backend.

| Card field | Meaning |
| --- | --- |
| `id`, `appId`, `resourceId`, optional `spaceId` | Stable app/object identity and the real authorization resource; group revisions of the same object |
| `revision` | Nonempty real version or stable source-content hash; never the refresh time |
| `kind` | `reminder`, `result` or `decision` |
| `title`, optional `preview` | Source-backed text in the author's language; omit absent context rather than inventing a brief |
| `reason` | Why this item is relevant, as a string or `{en, zh}` |
| `source.name` | The owning source shown to the reader |
| `primaryAction` | One localized label and the exact owning-app native `href` |
| `evidence` | Labeled source excerpts, versions and links, disclosed on demand |
| Optional `date`, `dueDate`, `updatedAt` | Valid source dates; `dueDate` normalizes to `date` while preserving its precision |

Primary links remain in the owning app's registered native route. Evidence can reference another application route or an HTTPS original without URL credentials. Opening a reference does not grant the target's resources. Reject executable/local-file schemes, protocol-relative URLs, encoded traversal and arbitrary module URLs. The platform does not fetch an evidence link on the user's behalf. Render source text as text rather than injected HTML.

Opening a card is navigation. It is not an approval, task acceptance, read receipt or record mutation. Existing consequential actions remain explicit operations in the native app, with their own validation, authorization, version checks and readback. TingProof assignment links open the native authorized-segment view; an assignment read grants neither whole-project access nor an audio download. Selecting local audio stays in that browser session without upload.

### Private presentation preferences

`GET` and `POST /api/business/workbench/preferences` use the current native session. Writes require same-origin CSRF. The request contains `cardId`, `cardRevision`, `state`, `expectedRevision`, `idempotencyKey`, and `until` for `later`. The caller cannot select another user. States are `visible`, `later` and `hidden`; the stored result has a monotonically checked preference revision.

Later is private until its chosen time and leaves the source date unchanged. Hide applies to that version. Undo returns a card to view. A stale preference revision returns 409, while an identical retry key has one effect and changed-input key reuse is rejected. Preferences survive reopening the store. Reading, hiding and review timing are not shared employee-performance records.

### Data locations and runtime metadata

Inventory descriptors name a source ID, label, kind and location. The resolver accepts only a descriptor declared by that app. Locations can use a non-secret data-location `env`, a relative child, a `spaces` path map, a literal artifact suffix, a native working directory, or a browser/source/derived/external declaration. `serviceRole: 'native'` selects the native binding when an app also has a business service. Do not use a signing-key or password variable as a location.

Inventory output includes label, kind, status and whichever location has evidence: `applicationPath`, `hostPath`, `containerPath`, `volumeName` or `storageKey`. An application path alone must not be relabeled as a host or container path. Preserve conflicts and unavailable bindings. Browser files and external homeserver history do not become server-backup coverage. These methods add no import, export, delete or restore controls. [Storage](STORAGE.en.md)

The default initializer records only data-path declarations from its existing installation layout and the app-owned descriptors. It explicitly configures the Intelligence origin. Its private `runtime.pathMaps[ENV]` contains only the configured space-to-path mapping. This is layout metadata, not an observed Docker mount or proof of backup success. For an installation created by the included Compose bootstrap, initialization fills missing provider metadata from its saved runtime configuration and layout, preserving existing overrides. It keeps a private exact rollback copy of core configuration; accounts, keys and records are not reinitialized. Other managed installations use their own reviewed origin/binding configuration.

For a host-managed deployment, the read-only metadata publisher can refresh actual running bindings:

```sh
node scripts/provider-runtime.mjs \
  --output /absolute/private/provider-runtime/runtime.json --watch 30
```

The worker selects services from installed providers before inspecting them. It emits only declared data-path variables, working directories and mount metadata. It omits raw environment, command arguments, keys and business bodies. Bindings retain native/business roles; conflicting values remain unknown. The output directory is mode 0700 and the atomic file mode 0600. Mount the directory read-only for the core and set `appProviderRuntimeFile` to its visible file path. This avoids a stale single-file bind after atomic replacement. Running this command does not install a service or change a business store.

### Release and verification

Publish app changes on their owning `main` first, then pin their publicly fetchable revisions in Praxis. Include provider sources in platform and native images after dependency installation. Preserve standalone app behavior. Lattice dependency declarations remain intact, while the image removes Remotion and HyperFrames after dependency installation and verifies their absence again after the normal build. No provider or packaging check runs video export.

Use synthetic records for provider, authorization and preference checks. Check a meaningful card or a genuine empty state for each source, native object navigation, owner/context changes, partial failure, invalid DTOs and private preference persistence. Verify the new runtime independently after deployment. Browser fixtures, a real external business client and a physical phone have different evidence scopes. [Verification plan](VERIFICATION.en.md)

## 简体中文

应用维护自己的投影和数据源描述，Praxis 负责发现、卡片展示、个人展示偏好与按权限聚合。版本 1 合同只提供工作台只读卡片和 Settings 数据清单，已有应用操作、业务记录及存储恢复继续遵循原归属与授权。[应用标准](APP-STANDARD.md) · [卡片设计](design/workbench-cards.md) · [业务授权](BUSINESS-AUTH.md)

### 已安装来源与执行位置

受维护应用在自己的公开 `main` 发布经审核的根目录 `praxis-provider.mjs`，平台从已安装目录及固定提交加载。本机 launcher 清单只增加入口，不会安装 provider 或授予权限。供数合同不接受调用者提交的 HTML、可执行源码或远程模块 URL。

| 来源 | 卡片执行 | 数据清单 |
| --- | --- | --- |
| Reminder、Knowledge、Travel、Projects、Memo、TingProof、Lattice | 服务端，使用已有签名及资源过滤读取 | 按应用描述和私有配置、运行元数据解析 |
| Intelligence | 服务端，显式配置的固定原生只读路径 | 应用描述；当前权限粒度是原生整视图 |
| Calendar、Matrix Reader | 当前浏览器及本人账户、阅读上下文 | 浏览器、派生与外部资料归属 |
| Letters、Profiles | 当前浏览器，已有受保护的原生文档读取 | 服务端解析原件位置，由管理员查看 |
| Polaris | 归为运行时，不生成工作台卡片 | 只读运行观察元数据 |

卡片共十三个来源，数据清单覆盖十四款应用。来源可以真正为空。应用存在不代表有业务记录、外部账户已连接或设备数据已导出。运行时生命周期与工作流执行不属于本接口。

### 导出函数

| 导出 | 合同 |
| --- | --- |
| `describe()` | 版本、正式目录 `appId`、卡片支持及执行位置、允许的投影读取操作或原生路径、`dataSources` |
| `getCards(context)` | `{status, items, errors?}`，只含应用提供的已授权投影 |
| `getDataInventory(context)` | `{status, items, errors?}`，只解析应用已声明的数据源元数据 |

状态为 `ready`、`empty`、`partial`、`unavailable`、`unsupported`。独立来源失败时保留成功项目并说明覆盖不足；诊断只返回安全类别，不泄露凭据、请求正文或私人错误。失败读取不能当作空态。

上方 Projects 示例声明数据库位置，不读取数据库或提供凭据。

### 安全读取上下文

服务端提供 `spaces`、`actor: {userId, username}` 及 `invoke({spaceId, operation, resourceId?, input})`。回调固定到所属应用适配器；应用声明投影读取允许列表，宿主在交付数据前检查当前原生账户、应用入口、空间、资源与操作。异步读取后再次验权。允许列表不得包含修改、作业控制或其他有副作用的操作，不能仅因动作标签为 read 就认定没有副作用。

Lattice 正式目录 ID 为 `lattice-slides`，适配器 ID 为 `slides`，原生路径为 `/apps/slides/`，三者用途不同。同一授权资源可包含多个卡片对象，投影仍保留真实授权资源。

Intelligence 声明 `resourceMode: 'native-view'`、固定 `nativeResourceId` 和 `nativeReads`。宿主 `readNative({path, resourceId})` 要求私有核心配置中显式提供 `appProviders.<appId>.url`。未配置时来源不可用，不默认访问宿主机的生产端口。调用限定到已配置 origin、声明路径及当前原生应用权限，已有整视图读取不冒充按记录委托的 MCP 能力。

浏览器模块声明 `cards.execution: 'browser'`。宿主从 `/api/workbench/providers` 取得按账户筛选的清单，只加载匹配的经审核 `/app-providers/<appId>.mjs`。上下文提供 `identity: {userId, username}` 和限 GET、同源、所属应用路径的 `read(path)`；记录仍由原应用验权。模块属于经审核的应用代码，这些接口不是不可信上传代码的沙箱。

Calendar 设备事件按原生用户分别存储。Matrix 卡片只使用当前浏览器已可读的选定房间片段，绑定原生账户、Matrix 账户及允许的事件上下文；阅读器十五分钟未刷新后投影到期，不含会话令牌、加密密钥或任意 SDK 存储。切换用户、上下文到期或失去权限时不复用上一人的卡片。Letters、Profiles 保留配置的文档所有者与原生身份检查，浏览器供数发现沿用原生入口的网关判定。私有核心配置的 `appProviders.letters.ownerId`、`appProviders.profiles.ownerId` 指向同一所有者，核心同时检查平台管理员身份，决定来源占位与个人卡片偏好的权限。内置初始化器补齐该元数据，不改变账号或授权。

### 卡片数据与原生操作

服务端 `GET /api/business/workbench/attention` 返回 `{schemaVersion: 1, generatedAt, items, sources, partial}`，浏览器来源独立核验后合并。来源包含 `appId` 和状态，`browser` 表示由浏览器补充，`denied` 与后端不可用分开。

| 字段 | 含义 |
| --- | --- |
| `id`、`appId`、`resourceId`、可选 `spaceId` | 稳定应用、对象身份及实际授权资源；同一对象的版本合并 |
| `revision` | 真实非空版本或稳定内容摘要，不使用刷新时间 |
| `kind` | `reminder`、`result`、`decision` |
| `title`、可选 `preview` | 作者原语言的来源文本；缺内容时不编造简报 |
| `reason` | 出现原因，字符串或 `{en, zh}` |
| `source.name` | 展示给读者的归属来源 |
| `primaryAction` | 一个本地化标签与所属应用准确原生 `href` |
| `evidence` | 按需展开的来源片段、版本与链接 |
| 可选 `date`、`dueDate`、`updatedAt` | 有效来源日期；`dueDate` 转为 `date`，保留原精度 |

主要链接限定到所属应用已登记原生路径。依据可引用另一应用或无 URL 凭据的 HTTPS 原件；打开引用不产生目标资源授权。拒绝可执行、本地文件协议、协议相对 URL、转义穿越及任意模块 URL。平台不代用户抓取依据链接，来源文字按文本呈现，不注入 HTML。

打开卡片只导航，不审批、不接受任务、不发送已读回执，也不修改记录。有后果的动作仍由原生应用显式执行并校验权限、版本和回读。TingProof 深链进入原生授权分段视图，任务读取不授予整项目访问或原始录音下载；本机录音只保留当前浏览器会话，不上传。

### 私人展示偏好

`GET`、`POST /api/business/workbench/preferences` 使用当前原生会话，写请求要求同源 CSRF。请求包含 `cardId`、`cardRevision`、`state`、`expectedRevision`、`idempotencyKey`，稍后查看另带 `until`；调用者不能指定其他用户。状态为 `visible`、`later`、`hidden`，保存时核对本人偏好版本。

稍后看只影响本人到指定时间前的展示，原定日期不变；隐藏只针对该版本，撤销可放回卡片。过期偏好版本返回 409，相同幂等键重试只有一次效果，修改输入后复用同键被拒绝。偏好重开存储后保留，阅读、隐藏和复核时间不成为团队员工绩效记录。

### 数据位置与运行元数据

数据源声明 ID、标签、种类与位置，解析器只接受应用已声明的描述。位置可以是非密钥的数据路径 `env`、相对子路径、`spaces` 路径映射、固定产物后缀、原生工作目录，以及浏览器、源码、派生或外部来源。应用同时有业务服务时，`serviceRole: 'native'` 选择原生绑定；不可用签名密钥或密码变量充当数据位置。

清单返回标签、种类、状态以及有依据的位置，如 `applicationPath`、`hostPath`、`containerPath`、`volumeName`、`storageKey`。应用内路径不冒充宿主机或容器路径，冲突与缺失绑定如实保留。浏览器文件、外部 homeserver 历史不冒充服务端备份覆盖。本接口不增加导入、导出、删除或恢复控件。[存储合同](STORAGE.md)

默认初始化器只从既有安装布局和应用描述记录数据位置，显式配置 Intelligence origin。私有 `runtime.pathMaps[ENV]` 只包含已配置的空间到路径映射，属于布局元数据，不代表已观察 Docker 挂载或备份成功。由内置 Compose 初始化的安装会依据已保存的运行配置与布局补齐缺失的 provider 元数据，保留已有覆盖项，并保存核心配置的私有原样回滚副本；不重建账号、密钥或业务记录。其他受管安装按自己的环境明确配置 origin 与绑定。

宿主机部署可使用上方 `scripts/provider-runtime.mjs --output ... --watch 30` 命令刷新实际运行绑定。工作器先按已安装应用筛选服务，再读取声明的数据路径变量、工作目录与挂载元数据；不输出全环境、命令参数、密钥或业务正文。绑定保留 native/business 角色，值冲突时记为 unknown。输出目录权限 0700、原子文件权限 0600；核心以只读目录挂载，`appProviderRuntimeFile` 指向核心可见路径，避免原子替换后单文件挂载仍指向旧 inode。运行命令本身不安装系统服务，也不改变业务存储。

### 发布与验证

应用先在所属 `main` 发布，再由 Praxis 固定可公开获取的提交。平台与原生镜像在依赖安装后包含 provider 源码，独立应用原有功能保留。Lattice 依赖声明不变，镜像安装依赖后移除 Remotion、HyperFrames，普通构建结束后再次核验不存在；供数和打包检查不运行视频导出。

使用合成记录验证每个来源的有用卡片或真实空态、原生对象导航、用户与上下文切换、部分失败、非法 DTO 和个人偏好持久化。部署后另验真实入口。浏览器夹具、真实外部业务客户端和实体手机各有独立证据范围。[验证方案](VERIFICATION.md)
