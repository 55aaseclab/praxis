# AI-native testing acceptance evidence

Current integration checkpoint: **0.1.137**; source branch checkpoint: **0.1.128**. The 0.1.126 section below is historical; its signing-key workflow is superseded by explicit human questions/replies in Paseo.

当前整合验收点：**0.1.137**，源分支验收点：**0.1.128**。下方0.1.126为历史记录，其中密钥签名流程已被 Paseo 人工提问/回复替代。

English · 简体中文 below. Contract: [PRD ANT01–ANT10](../../docs/PRD.en.md#long-lived-ai-native-testing), [roadmap](../../docs/ROADMAP.en.md#long-lived-ai-native-testing), [external-client verification](../../docs/VERIFICATION.en.md).

## English

Source verification on 2026-11-20, Linux / Node 22.22.1. `npm test` passed **456/456** checks, with no failures, cancellations or skips, including **15** AI-native harness cases. Skill validation and `git diff --check` passed. The tests use temporary synthetic state, generated ephemeral test keys and mocked Paseo mutation responses; no real agent was created. The installed Paseo CLI's exact model discovery was also exercised read-only for all three roles.

| Requirement | Status | Actual evidence and scope |
| --- | --- | --- |
| ANT01 | Pass | Three bilingual campaign definitions, nine actors, exact main/worker/GPT model checks and deterministic contextual variation. Investor round refuses missing market/horizon/asOf. |
| ANT02 | Pass | Two real Node controller processes race for one SQLite reservation; exactly one succeeds. Reopened controller and pause/resume retain the slot. |
| ANT03 | Pass | Mocked adapter lifecycle verifies explicit workspace/host arguments, original-session reuse, identity/model/mode rejection and lost-receipt adoption. Read-only actual CLI discovery finds both requested GLM models and GPT-6.1-Sol ultra. |
| ANT04 | Pass | Missing, wrong-key, expired, wrong-request, changed-packet and reused approvals reject; successful reservation consumes approval before external dispatch. |
| ANT05 | Pass | Packet rejects unknown business fields; maintenance prompt is built only from the approved packet, without campaign/task state. Human semantic redaction remains mandatory. |
| ANT06 | Pass | Failure history survives repair/retry, undeployed repair refuses retry, original actor session is reused, stale-version verification rejects and repeat retry of the same failed repair version rejects. |
| ANT07 | Pass | Actual tests distinguish failed attempts from coverage, preserve pending verification, reject same-actor/empty evidence, update N/A denominator version and return null without observations. Initial matrix has 27 cells. |
| ANT08 | Pass | Initialization/reports do not dispatch; pause/restart retain reservations; idle queued recipients do not release the slot before the dispatched turn is observed running. Signed operator resolution covers ambiguous delivery. |
| ANT09 | Pass | Synthetic private state and approval files use0600; runtime paths inside Git reject; configs distinguish all eleven workspaces. Signing private keys are absent from manifests/state/agent prompts. |
| ANT10 | Pass | Actual local workbench `/prds/praxis/?lang=en` and `?lang=zh` opened in Chromium, HTTP200, both showing version0.1.126 and ANT01–ANT10. Local renderer used public source documents only. |
| Campaign launch/client acceptance | Pending | No campaign agents, business accounts, OAuth connections, human signing identity or recurrence were provisioned. Operator must supply independent identities, private state, exact host/workspace bindings and genuine app/client read-back evidence. |
| Human key and Maintenance isolation | Pending | Signature behavior is proven with test keys; protecting the human key and source workspace from business agents requires actual OS/host identity separation. A mutable same-user checkout is not a security boundary against an arbitrary client. |
| Investor market and horizon | Pending | Deliberately not guessed. Trades remain blocked until chosen. Explicit between-round clock advancement preserves actor/ledger and rejects backward/future time. |
| Load, phone, profitability, human usability | Pending | Serial agent control and synthetic checks establish none of these outcomes. |
| Docker/production deployment | N/A | This change adds opt-in test tooling and documents; no installed service behavior, app pin or business record changes. No Docker target requires rebuilding. |
| Anonymous app-pin bootstrap | Pending | Existing exact pins were populated from local source objects after remote retrieval rejected an existing Calendar ref. Pins are unchanged; this verification does not claim a new anonymous source-publication check. |

The Paseo browser host could not reach the build host's loopback URL. The PRD reader checks instead used local headless Chromium against a temporary workbench server; neither attempted the production workbench. Signed human confirmation is per Maintenance invocation, not campaign-wide authorization.

## 简体中文

合同：[PRD ANT01–ANT10](../../docs/PRD.md#长期-ai-native-testing)、[路线图](../../docs/ROADMAP.md#长期-ai-native-testing)、[外部客户端验收](../../docs/VERIFICATION.md)。2026-11-20 在 Linux / Node22.22.1 验证，`npm test` **456/456** 通过，零失败、取消或跳过，包含15项框架检查；技能校验和 `git diff --check` 通过。使用临时合成状态、临时测试密钥和模拟 Paseo 变更回执，没有创建真实 agent；另通过已安装 Paseo CLI 只读发现三个角色的精确模型。

| 验收项 | 状态 | 实际证据与范围 |
| --- | --- | --- |
| ANT01 | Pass | 三个双语场景、九位角色、指定模型和可复现情境；投资缺少市场/期限/时点时拒绝创建轮次。 |
| ANT02 | Pass | 两个真实 Node 进程竞争 SQLite 预留，仅一个成功；重开状态和暂停/恢复均保留占槽。 |
| ANT03 | Pass | 模拟适配器验证主机/工作区参数、复用原会话、身份/模型/mode 拒绝和丢失回执接管；真实 CLI 只读发现指定 main/worker GLM 与 GPT6.1-Sol ultra。 |
| ANT04 | Pass | 缺少签名、错误密钥、过期、请求不符、包变化及重用均拒绝；外部派发前消耗审批。 |
| ANT05 | Pass | 技术问题包拒绝额外业务字段；维护提示词仅从已批准问题包生成，不接收场景/任务状态；人工语义脱敏仍必需。 |
| ANT06 | Pass | 修复复测保留失败历史；未发布拒绝重试，复用原角色，旧版本验收拒绝，同一失败修复版本不循环重跑。 |
| ANT07 | Pass | 区分失败与覆盖，保留待验收，同角色/空证据拒绝，N/A 分母版本变化，无观察为null；初始矩阵27项。 |
| ANT08 | Pass | 初始化/报告不派发，暂停/重启保留占槽；排队接收者未观察到执行前不能凭空闲释放；人工签名支持核对不明派发。 |
| ANT09 | Pass | 合成私有状态和审批文件0600，Git 内运行路径拒绝，配置区分11个工作区，配置/状态/提示词不含签名私钥。 |
| ANT10 | Pass | 实际本地工作台中英 `/prds/praxis/` 在 Chromium 打开，HTTP200，显示0.1.126及 ANT01–ANT10；仅使用公开源码文档。 |
| 启动/真实客户端 | Pending | 未配置测试 agent、业务账户、OAuth、人工签名身份或周期调度；operator 须提供独立身份、私有状态、精确主机/工作区及真实应用/客户端回读证据。 |
| 人工密钥/维护隔离 | Pending | 测试密钥证明签名逻辑，实际保护须靠 OS/主机身份隔离；同用户可改的检出不是对任意客户端的安全边界。 |
| 投资市场/期限 | Pending | 未自行假定，明确前阻止交易；轮次之间显式推进时钟保留角色/账本，拒绝倒退或未来时点。 |
| 负载/实体手机/盈利/人类可用性 | Pending | 串行 agent 和合成源码检查不证明这些结果。 |
| Docker/生产部署 | N/A | 仅新增显式测试工具和文档，未变更已安装服务、应用 pin 或业务记录，无需重建 Docker 目标。 |
| 匿名应用源码启动 | Pending | 远端拒绝既有 Calendar ref 后，从本地源码对象获取原精确 pin；pin 未变化，不声称完成新的匿名源码发布验证。 |

Paseo 浏览器主机不能访问构建主机回环 URL，因此使用本机无头 Chromium 和临时工作台验证，没有访问生产工作台。人工确认绑定每一次 Maintenance 介入，不是对整个测试活动的一次性授权。


## 0.1.127 — Paseo human confirmation / Paseo 人工确认

| Scope / 范围 | Status | Evidence / 证据 |
| --- | --- | --- |
| ANT04, ANT09 — no approval-key prerequisite / 无审批密钥前提 | Pass | Initialization and reports use no keys; unanswered questions, missing decisions, mismatched question IDs, rejection, changed packets and replay cannot dispatch Maintenance. Approval is recorded only after the real human reply in Paseo, with question/reply references. 无密钥初始化；未回复、缺决定、问题不符、拒绝、包变化及重放均不派发维护；仅在 Paseo 真实人工回复后记录问题/回复引用。 |
| ANT01–ANT08 — source regressions / 源码回归 | Pass | Linux/Node22.22.1: npm test456/456, including15 harness cases; no failures/skips. No business mutations occur in these tests. 456项含15项框架检查全部通过，无失败/跳过，不操作业务记录。 |
| ANT10 — bilingual PRD reader / 双语阅读器 | Pass | Local Chromium opened both actual workbench PRD editions, HTTP200, version0.1.127, showing Paseo confirmation and public-interface requirements. 本地 Chromium 打开实际中英工作台 PRD，HTTP200，显示0.1.127及新规则。 |
| Public-only business entry / 业务仅经公开入口 | Pass | Bilingual PRD, skill and prompts require public UI/documented APIs/public MCP for account/team/consent/business setup, with no internal endpoint/admin bootstrap/SQL fallback. All ten prepared client workspaces carry the same rule. 中英 PRD、技能、提示词及十个已准备工作区均含公开入口限制，不用内部接口/管理 bootstrap/SQL补流程。 |
| Actual launch and business acceptance / 实际启动与业务验收 | Pending | Authorized next step; runtime evidence is kept outside Git and must not be inferred from controller tests. 已获授权继续启动，运行证据留在 Git 外，不从控制器检查推断。 |

Conversation receipts are auditable workflow records, not cryptographic verification of a hostile client. The human is asked directly in Paseo and does not configure keys or sign files. Provider-native question tools are preferred; if unavailable, ask in the Paseo conversation and end the turn until the human replies. 会话回执用于审计流程，不是对恶意客户端的密码学验身；直接在 Paseo 问你，不配置密钥或签文件，优先用 provider 的 question 工具，否则在会话中提问并等待。


## 0.1.128 — Full access and Paseo messages / 完整工具权限与 Paseo 消息

| Scope / 范围 | Status | Evidence / 证据 |
| --- | --- | --- |
| Test configuration / 测试配置 | Pass | `fullAccess: true`, `communication: "paseo-send-message"` are persisted defaults, including the live runtime configuration; investor/identity data and task history are unchanged. 默认值已保存到源码配置及当前运行配置，不改投资/身份数据或任务历史。 |
| Public SDK creation / 公开 SDK 创建 | Pass | Synthetic adapter checks prove idle-session creation receives OpenCode auto_accept before agent.send sends the first prompt; follow-ups use agent.send with steer and message ID. Maintenance retains Codex full-access/ultra/default context. 合成检查证明先设置权限，再通过 agent.send 发首条及后续消息；维护保持 full-access/ultra/默认上下文。 |
| Current live settings / 当前会话设置 | Pass | Public Paseo update_agent enabled auto_accept on the coordinator and first worker; actual public SDK refresh independently read both values as true. No provider/server internal API was used. 通过公开 update_agent 设置，公开 SDK refresh 回读两者均为true，不用内部API。 |
| Actual coordination / 实际通信 | Pass | Worker sent its redacted result to coordinator using Paseo send; coordinator sent the verified summary to its parent via Paseo message. Message references remain in the private runtime ledger. worker→主控→父级已实际通过 Paseo 消息汇报，私有台账保存引用。 |
| Source/browser regressions / 源码与浏览器 | Pass | npm test456/456 with15 harness cases; bilingual0.1.128 workbench PRDs show fullAccess and paseo-send-message. Skill validation and diff checks pass. 456项含15项框架检查、中英工作台PRD、技能与差异检查均通过。 |
| First business onboarding / 首个业务接入 | Fail | The real worker reaches the public OAuth login gate but cannot obtain a new business account through the offered public flow. No private admin/SQL fallback, credentials borrowed from another actor or business writes were used. 真实worker到达公开OAuth登录闸门，缺少可用公开建号流程；未使用内部管理/SQL补流程、借用身份或写业务记录。 |
| Account workflow repair / 账号流程修复 | Pending | Needs a separate explicit human decision on its technical scope before Maintenance. This configuration change does not approve that repair. 维护前须人工另行明确范围；此次配置修改不授权修账号。 |

Runtime-setting verification used existing sessions, not extra synthetic live workers. SDK creation behavior is covered by the injected-client check; no new SDK-created business session is claimed at this checkpoint. 实际权限回读使用既有会话，没有额外启动业务worker；SDK新建行为由注入客户端的检查覆盖，不声称此验收点另有真实SDK新建业务会话。

## 0.1.137 — Main integration / 主线整合

- **Pass — merge and release identity.** Integrated all three `design/ai-native-testing` commits through `fb58377` into main0.1.136 and assigned0.1.137. Package/lock and both PRD/roadmap editions agree. Main's existing release rows and latest homepage/card changes are retained; source-branch draft0.1.126–128 records remain historical evidence, not duplicate main release rows.
- **Pass — combined verification.** Fresh locked installation and `npm test` pass **458/458** checks without failures or skips, including all15 AI-native controller/adapter cases. Actual Chromium workbench PRD reads pass in English and Chinese, showing0.1.137, ANT01–ANT10 and the latest main requirements.
- **Scope.** No campaign agents, recurring schedules or business records were started. This source/tooling merge does not change the running production installation or claim external-client acceptance.

- **通过——合并与版本。** 将源分支截至 `fb58377` 的三条提交合入0.1.136主线，整合版为0.1.137；package/lock及双语PRD/路线图一致，主线发布历史与最新首页/卡片改动保持。分支草稿0.1.126–128保留为历史证据，不重复混入主线发行行。
- **通过——组合验证。** 全新锁定依赖安装后 `npm test` **458/458** 通过，无失败或跳过，包含15项AI-native控制器/适配器检查。实际Chromium工作台中英PRD均显示0.1.137、ANT01–ANT10和最新主线需求。
- **范围。** 未启动场景agent、周期调度或业务记录；本次为源码/工具整合，不改变线上生产安装，不据此宣称外部客户端实测通过。
