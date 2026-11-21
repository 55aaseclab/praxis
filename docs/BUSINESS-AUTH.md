# Praxis 业务身份、授权与 OAuth

[English](BUSINESS-AUTH.en.md) · 简体中文

本文说明首批业务权限实现。平台维护、业务使用继续分离；该模块不提供代码、文件、命令、部署或备份工具。本文与合成测试通过，均不能代替真实 Paseo Codex 隔离验收或物理手机 App 验收。

## 1. 模块与持久化

`src/business/auth.mjs` 提供 `AuthStore` 和 `createAuthHandler`。使用 Node 内置 SQLite，无额外身份服务依赖。身份数据库应位于 Git 外私有目录；文件权限600，包含密码派生值、授权规则、凭据摘要及脱敏审计，不能提交或作为业务工具返回。

构造参数为 `{ file, issuer, clock? }`；`clock` 仅用于隔离合成测试。生产 `issuer` 必须是明确的 HTTPS URL；仅回环地址允许 HTTP 开发使用。`Host`、转发头和模型输入不能改变 issuer、资源 audience 或允许的浏览器来源。

公开 `POST /auth/register` 以原子操作为新身份创建且仅创建一个本人拥有的个人空间，在创建时记录自动来源标记。配置保持幂等，运维已配置的个人空间保留且不重复创建。自动空间初始不启用应用、不授予资源权限；用户本人及平台管理员均不可删除。用户额外创建的个人空间不受自动来源保护。注册校验、限流、响应字段及独立登录保持不变。

OAuth 资源标识为 `${issuer}/mcp`。部署代理须将下列协议和登录路径路由到同一个授权服务；公开元数据只公开协议结构，不包含私人记录。已有网关 owner 登录墙不能要求 MCP 客户端取得 owner 口令。

## 2. 权限求交

每次请求重新计算：

`用户当前资源权限 ∩ 当前客户端委托 ∩ 指定空间、资源、动作、期限`

正式 Praxis 网关开启时，还须与已安装审核目录、已实现适配器操作及当前空间应用启用策略求交。未显式设置运行时启用策略的空间，继续使用管理员逐用户入口与静态应用/空间范围；owner 显式设置的启用策略替代本空间静态范围，无须另设逐用户入口，但仍须资源/操作授权。网页入口本身不会创建业务资源权限；应用收权、到期和适配器范围收窄同样限制已有OAuth委托、授权码及刷新。独立业务服务保留自身显式授权契约。

- 个人、家庭和公司（团队）为独立业务空间；家庭成员关系不授予任何成员的个人资料。
- 空间 owner/admin 可以在本空间内委托业务能力；这不产生平台代码或主机权限。
- 普通成员需要明确的资源授权。外部协作者可在无成员关系的情况下取得指定资源授权，禁止 `*` 全空间范围。
- 个人空间不能加入其他成员；仍可通过有界 guest 授权明确分享指定资源，默认私有，不能通过成员关系批量开放。
- 成员退出会移除既有客户端委托中的该空间片段，并删除依赖成员关系的权限；重新加入不会复活旧范围。其他个人/组织空间的委托保持。
- 授权撤销、资源收权、用户停用和到期在后续请求即时生效。事件分发和后台执行须继续调用同一校验，不能缓存最初的允许结果。
- 通用创建操作需要匹配的创建规则；限定创建接口以各自明确的资源范围为准。指定既有任务权限不能被用来创建其他任务。

首批动作：

| 应用 | 动作 |
|---|---|
| Reminder | `read`、`create`、`update`、`complete`、`delete` |
| TingProof | `read`、`submit`、`assign` |
| 空间管理 | `manage_members`、`manage_sharing`、`manage_delegation`，要求当前 owner/admin 关系及独立客户端委托 |

`resources` 使用 `['*']` 或不透明资源 ID 数组。列表返回必须继续按授权结果中的资源范围过滤；能够调用列表不代表可以读取全库。

## 3. 维护侧接口

以下是受信任维护/配置接口，不直接暴露为普通业务 MCP 工具。维护代理不借这些接口写入真实应用记录。

