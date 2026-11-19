# Praxis 业务身份、授权与 OAuth

[English](BUSINESS-AUTH.en.md) · 简体中文

本文说明首批业务权限实现。平台维护、业务使用继续分离；该模块不提供代码、文件、命令、部署或备份工具。本文与合成测试通过，均不能代替真实 Paseo Codex 隔离验收或物理手机 App 验收。

## 1. 模块与持久化

`src/business/auth.mjs` 提供 `AuthStore` 和 `createAuthHandler`。使用 Node 内置 SQLite，无额外身份服务依赖。身份数据库应位于 Git 外私有目录；文件权限600，包含密码派生值、授权规则、凭据摘要及脱敏审计，不能提交或作为业务工具返回。

构造参数为 `{ file, issuer, clock? }`；`clock` 仅用于隔离合成测试。生产 `issuer` 必须是明确的 HTTPS URL；仅回环地址允许 HTTP 开发使用。`Host`、转发头和模型输入不能改变 issuer、资源 audience 或允许的浏览器来源。

OAuth 资源标识为 `${issuer}/mcp`。部署代理须将下列协议和登录路径路由到同一个授权服务；公开元数据只公开协议结构，不包含私人记录。已有网关 owner 登录墙不能要求 MCP 客户端取得 owner 口令。

## 2. 权限求交

每次请求重新计算：

`用户当前资源权限 ∩ 当前客户端委托 ∩ 指定空间、资源、动作、期限`

正式Praxis网关开启时，还须与管理员当前批准的应用范围及该部署已接入的应用/空间能力求交。网页入口本身不会创建业务资源权限；应用收权、到期和适配器范围收窄同样限制已有OAuth委托、授权码及刷新。独立业务服务保留自身显式授权契约。

- 个人、家庭和公司为独立业务空间；家庭成员关系不授予任何成员的个人资料。
- 空间 owner/admin 可以在本空间内委托业务能力；这不产生平台代码或主机权限。
- 普通成员需要明确的资源授权。外部协作者可在无成员关系的情况下取得指定资源授权，禁止 `*` 全空间范围。
- 个人空间也可明确分享指定资源；默认仍为私有，不能通过成员关系批量开放个人空间。
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

## 5. 工作台登录与智能体授权

1. 正式工作台登录后建立八小时原生身份会话，网页按本人当前应用及资源权限操作，无须给工作台自身再做委托。普通用户为`authorizationMode: native`，管理员为`administrator`；不产生新的浏览器授权记录。
2. 账号菜单只保留账户信息与退出。所有有效用户均进入已有`/admin/`管理页。管理员保留全局概览、用户与权限管理，普通用户只读查看本人应用/能力及管理本人智能体委托；没有独立本人授权页。
3. 新的外部委托由实际OAuth客户端发起，确认时明确显示客户端及可选范围。账号只能同意自身当前获准且已接入的能力；可选操作由当前适配器与授权共同决定。授权记录不代表客户端已连接或调用。
4. 管理界面写操作保持原生会话、Origin及CSRF校验；管理员接口严格验证平台角色，本人接口仅操作当前会话用户的委托。协议层既有`GET /auth/grants`及`DELETE /auth/grants/:id`仍只处理本人委托；`POST /auth/logout`结束当前会话。普通业务用户不能进入平台管理API。

独立业务服务未启用Praxis网关时，保留已有`/auth/delegate`显式第一方业务委托；没有可选能力时显示准确空态，不出现可提交的空表单。该入口不再出现在正式工作台的账号菜单。

session cookie名为`praxis_business_session`，设置HttpOnly、SameSite=Lax，HTTPS issuer下同时设置Secure。`/auth/session`不返回密码、访问token或session token；`delegated`只表示真实存储的委托。OAuth确认规则绑定会话、请求及十分钟期限；敏感响应不缓存。十五分钟内最多十次登录失败，计数持久化；界面提供英文与简体中文，内部错误及协议代码使用英文。

## 5.1 网页入口权限与一次登录

开启 `webGateway.enabled` 后，工作台与旧应用入口复用同一份身份 session，不再另建 relay 账号。身份登录、管理员应用范围、业务资源权限及外部客户端委托分别校验；正式部署的agent业务权限始终受当前应用范围限制。空间owner、业务Bearer或家庭管理员角色都不会自动获得全部网页入口。

