# Acceptance evidence · 0.1.126

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