| 接口 | 作用 |
|---|---|
| `createUser({id?, username, password})` | 创建身份；密码通过随机盐 scrypt 派生，最少12字符 |
| `createSpace({id?, type, ownerId})` | 创建个人/家庭/公司空间及 owner 关系 |
| `setMembership({spaceId, userId, role})` | 设置 `admin`/`member`，`null` 移除成员；保护 owner |
| `grantResource({userId, spaceId, appId, resources, actions, expiresAt?})` | 明确用户资源权限；guest 默认七天，必须限定资源 |
| `revokeResource(id)` | 撤销资源授权 |
| `createClient({id?, name, redirectUris})` | 注册客户端；重定向精确匹配，HTTPS 或 HTTP 回环地址 |
| `createGrant({userId, clientId, rules, expiresAt?})` | 建立用户明确委托；不能超过用户当前权限，最长30天 |
| `issueToken({grantId, ttlSeconds?})` | 生成绑定委托的短期访问凭据，最长一小时 |
| `revokeGrant(id)` | 撤销委托及其访问/刷新凭据 |
| `setUserEnabled(userId, enabled)` | 停用时撤销原会话和委托，重新启用不复活；保护最后一名启用平台管理员 |
| `setPlatformAdmin({userId, enabled})` | 显式授予/收回平台管理角色，与入口、空间和业务范围独立；保护最后一名启用管理员 |

token 原值只在签发返回中出现，数据库保存 SHA-256 摘要；密码和 token 不写审计。刷新 token 轮换；旧刷新 token 重用会撤销整个委托，不能通过重启恢复权限。

## 4. 服务侧接口

`credentialFromRequest(request)` 优先读取 Bearer；没有 Authorization 才读取 HttpOnly session cookie。畸形 Authorization 不回退 cookie，重复同名 cookie 被拒绝。

- `authenticate(credential)`：返回可信 `{userId, clientId, grantId, expiresAt}`。
- `authorize(credential, {appId, spaceId, action, resourceId?})`：返回上述身份及 `{appId, spaceId, resources, actions}`；拒绝使用英文 `AuthError` 的 `status/code`。
- `listSpaces(credential)`：只返回该委托当前仍可访问的空间及关系。
- `requireRequestCsrf(request)`：浏览器 cookie 写请求同时检查 Origin 和 `X-CSRF-Token`；独立 Bearer 客户端仍须业务验权。
- `onChange(listener)` 与 `policyVersion`：提供当前进程的权限变化通知及持久版本。跨进程订阅须轮询版本或在每次交付时重新验权。
- `audit(metadata)`：只保存动作、结果、原因类别和带密钥伪名，不保存业务正文、原始标识、请求头和凭据。
- `withPolicyLease(async callback)`：取得 SQLite `BEGIN IMMEDIATE` 策略锁，待异步业务执行真正结束后提交或回滚。其他连接的权限变更须等待，锁超时明确返回503 `POLICY_BUSY`，不能假报撤销成功。

最终业务变更、幂等结果及记录版本仍由 owning app 的事务/可靠日志保证。身份数据库不是第二份应用业务事实源。

策略收权采用明确的线性化顺序：已接受的在途动作先完成或按应用提交期限结束，再提交撤销；撤销响应成功后，旧授权不能再提交动作。平台层须将业务执行与权限管理放入同一串行门禁，并在应用实际提交前验证签名执行期限。HTTP 取消本身不能证明远端已停止执行；不得通过提前释放策略锁或只等 token 过期冒充该保证。

## 4.1 空间管理员的受控业务管理

空间管理是普通业务能力，不能要求家庭/团队管理员操作代码或维护数据库。它使用相同的身份、客户端委托和服务端权限求交，单独提供以下入口：

| 路径与方法 | 能力与限制 |
|---|---|
| `GET /api/business/management/spaces/:spaceId/members` | 列本空间成员关系，不列其他空间或密码 |
| `PUT .../members/:userId` | 以明确身份 ID 添加/修改本空间 member/admin，不允许 owner/platform 角色或越空间提升 |
| `DELETE .../members/:userId` | 移除成员及该空间委托，保护 owner，保留其他空间的授权 |
| `GET/POST .../permissions` | 列举/建立本空间具体应用资源共享；guest 必须限定资源，不能借共享制造管理角色 |
| `DELETE .../permissions/:permissionId` | 撤销本空间资源共享，其他空间的权限 ID 无效 |
| `GET .../delegations` | 只列委托中属于本空间的片段 |
| `DELETE .../delegations/:grantId` | 撤销该空间片段，保留同一委托中其他空间的规则 |

三个管理动作必须另外明确授权；普通 Reminder/TingProof 读写委托不包含管理权。角色与委托缺一即拒绝。管理接口不替其他用户签发 token，也不能创建平台管理员；用户为外部客户端建立委托仍通过本人登录及明确 consent。cookie 写请求继续检查 Origin 和 CSRF，管理变更仅记录脱敏审计。

## 4.2 公开自助空间生命周期