`AuthStore.setWebAccess({userId,apps,prds,expiresAt,workbench})` 只设置管理员控制元数据，持久保存在 `auth_web_access`。`apps` 仅接受当前版本允许登记的应用标识，`prds`为布尔值。v0.1.24起工作台是有效账号的默认外壳，不再单独勾选；可选旧`workbench`布尔值兼容接收但不能关闭桌面。`expiresAt` 是未来毫秒时间戳，或 `null` 表示管理员撤销前有效；浏览器 session 自身仍在八小时后失效。全空策略收回应用和PRD，桌面显示空态；直接应用URL仍拒绝，已下载内容无法追回。

```bash
npm run business:admin -- web-access \
  --config /absolute/private/business.json \
  --spec /absolute/private/web-access.json
```

私有 `--spec` 文件应为600权限的普通文件，例如 `{ "userId":"existing-user-id", "apps":["tingproof"], "prds":false, "expiresAt":null }`。该维护命令不读取或改写应用业务记录，不创建业务委托；日常管理使用网页。仅获听校入口授权的账号在工作台只看到听校应用，其他应用/项目仍拒绝；这仍是应用级边界，不能称为项目或任务隔离。

`GET /api/business/web-access` 仅在功能启用后提供，要求未禁用、未到期、客户端为 `praxis-browser` 的原生 session cookie。响应为`{username,apps,workbench:true,prds,expiresAt,permissionsExpireAt,csrfToken,platformAdmin,canViewPlatform}`；`expiresAt`为身份会话到期，`permissionsExpireAt`为当前应用/PRD授权期限或null，两者分开。缺少或正常到期的策略返回空应用/PRD，仍保留登录桌面；损坏策略503失败关闭。`canViewPlatform`仅为显式平台管理员开启管理概览，不保留独立只读查看者；平台角色不授予他人的业务数据权限。管理员响应另含原生 `userId`，用于网关的文档所有者校验；响应不含业务记录和访问令牌。401返回规范`loginUrl`；所有Authorization（含有效Bearer）均被拒绝，不回退cookie。每次重查当前身份和策略，应用HTTP/WS按授权期限及时关闭；桌面刷新图标，不把入口到期伪装为登出。

### 网页平台管理

正式入口为`/admin/`，首页向所有有效用户显示“管理”，按当前身份决定可见模块。普通用户没有用户选择器、全局概览或编辑应用权限的控件。`/api/business/admin/*`接受原生浏览器session，拒绝所有Authorization头；写请求必须同源并携带CSRF。平台角色与空间owner/admin、普通应用入口分开，普通业务MCP无法调用；平台管理员无需业务资源权限即可使用平台管理功能；普通账号仅可访问本人管理功能。

本人管理接口位于`/api/business/account/*`：会话及只读权限、本人外部委托列表和本人撤销。所有用户ID均从原生会话确定，不接受调用者选择他人；Bearer不回退cookie。普通用户加载管理页不会请求全局概览、用户列表或管理员图表资源。

从v0.1.22起，启用的平台管理员默认拥有当时六款应用、工作台和PRD入口；现版另对信件、个人资料检查配置的文档所有者身份，无须另建入口策略；旧空策略或到期记录不阻断管理员，角色收回后恢复普通用户显式入口规则。管理页对管理员显示默认权限说明，入口策略写入返回409 `ADMIN_DEFAULT_ACCESS`，避免保存一个实际不生效的策略。

正式工作台中，管理员及普通用户的第一方浏览器均直接使用本人当前已有的业务空间、资源和动作。`/auth/session.authorizationMode`包含`administrator`、`native`及独立服务的`delegated`/`none`；不虚增委托记录。平台角色不自动赋予其他人的业务数据。外部客户端仍按OAuth显式确认及scope求交；Authorization Bearer只接受访问令牌，不把浏览器session当作外部agent凭据。

统一网关模式的默认登录、工作台授权完成回到`/`桌面；明确的安全`return_to`贯穿登录与授权，应用内发起返回原应用。外部OAuth严格保留已注册回调；独立业务服务无网关时仍默认自己的`/business/`页面。

统一网关模式只保留一个工作台：旧`/business`、`/business/`和`/business.html`返回规范桌面，聚焦的Reminder/听校界面及空间管理API继续存在。工作台应用与项目按入口权限过滤，并在当前标签页打开；业务空间作为后台权限归属不删除。

