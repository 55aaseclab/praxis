# 长期 AI-native 测试

简体中文 · [English](README.md)

这是显式启动的外部客户端测试框架，不是 Praxis 内部 agent。[平台 PRD ANT01–ANT10](../../docs/PRD.md#长期-ai-native-testing) 定义验收。`npm test` 只运行确定性的合成框架检查，不启动 Paseo agent。安装、import 和初始化不会创建测试会话、周期调度、真实交易或部署。

## 结构与角色

`campaigns.mjs` 保存三个双语场景、九位稳定角色、有限覆盖矩阵及带种子的情境变化；`controller.mjs` 用私有 SQLite 保存状态、派发和审批；`adapters/paseo.mjs` 用公开 Paseo SDK 创建会话、读取元数据及发送消息，并通过不经 shell 插值的 CLI 做发现/核对；`runner.mjs` 先预留再外部执行。`prompts.mjs` 分离业务与维护输入。主控读取[技能](../../skills/ai-native-testing/SKILL.zh-CN.md)。

| 场景 | 人员 | 应用与连续性 |
| --- | --- | --- |
| 家庭旅行 | 规划者、探索者、重视舒适的成员 | Travel、Reminder；同一家三人跨目的地积累历史，处理意见、个人准备和真正需要行动的共享提醒。三十个初始目的地不是终点。 |
| AI 时代的漏洞管理新范式 | Research 导师/学生、Productization 工程师、Marketing、Finance/支持 | Reminder、Knowledge、Lattice、Memo、Polaris、Projects、Intelligence；需求→研究→工程→市场交付/反馈→财务支持，可退回、修订。研究归合成学校主体，其余归合成公司。 |
| 专职模拟投资者 | 一人 | Reminder、Memo、Intelligence、Polaris；初始模拟本金100万元、争取10%净收益，开始前必须明确 market/horizon/asOf，交易、成交、费用和资金均为合成。 |

精确模型：主控 `opencode/hexhive005-main/zai-org/GLM-5.3-Flash`；worker `opencode/hexhive005-work/zai-org/GLM-5.3-Flash`；Maintenance `codex/gpt-6.1-sol`、`ultra`，不覆盖默认 context window。发现失败不替换模型。主控与 Maintenance 独立于全局 worker 单槽；Maintenance 预留/执行期间阻止新业务任务，避免边改环境边测试。每次介入均须人工确认。worker 不设 token 预算、场景不设固定到期时间。额度或 provider 故障保留进度，不因此盲目重试。

测试配置包含 `fullAccess: true`、`communication: "paseo-send-message"`。OpenCode 在 build mode 下、首条任务开始前应用已发现的 `auto_accept: true`，Codex 用 full-access。普通工具权限不打断人工，真正的问题及逐次 Maintenance 确认仍须交互。先配置空闲会话，再经公开 SDK `agent.send` 发送首条任务，后续也用 send message。agent 间汇报、追问和协调统一用公开 SDK/MCP 发送消息或 `paseo send`，不读对方文件、不轮询日志代替通信；应用回读/状态检查仍用于验收，不当消息传输。不得绕开占槽唤醒额外空闲 worker。远程 binding 的 host 须为可达 ws/wss/tcp URL 或 host:port（SSH 先建立转发），不嵌入凭据。既有安装可运行 `configure-runtime --state /private/testing/campaign.sqlite` 持久保存默认值，不重置角色或历史；已经运行的 OpenCode 会话通过公开 Paseo Auto Accept 设置启用一次。

Personality 影响选择，不是固定剧本。情境抽样种子和结果按任务持久化，可复现输入刺激，不承诺模型输出完全相同。角色只接收自己的性格、目标和本轮新信息，不接收其他角色私有讨论。保留正常 shell、本地文件、浏览器/联网及 OAuth/MCP 配置工具。可研究真实公开资料，业务账户、数据及操作使用隔离的合成夹具，并由真实服务端执行授权。

## 先配置，不启动

需要 Node 22.16+ 的 SQLite 和已安装的 Paseo CLI。一个状态文件定义**本测试安装的全局槽**，不得另开副本绕过。状态、配置、审批、证据、客户端工作文件保存在 Git 外。SQLite 文件权限0600，新父目录0700。状态不是应用存储，也不需要审批密钥，其目录由预期主控身份保护。

为主控、九位业务角色和 Maintenance 分配独立 Paseo 工作区。角色各有业务账户和指向指定测试环境的 scoped OAuth/MCP 连接，不复制管理员或备份凭据。主控可操作框架，无权自行修代码。Maintenance 只获得源码工作区和合成夹具环境。先发现 Paseo 主机与 profiles；源码验证时没有已配置 profile，故使用已发现的精确模型。binding 可选 `host` 指定 CLI 端点，路径与 workspace ID 均属于目标端点；host 字符串不嵌入凭据。

建号、建团队、同意和业务操作**仅经公开支持界面、已文档化公开 API 或公开 MCP**。不调用内部/未公开端点、管理员 bootstrap、SQL、高权限辅助工具或服务端文件补流程。保留正常客户端工具及文档化本地框架命令；缺少公开入组流程就是测试结果，不代替客户端从后台建号。

人工审批直接在 Paseo 提问与回复，不生成密钥、不配签名服务，也不要求 operator 密钥即可开始测试。

```sh
npm run ai-native -- config-example
npm run ai-native -- help --lang zh
```

按输出模板替换工作区、路径并设置公开 canonical HTTPS `origin`。尚未确定投资市场、期限和 ISO 信息截止时点时移除 `investment`。九个角色 key 固定，每个工作区独立。配置不含 OAuth token，直接在相应获授权客户端内配置。

```sh
node tests/ai-native/cli.mjs init --state /private/testing/campaign.sqlite --input /private/testing/config.json --lang zh --seed campaign-1
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign family-travel
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign security-research
node tests/ai-native/cli.mjs report --state /private/testing/campaign.sqlite --lang en
```

初始化保持暂停。投资参数缺失时拒绝创建该轮。每个场景内部顺序推进，一组阻塞时另一组仍可工作。第30站后用 `--destination` 指定新目的地，不意味着重置或完成。投资后续轮次仍使用同一个初始本金参照、账户和账本，不补充本金、不使用截止时点后的信息。投资轮次验收后，`advance-investment --as-of ISO` 可明确推进到更晚且已经过去的信息截止时点，记录变化，保留原角色、本金及账本；未完成轮次、倒退时间或未来信息均拒绝。修改市场/期限须另行评审配置，不静默改写正在进行的实验。

## 通过 Paseo 启动与推进

仅在测试环境、身份与凭据齐备后：

```sh
node tests/ai-native/cli.mjs resume --state /private/testing/campaign.sqlite
node tests/ai-native/cli.mjs coordinator --state /private/testing/campaign.sqlite
```

在指定工作区启动或恢复 main 主控。主控通过 `status`、`next`、`dispatch --task ID` 派发，角色结束本轮后 `collect --dispatch ID`。各角色复用状态中保存的原会话。恢复和回收前核对实际 provider/model/mode/cwd；新建时明确绑定工作区。提示词不产生权限，仍须按 C01 等验收检查真实 OAuth、发现、grants 和应用结果。

`collect` 必须先观察本次派发进入 running，再在 idle/error 时释放占槽，排队中的空闲接收者不能释放。极短任务若未观察到 running，保留为 `awaiting_start_evidence`，须依据实际执行证据在 Paseo 取得明确人工核对结果。回收不表示业务成功。用 `verify --task ID --input /private/testing/evidence.json` 提交独立证据：

```json
{
  "version": "actual-running-version",
  "reviewer": "independent-verifier",
  "assisted": false,
  "checks": [{"kind":"mcp-readback","reference":"private-evidence-reference","passed":true,"expected":"synthetic expected assertion","actual":"independently observed assertion"}]
}
```

检查类型：`mcp-readback`、`native-view`、`service-assertion`、`denial-no-side-effects`。失败还须提供 `failureCategory`：`connection`、`permission`、`capability`、`handoff`、`recovery` 或 `unusable-result`。reviewer 不能是被测角色。引用保持私有，须有实际独立观察；schema 自身不是验证器。不得把角色文字或进程成功退出自动转换为通过，证据不足时保持待验收。

`pause` 阻止新派发，不杀死在途 agent；变更环境前先检查/回收。`resume` 保留所有占槽。不安装周期调度。未来 operator 可在明确授权的外部 Paseo schedule 中调用 `coordinator`，此次只交付显式入口。主控等待人工或证据时结束本轮，前置条件就绪后再唤醒。

## 人工确认 Maintenance

先把失败缩减为最小、语义脱敏的合成技术复现。人工必须审阅精确问题包；任意文本字段无法自动证明不含业务信息。格式如下：

```json
{
  "component": "technical component identifier",
  "repository": "/source/praxis",
  "baseRevision": "0123456789abcdef",
  "reproduction": "Minimal synthetic reproduction; no business content or external record links.",
  "expected": "Technical invariant",
  "actual": "Observed invariant violation",
  "files": ["src/example.mjs", "tests/example.test.mjs"],
  "verification": ["A targeted synthetic check and any authorized test-environment release check"]
}
```

repository 必须等于某个已配置维护 cwd。可在 `maintenanceTargets` 数组增加应用源码工作区，每项为 `{workspaceId, cwd, host?}`，仓库路径须唯一。修复按已批准的 repository 选择工作区，保留原业务会话。先发布子仓再固定平台 pin，不在父仓修应用实现。仓库规则要求同步的文档和测试也须纳入明确批准的文件范围，新发现更大范围须重新审批。不含课题、角色身份、研究/投资/旅行内容、截图、原始业务日志、凭据或私有来源文档。

```sh
node tests/ai-native/cli.mjs repair --state /private/testing/campaign.sqlite --tasks FAILED_TASK_ID --input /private/testing/technical.json
node tests/ai-native/cli.mjs approval-request --state /private/testing/campaign.sqlite --request REQUEST_ID --out /private/testing/review.json
```

主控通过正常 question 工具在 Paseo 展示精确技术问题包和范围；没有该工具时在 Paseo 会话中提问。由你直接批准或拒绝。未回复时保持阻塞，询问含义也不算批准，不要求签文件或配置密钥。

收到实际明确人工答复后，主控才在私有 JSON 记录问题标识、原答复、回复引用与决定：

```json
{"questionId":"approval-request 返回的问题标识","replyReference":"paseo:用户消息或权限答复标识","answer":"批准本次维护","decision":"approve"}
```

```sh
node tests/ai-native/cli.mjs approve --state /private/testing/campaign.sqlite --request REQUEST_ID --input /private/testing/paseo-reply.json
node tests/ai-native/cli.mjs maintenance --state /private/testing/campaign.sqlite --request REQUEST_ID
```

拒绝用 `decision: "reject"`，不得编造或自答。回执是会话流程审计，不是防能修改框架/状态的任意客户端的身份安全边界。确认绑定问题和精确包摘要，Paseo 调用前单次消耗，不能授权下一次介入。每次新建纯技术维护会话。拒绝或失败的已完成介入可用 `reject --request ID --reason 文本` 结束，再发起新问题。扩大范围须新提问和人工答复。此次源码纠正由你明确要求改用 Paseo 提问授权，后续仍逐次确认。

回收完成的维护会话。通过 `release --request ID --input RELEASE.json` 提交 `version`、源码 `commit`、合成 `verification` 引用和测试环境实际 `deploymentEvidence`，不包含业务正文。再 `retry --task ID --reason 文本`，原角色在指定运行版本从原断点复测，验收版本必须匹配。失败后不能对同一修复版本无限重跑，需新修复/新审批。无关的暂时连接故障可以明确说明原因后重试；其他失败保持阻塞。此次框架搭建由用户实施指令授权，未来每次测试维护仍须在 Paseo 明确人工确认。

## 中断与不明派发

SQLite 事务跨进程序列化预留，占槽不自动过期；调用 Paseo create/send 前先提交预留。CLI 回执丢失进入 `uncertain`。`reconcile --dispatch ID` 用不透明派发 label 查找新会话，只有一个精确匹配且身份/模型正确时才接管。零或多个匹配保持阻塞。send 回执丢失需要 operator 证据，不能凭 idle 判断消息已交付或未接受。

人工核对时，在 Maintenance 之外检查真实 Paseo 队列/时间线证据，并在 Paseo 提问。私有文件的 `resolution` 恰含 `runId`、`dispatchId`、`agentId`、`decision`、`evidence`、`questionId`、`replyReference`、`answer`。`delivered` 指定原 agent，`not-dispatched` 的 agentId 为 null，并须明确证据证明无排队、运行或已提交请求。记录实际人工答复后 `resolve --input 核对结果.json`。已交付工作仍须身份检查、回收和业务验收；未派发工作保留失败。已消耗维护确认不可复用，不因时间过去或 idle 就推断未执行。

## 指标与边界

`report --lang en|zh` 提供本地化摘要与稳定 JSON 字段。覆盖单元是场景 step ID，初始27个单元除业务流程外还包含九位角色逐一接入/重连和三个明确跨范围拒绝用例，分母有版本。`exclude --task ID --reason 文本` 记录 N/A 并增加版本；保留原因，不用 N/A 隐藏产品缺陷。覆盖率=已尝试适用单元/适用单元；通过率=最近通过单元/已尝试适用单元。失败和待验收分开，未开始仍是 `not_run`。全部尝试保留。自主完成率=无辅助通过任务/已尝试任务；恢复率=通过的关联修复任务/关联修复任务。没有观察时为 null，不是100%。

这是初始行为矩阵，不是穷尽的 UI/API 覆盖。从实际发现的缺口经双语源码变更扩展。确定性的控制器检查不能证明真实客户端入组、人类可用性、投资盈利、实体手机、多用户负载或所有应用能力已完成，分别收集证据。Intelligence 写入或 Polaris 业务可见性缺失时如实报告，不提权、不造记录。源码检查与实际运行台账分开。