所有已登录原生用户均可从工作台空间入口及「设置 → 空间」进入。创建接受个人/家庭/团队类型（团队存储类型为 `company`），owner 从当前会话确定，不创建资源权限或委托。下列本人接口中，仅 owner 可编辑应用启用策略、其他成员及权限，成员可通过下述专用接口退出本人的非个人空间；创建者删除本人没有自动个人来源保护的空间无额外角色门槛；平台管理员通过同一接口删除任意此类空间，包括用户创建的个人空间。成员只能读取所属空间中获准的详情，不获得无关账号或权限；平台管理员可为删除列出并查看所有空间，不因此获得 owner 专属修改权限。接口不授予平台管理权，也不替他人签发凭据。

以下路径相对 `/api/business/account/spaces`：

| 请求 | 请求体或结果 |
| --- | --- |
| `GET /` | 本人空间（平台管理员为所有空间）及部署已安装审核应用目录：`{spaces,catalog}`；每个空间包含 `canDelete`，非成员管理员的 `role:null`。 |
| `POST /` | `{type}`；创建当前原生会话用户拥有的空间。 |
| `GET /:spaceId` | 有界 `{space,apps,members,permissions}`，含 `space.canDelete` 和 `space.deletionProtected`；成员仅收到获准详情，平台管理员可为删除查看空间。 |
| `DELETE /:spaceId` | `{confirmSpaceId}` 必须与路径 ID 完全一致；创建者或平台管理员删除没有自动个人来源保护的空间。缺失／错误确认、未知字段及仅加入成员请求均拒绝。 |
| `POST /:spaceId/leave` | 无请求体字段（允许空对象）；仅移除当前原生会话本人的非个人空间成员关系。所有者退出返回 HTTP 409 `OWNER_REQUIRED`；个人空间及非成员不可退出。 |
| `PUT /:spaceId/apps/:appId` | `{enabled}`；owner 为本空间启用或停用目录应用。 |
| `POST /:spaceId/members` | `{username,role:'member'}`；owner 添加已有账号，个人空间拒绝其他成员。 |
| `DELETE /:spaceId/members/:userId` | owner 移除成员及依赖该关系的权限/委托片段，保护 owner。 |
| `POST /:spaceId/permissions` | `{userId,appId,resources,actions,expiresAt?}`；在本空间及已安装操作上限内明确授权。 |
| `DELETE /:spaceId/permissions/:permissionId` | owner 撤销属于本空间的资源权限。 |

仅供管理员显示使用的 `GET /:spaceId?contextUserId=<registered-user-id>` 增补该用户的 `userContext` 只读模型，不授予写权限，拒绝非管理员选择；省略参数时保留原响应。

这些第一方接口要求原生浏览器 cookie，拒绝 Authorization 头；写入必须同源并携带 CSRF。未知字段、其他空间目标及提权尝试均拒绝。前述受委托空间管理接口保留其独立角色/委托合同。

成员退出在策略串行边界内复用既有 `setMembership({spaceId,userId,role:null})` 事务：删除该成员关系及 `membership_required=1` 的资源权限，裁剪该成员未撤销委托中引用此空间的规则，无剩余规则时撤销委托。依赖成员关系的现有访问立即失效，包括从空间应用启用派生的网页入口；其他空间、其他成员及独立权限保持既有语义。失败须整体回滚；重新加入不会复活已移除的权限或委托片段。当前所有者仍受 `OWNER_REQUIRED` 保护，使用既有确认删除空间流程；个人空间（含自动配置的个人空间）保持单成员，没有退出概念。既有所有者及平台管理员成员移除能力不变；退出不接受目标用户，也不从显示用户上下文取得权限。

设置仅为当前操作人符合条件的非个人空间成员关系显示「退出空间」。共用居中确认模态框警告将移除成员关系、要求成员身份的资源权限及空间限定委托规则；取消、Escape 或点击遮罩不产生修改。确认后刷新列表／选择器，清除已退出空间／应用选择，选择其他当前可用空间或显示既有空态，仅跟随读取成功后显示既有需确认的成功 alert。LSP01–LSP03 使用隔离合成 API 及双语真实 Chromium 1440/390 px 验证清理／回滚、拒绝、即时失权、既有移除流程不变、取消／焦点、稳定模态框几何及无失效引用。技术检查不代替独立业务验收。

删除保护取决于创建时记录的自动个人来源标记，而非 `personal` 类型。自动配置的个人空间通过单独空间端点对所有调用者（包括平台管理员）均禁止删除；按下述管理员账号删除合同删除 owner 时，在同一事务中移除该空间。其他空间，包括用户额外创建的个人空间，继续适用创建者／平台管理员删除规则。空间删除遵循谁创建谁删除（`ownerId` 记录创建者）；仅成员关系或空间管理员角色不授予删除权。设置在提交前显示明确警告，列出成员关系、资源权限、引用此空间的智能体委托规则与同意范围、逐空间应用启用策略及其派生网页入口；要求输入准确的不透明空间 ID 并明确确认，取消不发请求。