`GET /session`获取本人管理会话；`GET/POST /users`分页读取/创建用户；`PATCH /users/:id`启停；`POST /users/:id/password`重置密码；`PUT /users/:id/platform-admin`调整平台角色；`GET/PUT /users/:id/web-access`读取/修改入口；`GET /users/:id/grants`分页查看脱敏委托范围，`DELETE /grants/:id`撤销。接口路径均相对`/api/business/admin`。已有密码不可读；重置使旧会话、授权码和受托凭据失效；停用再启用不会恢复旧凭据。最后一名启用管理员的停用/降权返回409，数据库事务保护并发。不会自动新建业务空间或授予业务资源，不返回私人业务正文或访问/刷新令牌。

`webGateway.originHost` 是固定旧后端主机名，不是 URL 或任意目标；端口由网关固定路由选择。可选 `shareManifestFile` 是私有分享清单的绝对规范路径，业务核心只校验配置形式，不读取清单。实际转发、分享范围、旧 API 与直连端口防护仍由来源网关和应用落实。身份服务不可用必须关闭访问，不能回退到未认证的旧应用。

## 6. 远程 MCP OAuth

| 路径 | 作用 |
|---|---|
| `GET /.well-known/oauth-protected-resource`，以及 `/mcp` 后缀形式 | MCP 资源与授权服务发现 |
| `GET /.well-known/oauth-authorization-server` | issuer、端点、S256、scope 与客户端类型 |
| `POST /oauth/register` | 受限公共客户端注册，不主动抓取客户端元数据 URL |
| `GET/POST /oauth/authorize` | 登录及显式选择范围，签发两分钟单次授权码 |
| `POST /oauth/token` | 授权码＋PKCE 换取凭据，或轮换刷新凭据 |
| `POST /oauth/revoke` | 持有凭据的对应客户端撤销其委托 |

授权码模式必须提供 `response_type=code`、已注册 `client_id`、精确 `redirect_uri`、`code_challenge_method=S256`、挑战值，以及精确 `resource=${issuer}/mcp`。换码再次校验 client、redirect、resource 和 verifier；授权响应包含 `iss` 及原 `state`。授权页只能授予当前用户实际拥有、且属于本次 scope 的能力。

可用 OAuth scope：

- `reminder:read`：读取。
- `reminder:write`：创建、修改、完成、删除；实际授予的动作仍以用户选择及资源权限为限。
- `tingproof:read`：读取获准任务。
- `tingproof:write`：提交校正、分配任务；普通 guest 不会因此获得分配权限。
- `spaces:members`、`spaces:sharing`、`spaces:delegation`：分别委托本空间成员、共享和委托管理，且要求当前 owner/admin 身份。

公共协议端点允许不携带 cookie 的跨来源请求；登录、委托和 session 接口严格检查浏览器来源。客户端注册有基本速率限制，不支持任意重定向或未经约束的元数据抓取。

这是当前支持的标准子集：预注册和受限 DCR、公共客户端、授权码＋PKCE、刷新轮换。未实现 Client ID Metadata Documents、OIDC 身份接口、厂商专用插件卡片或企业 SSO；不得把它们列为已通过。

## 7. 验证与部署边界

隔离合成测试命令：`node --test tests/business-auth.test.mjs`。覆盖权限求交、guest 范围、个人隔离、收权与重启、凭据摘要、CSRF、授权码绑定与单次使用，以及刷新令牌轮换。

迁移前的授权测试还覆盖了登录限流、空间管理及跨进程策略锁。

历史网页入口与管理员专项测试覆盖显式授权、重启持久化、跨连接收权、独立业务权限、Cookie/客户端/失效边界和配置约束。在当前检出中运行 `node --test tests/private-document-access.test.mjs tests/app-launcher.test.mjs` 可验证所有者访问、读取中撤权以及桌面入口过滤。

历史 Chromium 合成流程使用 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 环境配置。该脚本启动临时真实业务服务器，仅创建临时身份配置，实际操作登录表单、回跳、选择范围、工作台委托、窄屏 OAuth consent、换码及撤销，并验证跨空间/动作拒绝。全部文件在临时目录，结束清理；它验证浏览器流程，不属于真实手机第三方 App 或独立业务 agent 验收。

生产运行前还需完成适配器与旧接口旁路防护、HTTPS 路由、真实客户端兼容、事件撤销及 [验证方案](VERIFICATION.md) 中的独立业务和真机验收。上述操作按指定执行者完成；当前维护代理不通过直连数据库或管理工具代写真实业务数据。