`deleteSpace({spaceId, actorId, confirmSpaceId})` 在 `controlTransaction` 及现有策略串行边界内原子提交，删除空间、成员关系、资源权限、自助标记和应用启用行；从已存委托及其待处理授权码范围移除本空间规则，保留其他空间规则，无剩余规则的委托撤销其凭据／授权码。签名同意表单不持久化；提交旧表单仍须核验当前权限，不能建立已删除空间的授权范围。已有凭据不能恢复已删除空间访问。策略通知使后续鉴权读取已提交删除；派生网页入口随成员关系／启用来源消失。独立管理员入口策略、其他空间、账号及无关授权保持不变；列表／选择器刷新并清除已删除选择。

适配器已配置的应用数据文件保留：平台身份删除不打开或删除应用自有正文。文件清理须另行授权，由运维遵循所属应用存储合同完成。重建空间不会复活已删除的权限或委托。

目录与有界 `apps` 列表包含全部已安装审核应用（内置十四款），不再只列业务集成。保留 `id`、`name` 和 `actions`，业务应用继续使用既有适配器 ID。增补 `webAppId`（网页入口 ID）、`supportsBusinessActions`（声明业务适配器）、`businessAvailable`（已配置业务集成）、`entryPolicy`（审核的网页入口边界）和 `enrollmentAllowed`（owner 能否启用）。既有空间启用状态保持。元数据不安装适配器、不扩大动作；业务适配器未配置的应用可见但不能启用。Polaris 仍仅平台管理员可访问，Letters/Profiles 仍仅文档所有者可访问；显示并解释限制，但不能通过空间启用。既有端点路径和写入参数保持兼容。

设置将概览中的成员与完整应用列表，和仅含一个应用的「管理」页面分开。每个管理页仅包含此应用的启用状态、当前成员资源权限及授权表单；应用固定，不混入其他应用选择控件。owner 校验、成员范围、资源／动作边界及启用／停用确认方式均保持。使用授权式网页入口且不支持业务动作的应用，显式启用后向当前成员提供网页入口，不接受业务资源授权、不建立智能体能力或委托；其他应用自有校验继续生效。停用或移除成员后，后续访问撤回该派生入口；独立管理员入口策略及其他空间仍按既有规则生效。

应用启用作为身份存储中的持久策略，新空间初始不启用任何应用。仅可选择已安装审核的应用；启用不安装后端，也不授予资源权限。没有显式运行时策略的空间继续使用静态应用空间列表。owner 设置显式策略后，网页授权、bridge 执行/发现、应用 HTTP 及后台任务使用同一当前边界。自助空间 owner 在未启用应用时仍保留空间管理权，但包括 owner 在内的应用资源访问须有明确授权；既有管理员管理空间的角色行为保持兼容。停用会删除该应用在本空间的资源权限及已存委托规则，并撤回后续同意、发现与已有凭据访问；重新启用不复活旧权限。移除成员后重新加入不复活旧权限，其他空间不受影响。

## 5. 工作台登录与智能体授权

1. 正式工作台登录后建立八小时原生身份会话，网页按本人当前应用及资源权限操作，无须给工作台自身再做委托。普通用户为`authorizationMode: native`，管理员为`administrator`；不产生新的浏览器授权记录。
2. 账号菜单只保留账户信息与退出。所有有效用户均打开「设置」（`/admin/`）。管理员保留全局概览、用户与权限管理，普通用户查看本人应用/能力、管理本人智能体委托，并创建或管理本人业务空间；没有独立本人授权页。
3. 新的外部委托由实际 OAuth 客户端发起，确认时明确显示客户端、空间选择及可选范围。从当前用户可访问空间中选择一个，存在本人的个人空间时默认选中；仅展示选定空间中自身当前获准且已接入的能力，可选操作由当前适配器与授权共同决定。无空间时可在同意页内联创建，再继续同一请求；创建不授予应用／资源权限。重试保留选择，指定空间绑定同意、授权码及委托。授权记录不代表客户端已连接或调用。
4. 管理界面写操作保持原生会话、Origin及CSRF校验；管理员接口严格验证平台角色，本人接口仅操作当前会话用户的委托。协议层既有`GET /auth/grants`及`DELETE /auth/grants/:id`仍只处理本人委托；`POST /auth/logout`结束当前会话。普通业务用户不能进入平台管理API。

独立业务服务未启用Praxis网关时，保留已有`/auth/delegate`显式第一方业务委托；没有可选能力时显示准确空态，不出现可提交的空表单。该入口不再出现在正式工作台的账号菜单。

session cookie名为`praxis_business_session`，设置HttpOnly、SameSite=Lax，HTTPS issuer下同时设置Secure。`/auth/session`不返回密码、访问token或session token；`delegated`只表示真实存储的委托。OAuth确认规则绑定会话、请求及十分钟期限；敏感响应不缓存。十五分钟内最多十次登录失败，计数持久化；界面提供英文与简体中文，内部错误及协议代码使用英文。

## 5.1 网页入口权限与一次登录

开启 `webGateway.enabled` 后，工作台与旧应用入口复用同一份身份 session，不再另建 relay 账号。身份登录、有效应用入口、业务资源权限及外部客户端委托分别校验；有效入口包含显式启用空间中已获资源权限的业务应用，以及采用授权式入口的非业务应用的成员入口，无须管理员逐用户设置入口。平台管理员／文档所有者入口边界保持。正式部署的 agent 业务权限始终受当前应用范围限制。空间owner、业务Bearer或家庭管理员角色都不会自动获得全部网页入口。

`AuthStore.setWebAccess({userId,apps,prds,expiresAt,workbench})` 只设置管理员控制元数据，持久保存在 `auth_web_access`。`apps` 仅接受当前版本允许登记的应用标识，`prds`为布尔值。v0.1.24起工作台是有效账号的默认外壳，不再单独勾选；可选旧`workbench`布尔值兼容接收但不能关闭桌面。`expiresAt` 是未来毫秒时间戳，或 `null` 表示管理员撤销前有效；浏览器 session 自身仍在八小时后失效。全空管理员策略收回旧式应用入口和 PRD；显式启用空间中已获资源授权的应用仍可访问。已下载内容无法追回。

```bash
npm run business:admin -- web-access \
  --config /absolute/private/business.json \
  --spec /absolute/private/web-access.json
```

私有 `--spec` 文件应为600权限的普通文件，例如 `{ "userId":"existing-user-id", "apps":["tingproof"], "prds":false, "expiresAt":null }`。该维护命令不读取或改写应用业务记录，不创建业务委托；日常管理使用网页。仅获听校入口授权的账号在工作台只看到听校应用，其他应用/项目仍拒绝；这仍是应用级边界，不能称为项目或任务隔离。

`GET /api/business/web-access` 仅在功能启用后提供，要求未禁用、未到期、客户端为 `praxis-browser` 的原生 session cookie。响应为`{username,apps,workbench:true,prds,expiresAt,permissionsExpireAt,csrfToken,platformAdmin,canViewPlatform}`；`expiresAt`为身份会话到期，`permissionsExpireAt`为当前应用/PRD授权期限或null，两者分开。缺少或正常到期的管理员策略不提供旧式应用/PRD 入口，仍保留登录桌面及当前获准的已启用空间应用入口；损坏策略503失败关闭。`canViewPlatform`仅为显式平台管理员开启管理概览，不保留独立只读查看者；平台角色不授予他人的业务数据权限。管理员响应另含原生 `userId`，用于网关的文档所有者校验；响应不含业务记录和访问令牌。401返回规范`loginUrl`；所有Authorization（含有效Bearer）均被拒绝，不回退cookie。每次重查当前身份和策略，应用HTTP/WS按授权期限及时关闭；桌面刷新图标，不把入口到期伪装为登出。

### 网页平台管理

正式入口为`/admin/`，首页向所有有效用户显示「设置」，按当前身份决定可见模块。普通用户没有全局用户选择器、全局概览或编辑安装/管理员入口策略的控件，所属空间的 owner 保留本空间管理控件。`/api/business/admin/*`接受原生浏览器session，拒绝所有Authorization头；写请求必须同源并携带CSRF。平台角色与空间owner/admin、普通应用入口分开，普通业务MCP无法调用；平台管理员无需业务资源权限即可使用平台管理功能；普通账号仅可访问本人管理功能。

本人管理接口位于 `/api/business/account/*`：会话及权限摘要、本人外部委托列表和本人撤销，以及前述受控空间生命周期。操作者身份从原生会话确定；仅空间 owner 的成员/资源管理可显式指定本空间目标用户，Bearer 不回退 cookie。普通用户打开设置页不会请求全局概览、用户列表或管理员图表资源。

从v0.1.22起，启用的平台管理员默认拥有当时六款应用、工作台和PRD入口；现版另对信件、个人资料检查配置的文档所有者身份，无须另建入口策略；旧空策略或到期记录不阻断管理员，角色收回后恢复普通用户显式入口及空间启用规则。管理页对管理员显示默认权限说明，入口策略写入返回409 `ADMIN_DEFAULT_ACCESS`，避免保存一个实际不生效的策略。

正式工作台中，管理员及普通用户的第一方浏览器均直接使用本人当前已有的业务空间、资源和动作。`/auth/session.authorizationMode`包含`administrator`、`native`及独立服务的`delegated`/`none`；不虚增委托记录。平台角色不自动赋予其他人的业务数据。外部客户端仍按OAuth显式确认及scope求交；Authorization Bearer只接受访问令牌，不把浏览器session当作外部agent凭据。

统一网关模式的默认登录、工作台授权完成回到`/`桌面；明确的安全`return_to`贯穿登录与授权，应用内发起返回原应用。外部OAuth严格保留已注册回调；独立业务服务无网关时仍默认自己的`/business/`页面。

统一网关模式只保留一个工作台：旧`/business`、`/business/`和`/business.html`返回规范桌面，聚焦的Reminder/听校界面及空间管理API继续存在。工作台应用与项目按入口权限过滤，并在当前标签页打开；业务空间作为后台权限归属不删除。

`GET /session`获取本人管理会话；`GET/POST /users`分页读取/创建用户；`PATCH /users/:id`启停；`POST /users/:id/password`重置密码；`PUT /users/:id/platform-admin`调整平台角色；`GET/PUT /users/:id/web-access`读取/修改入口；`GET /users/:id/grants`分页查看脱敏委托范围，`DELETE /grants/:id`撤销。接口路径均相对`/api/business/admin`。空间页管理员专属「当前用户」复用智能体委托的完整已注册用户原生下拉分页列表（无搜索），跨页保留已选账号，仅改变显示上下文；请求仍按当前登录管理员本人鉴权。已有密码不可读；重置使旧会话、授权码和受托凭据失效；停用再启用不会恢复旧凭据。最后一名启用管理员的停用/降权返回409，数据库事务保护并发。不会自动新建业务空间或授予业务资源，不返回私人业务正文或访问/刷新令牌。

### 管理员账号详情与删除

「设置 → 用户」先展示「新用户」区块，再展示列表；标题无创建按钮，列表不展开用户编辑器。选择用户进入 `/admin/?view=users&user=<user-id>` 独立详情页，以用户名为标题并提供「返回用户列表」。刷新／深链与浏览器历史保留选择；账号详情、启用／停用、密码重置及管理员角色控件沿用原行为。普通用户没有这些视图或管理员 API 权限。

以下路径相对 `/api/business/admin`，保留原生管理员身份、拒绝 Authorization 头、同源及 CSRF 校验：

| 请求 | 请求体或结果 |
| --- | --- |
| `GET /users/:id` | `{user:{id,username,enabled,platformAdmin}}`；仅返回有界账号详情，不含密码或凭据。 |
| `DELETE /users/:id` | 仅接受 `{confirmUsername}`，须与目标用户名完全一致；缺失／不符返回 HTTP 400 `CONFIRMATION_REQUIRED`，未知字段拒绝。任何调用者均不能自删，返回 HTTP 403 `SELF_DELETION_FORBIDDEN`；非管理员拒绝。 |

如果目标拥有任何非自动空间，删除返回 HTTP 409 `OWNED_SPACES_REQUIRED` 及 `ownedSpaces:[{id,type}]`，设置页清楚标出须先通过既有空间管理流程处理的空间，不删除或留下无 owner 空间。目标带来源标记的自动个人空间不阻塞删除；在同一事务内与账号一并移除其平台授权及启用引用。此例外不允许单独删除该空间。应用适配器数据文件保留，供另行授权的运维清理，不打开或修改应用正文。

在现有策略串行／控制事务内，删除用户、会话、智能体委托及凭据、待处理授权码／同意范围、全部空间成员关系、资源权限、管理员入口策略，以及自动个人空间引用。失败须整体回滚。已删除身份、旧凭据及无状态同意提交不能恢复访问；无关用户／空间／独立权限不变。既有居中确认模态框说明删除范围和文件保留，要求准确输入用户名，限制焦点，取消／Escape／遮罩不发修改请求。成功后刷新列表及全部用户选择器，清除已删除选择，返回用户列表；仅跟随读取成功后显示既有需确认的成功 alert。使用隔离合成夹具检查 USR01–USR06，包括 API 拒绝、原子回滚、自有空间阻塞、立即撤权、适配器文件保留及真实 Chromium 1440/390 px 详情／创建／确认／选择器流程。技术部署证据不代替独立业务验收。

`webGateway.originHost` 是固定旧后端主机名，不是 URL 或任意目标；端口由网关固定路由选择。可选 `shareManifestFile` 是私有分享清单的绝对规范路径，业务核心只校验配置形式，不读取清单。实际转发、分享范围、旧 API 与直连端口防护仍由来源网关和应用落实。身份服务不可用必须关闭访问，不能回退到未认证的旧应用。

## 6. 远程 MCP OAuth

| 路径 | 作用 |
|---|---|
| `GET /.well-known/oauth-protected-resource`，以及 `/mcp` 后缀形式 | MCP 资源与授权服务发现 |
| `GET /.well-known/oauth-authorization-server` | issuer、端点、S256、scope 与客户端类型 |
| `POST /oauth/register` | 受限公共客户端注册，不主动抓取客户端元数据 URL |
| `GET/POST /oauth/authorize` | 登录、显式选择空间与范围，无空间时内联创建；签发两分钟单次授权码 |
| `POST /oauth/token` | 授权码＋PKCE 换取凭据，或轮换刷新凭据；指定空间授权增补 `space_id` |
| `POST /oauth/revoke` | 持有凭据的对应客户端撤销其委托 |

新指定空间授权的换码及刷新响应在原访问令牌、类型、期限、刷新令牌与 scope 字段之外增补 `space_id`。指定空间仅将同意缩至该空间中已获准的应用／动作，不新增权限。既有客户端、已存委托与旧流程继续兼容；无指定空间的旧凭据沿用原范围语义。保留 Origin／CSRF、签名同意、PKCE、精确回调／资源、授权码期限／单次使用、刷新轮换及重用检查。

授权码模式必须提供 `response_type=code`、已注册 `client_id`、精确 `redirect_uri`、`code_challenge_method=S256`、挑战值，以及精确 `resource=${issuer}/mcp`。换码再次校验 client、redirect、resource 和 verifier；授权响应包含 `iss` 及原 `state`。授权页只能授予当前用户实际拥有、且属于本次 scope 的能力。

可用 OAuth scope：

- `reminder:read`：读取。
- `reminder:write`：创建、修改、完成、删除；实际授予的动作仍以用户选择及资源权限为限。
- `tingproof:read`：读取获准任务。
- `tingproof:write`：提交校正、分配任务；普通 guest 不会因此获得分配权限。
- `spaces:members`、`spaces:sharing`、`spaces:delegation`：分别委托本空间成员、共享和委托管理，且要求当前 owner/admin 身份。

公共协议端点允许不携带 cookie 的跨来源请求；登录、委托和 session 接口严格检查浏览器来源。客户端注册有基本速率限制，不支持任意重定向或未经约束的元数据抓取。

这是当前支持的标准子集：预注册和受限 DCR、公共客户端、授权码＋PKCE、刷新轮换。未实现 Client ID Metadata Documents、OIDC 身份接口、厂商专用插件卡片或企业 SSO；不得把它们列为已通过。

### 指定空间链路审计 · v0.1.151

公开 `praxis_use_guide` 及配套技能说明完整顺序：连接受保护 `/mcp`、登录、在同意页原生下拉框直接选择目标可访问空间，并明确勾选获准动作。无空间时保留内联创建，创建不授予应用／资源权限。代码交换及刷新返回指定的 `space_id`；需要 `spaceId` 的工具按发布的 schema 将该值传入 `tools/call` → `arguments.spaceId`。OAuth 与工具边界使用不同字段拼写。

审计发现客户端缺口：当前安装 MCP SDK 的 OAuth 令牌 schema 会剥离未知字段，包括附加的 `space_id`，所以仅返回令牌扩展不足以证明智能体能取得空间 ID。授权后的 `initialize` 说明现包含当前获准空间目录，`praxis_refresh_capabilities` 附加返回 `spaces:[{spaceId,apps:[{id,actions}]}]`。两者均来自现有 `bridge.catalog` 授权交集，不含业务记录、不授予新权限；刷新重新计算投影。不得根据历史 ID 推定权限、任取第一个空间或猜 ID；仍有多个可能空间时，询问用户目标范围。旧委托保留原有范围语义，令牌可能没有指定字段。

同意下拉框在切换时提交原有 GET 请求，仅在含选择器的文档中通过精确哈希授权脚本；权限提交仍为明确 POST，Origin、CSRF、签名同意及 PKCE／回调绑定不变。其他认证文档保留原脚本限制。自有空间拒绝删除用户继续使用既有 `#notice` 持久固定错误浮层及完整空间 ID，不另建弹窗。

验证采用隔离合成的公开指引、浏览器同意及真实 MCP SDK 调用，包含签名原生 Reminder 服务；源码、浏览器和部署结果在下方分别记录，不代表独立业务智能体或实体手机验收。

| 审计阶段／验收项 | 技术证据 | 结果 |
| --- | --- | --- |
| 公开指引 | `tests/public-mcp.test.mjs`：真实 SDK 读取中英文 `praxis_use_guide` 与配套技能，包含字段映射及兜底，2/2 通过；匿名响应仍为固定指引，不含账号目录。 | Pass |
| 同意指定与内联创建 | `tests/business-space-designation.test.mjs` 及 `tests/business-auth.test.mjs` 浏览器用例：真实 Chromium 英文 1440／中文 390 px 验证键盘／指针直接原生选择、未勾选权限、无空间内联创建、空同意重试、浏览器跟随跨源回调及 PKCE 完成；专项 2/2 通过，无跳过。 | Pass |
| 令牌及真实工具参数 | `tests/mcp-space-chain.test.mjs`：公开指引 → 明确同意 → 代码交换／刷新 `space_id` → 真实 SDK `reminder_list({spaceId})` 调用签名原生 Reminder 夹具；已安装 SDK 1.32.2 的换码剥离扩展，经初始化／刷新目录取得同一 ID 并再次调用成功。跨空间拒绝及停用应用后重算目录通过。 | Pass |
| MCP 清理与共用错误（MCP01） | `tests/admin-layout.test.mjs`：Chromium 中英文 × 1440/390 px 验证三类过时展示已移除；真实合成 409 保留账号／空间，两个完整 ID 与普通读取错误显示于完全相同的固定 `#notice` 节点，无额外弹窗，正文／滚动零位移，跨视图保留、明确刷新清除。基线已使用该机制，本次未新增第二套实现。 | Pass |
| 源码检查与阅读器（MCP02–MCP03） | 最终 `npm test`：502 通过、0 失败、9 个可选浏览器项跳过（共 511）；本次相关浏览器专项已单独运行。双语 PRD 从真实工作台阅读器打开，版本 0.1.151，无溢出。 | Pass |
| 独立业务智能体／实体手机验收 | 此变更仅采用隔离维护夹具，业务验收由指定独立客户端负责。 | N/A — 不属于本技术包 |

## 7. 验证与部署边界

授权／布局检查还覆盖 BSD01–BSD04：准确 ID 确认／取消、创建者及平台管理员删除、仅加入成员／自动个人空间拒绝、用户创建个人空间删除、原子回滚、限定委托／同意／启用移除、立即再访问拒绝，以及其他空间／用户不变。使用隔离夹具，在真实 Chromium 1440/390 px 验证警告与列表／选择器刷新；适配器文件只记录保留边界，不执行清理。

BSA01–BSA04 及更新的 BUC01 还要求隔离合成验证注册／配置持久化与幂等、用户及管理员的自动来源空间删除拒绝和额外个人空间删除、同意空间选择／默认值／内联创建、指定令牌 `space_id` 与旧流程／PKCE／Origin／CSRF 回归。真实 Chromium 1440/390 px 检查这些同意状态，以及管理员完整的分页用户搜索和选定用户只读模型；普通用户保留本人上下文。这些是维护技术检查，与独立客户端业务验收分开。

隔离合成测试命令：`node --test tests/business-auth.test.mjs`。覆盖权限求交、guest 范围、个人隔离、收权与重启、凭据摘要、CSRF、授权码绑定与单次使用，以及刷新令牌轮换。

`node --test tests/business-auth.test.mjs tests/admin-layout.test.mjs` 覆盖完整已安装目录、能力元数据及有界非业务应用启用。可选真实 Chromium 布局检查使用隔离合成 HTTP 夹具，在 1440/390 px 验证概览／管理／返回、启用／停用、添加／移除成员、逐应用授权／撤销、单条分隔线、浏览器 `window.alert` 成功弹窗由用户确认且不插入页面行、不改变布局或文案、不设自动消失计时，以及持久错误（包括成功操作后的跟随读取失败，此时不弹成功提示）、无横向溢出，以及工作台双语 PRD。设置 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 运行浏览器检查；未配置而跳过不能作为浏览器证据。

迁移前的授权测试还覆盖了登录限流、空间管理及跨进程策略锁。

历史网页入口与管理员专项测试覆盖显式授权、重启持久化、跨连接收权、独立业务权限、Cookie/客户端/失效边界和配置约束。在当前检出中运行 `node --test tests/private-document-access.test.mjs tests/app-launcher.test.mjs` 可验证所有者访问、读取中撤权以及桌面入口过滤。

历史 Chromium 合成流程使用 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 环境配置。该脚本启动临时真实业务服务器，仅创建临时身份配置，实际操作登录表单、回跳、选择范围、工作台委托、窄屏 OAuth consent、换码及撤销，并验证跨空间/动作拒绝。全部文件在临时目录，结束清理；它验证浏览器流程，不属于真实手机第三方 App 或独立业务 agent 验收。

生产运行前还需完成适配器与旧接口旁路防护、HTTPS 路由、真实客户端兼容、事件撤销及 [验证方案](VERIFICATION.md) 中的独立业务和真机验收。上述操作按指定执行者完成；当前维护代理不通过直连数据库或管理工具代写真实业务数据。
