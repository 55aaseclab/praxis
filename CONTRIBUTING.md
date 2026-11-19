# Contributing to Praxis

[简体中文](#简体中文)

## Roles and ownership

| Role | Responsibility |
| --- | --- |
| Administrator | Owns product direction, repository access and rules, release policy, production credentials and deployment. Accepts changes to authorization, storage contracts, migrations and collaboration policy. May delegate a specific rollout. |
| Maintainer | Directly implements, verifies, commits and pushes changes within assigned repositories and agreed scope. Reviews external contributions and follows up on releases. Routine work does not require an issue, PR or another person's approval. |
| External contributor | Works in a feature branch or fork, supplies a focused PR and its evidence, and addresses review feedback. |
| Agent | Reads the relevant contracts, implements the assigned task and runs authorized checks. Follows the directing person's contribution path and existing authorization; that person owns the change and publication or deployment decision. |

The platform owns integration, navigation, identity and its own tests. Each application owns its implementation, data semantics and tests in its repository. Source fixes follow that ownership, then Praxis records a released app revision.

Keep production credentials in an administrator-controlled deployment environment. GitHub Maintain includes workflow and Actions-secret capabilities, so isolation also depends on the deployment environment and its approval controls. [GitHub repository permissions](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)

Administrators and maintainers can work directly in their assigned repositories. Read the applicable contracts, implement and verify the change, then commit and push. Use an issue, work branch or PR when it helps coordination or review. External contributions follow the issue and PR process below. Sensitive changes still require administrator authorization; existing authorization need not be requested again.

## Read before changing

Start with [AGENTS.md](AGENTS.md), this guide, the [operator skill](skills/praxis-operator/SKILL.md), and the affected repository's instructions. Use the [documentation index](docs/README.md) to find the applicable contract.

| Change | Read and cite the relevant section in task notes, delivery evidence or an issue/PR |
| --- | --- |
| Product behavior | Owning PRD and roadmap, plus the [platform requirements](docs/PRD.en.md) and [roadmap](docs/ROADMAP.en.md) for integration changes |
| Interface or navigation | [UI/UX guide](skills/praxis-operator/references/ui-style-guide.en.md), [workbench interactions](docs/UI-UX.md), owning app UI/data contract |
| Persistence, backup or migration | [Storage and recovery](docs/STORAGE.en.md), [business backup scope](docs/BUSINESS-STORAGE.en.md), affected schema and migration contract |
| Identity, permissions or agent tools | [Authorization](docs/BUSINESS-AUTH.en.md), [sign-in](docs/UNIFIED-LOGIN.en.md), relevant [verification cases](docs/VERIFICATION.en.md) and tool skill |
| Containers or deployment | [Running Praxis](docs/RUNNING.md), [deployment](docs/DOCKER.en.md), [managed installation](docs/MANAGED-DEPLOYMENT.md), recovery procedure |
| App or submodule integration | [App standard](docs/APP-STANDARD.md), [repository publication](docs/REPOSITORIES.md), app requirements and release branch |

Read the sections that govern the affected behavior. Before implementation, an agent should identify the owning repository, contract references, acceptance criteria, test data and planned checks. Record those references with the work so another person can verify the same outcome. When an app task runs in a separate checkout, include public Praxis guide links pinned to a platform commit in the task brief or issue. Keep app-specific instructions and contracts in the app repository.

## Issues and acceptance criteria

External contributors open an issue before proposing a new feature, workflow or public interface change, permission or storage change, migration, or cross-repository task. Include the user task, affected repository, concrete example and observable success conditions. A small, clearly defined bug, translation or documentation correction can go directly to a PR. Administrators and maintainers can proceed directly within their agreed scope and record acceptance criteria and results with the task or delivery.

Use observable acceptance criteria tied to the relevant PRD, roadmap or guide section. An issue or PR can give them identifiers such as AC1 and AC2. Update the owning PRD and roadmap before implementing changed behavior. The maintainer resolves ownership and implementation questions; the administrator accepts changes to product scope or sensitive contracts.

For external cross-app contributions, keep a tracking issue in Praxis and link the app issues and PRs to it. Close it after the required app revisions are integrated and the combined acceptance criteria pass. Internal maintenance can record the same dependencies in task notes without opening issues.

## Branches and commits

- External contributors use a short-lived branch or fork based on the target release branch, for example `fix/123-reminder-filter` or `feat/123-source-import`. Administrators and maintainers may commit directly to the release branch or use a work branch when useful.
- Keep commits focused on one problem. External PRs should solve one complete problem; split unrelated work and use drafts for pending dependencies or early discussion.
- Make commits that describe an observable result. Prefer `type(scope): summary`, such as `fix(knowledge): preserve imported source references` or `docs(storage): clarify restore verification`.
- PR branches can contain multiple implementation and fix commits. Default to squash merge for external PRs. Direct maintenance commits need no PR wrapper.
- Coordinate a versioned change with the latest release branch before publication. Use `npm run version:patch` once for a platform behavior change and keep the package, lockfile and English/Chinese release records aligned. App versions follow their own policy. Editorial corrections can retain the current version.
- Protect merged release history. Use a follow-up fix or revert for a merged change. A contributor rebasing their own work branch uses `--force-with-lease` and reruns affected checks after changing the reviewed head.

## One platform and multiple app repositories

1. Confirm the app repository and release branch from [.gitmodules](.gitmodules) and its contribution instructions. Memo, TingProof and Lattice currently publish the Praxis distribution from `praxis-release`; the Polaris component is the independent reader repository.
2. Implement app behavior and its tests in the app repository. Administrators and maintainers can commit and push to its release branch within their authorization. External contributors open an app PR; a dependent Praxis PR can remain a draft.
3. Publish the app change first. For an external contribution, review and merge the app PR first. Use the final released commit SHA, including the new SHA produced by a squash merge.
4. Update the parent gitlink to that released SHA. Record the exact revision, integration checks and any child PR in the task or Praxis PR. A source revision must be anonymously fetchable and reachable from the configured release branch.
5. Run the app's own checks and the relevant platform checks against the actual combination. Changes to navigation or transport also exercise the native interface and the trip back to the workbench.
6. Publish the platform change after its dependencies and acceptance criteria pass. External contributions merge through their Praxis PR. Record any separately assigned release or deployment follow-up.

## Evidence and review

Map every acceptance criterion to a check and a result. A useful entry includes the contract reference, repository SHA, environment, command or interaction, and the actual outcome.

| Change | Minimum relevant evidence |
| --- | --- |
| Documentation or copy | English/Chinese correspondence and working links; changed PRDs render through the workbench reader |
| Local behavior fix | Focused check covering the reported failure, expected behavior and relevant valid/invalid input |
| UI or navigation | Affected interaction and states with synthetic content, keyboard where applicable; navigation changes exercise desktop/phone-width entry and return |
| Permissions or MCP | Allowed and denied cases, resource/action bounds, expiry or revocation where affected, and absence of unintended effects on rejection |
| Storage or migration | Synthetic before/after data, integrity and identity checks, retry behavior, consistent backup and trial recovery where affected |
| Containers or app integration | Clean build and startup of affected services, actual native operation, read-back and restart persistence; full-distribution changes cover all built-ins |
| Independent client or device claim | The applicable external-client, physical-phone or cloud-recovery proof described by the verification plan |

For example, a language-settings change can require that the choice survives reload and applies to the PRD reader, based on the requirements and UI guide. A storage move can require unchanged workspace identity, verified committed records and a successful empty-directory restore, based on the storage contract. Fill the evidence column from the actual check.

Use Pass, Fail, Pending or N/A with a reason. Label synthetic data, mocked services and illustrative output accurately. Supply actual logs, screenshots or artifact checks for claims about a real run. Keep private records, tokens and deployment configuration out of commits, issue bodies and public evidence.

External PRs require review by a maintainer or administrator before merge. Administrators and maintainers are responsible for their direct changes and can request another review when useful. Sensitive changes require administrator acceptance within the task's authorization. Agent review can supply additional findings and checks.

Complete the checks required for source delivery. If a release check must run later, record the remaining check, responsible role and condition for deployment. For an external PR, the reviewer accepts that follow-up. Record source publication, release and deployment outcomes separately.

When a task includes rollout to a local self-hosted installation, complete the authorized deployment and check the running entry. Maintainers validate in their authorized development or staging environment. Production rollout belongs to the administrator or an explicitly delegated operator. SaaS deployments follow their release plan.

## GitHub gates

The repository CI provides a stable `Platform checks` check on PRs and pushes to `main`. It verifies anonymous released app pins, installs locked platform dependencies and runs the synthetic platform suite, including version checks. App changes also run their owning repository's checks. Record relevant browser interactions, private recovery and independent-client evidence with the task or PR. A direct push triggers CI after publication, so maintainers run the relevant checks locally first and address any CI failure promptly.

External PRs should have passing CI, resolved review conversations and maintainer or administrator approval before merge. If configuring GitHub rules, preserve administrator and maintainer direct-push access, including an appropriate bypass for any PR requirement. Prevent release-history force pushes and branch deletion where supported. Enable required checks only after the workflow has actually passed. Use squash merge for external PRs and remove merged work branches.

CODEOWNERS can route external contribution reviews once the responsible teams have the required repository access. Repository settings and protection must be checked separately from this document. [GitHub rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) · [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

Contributions use the [Apache 2.0 license](LICENSE). Follow the [code of conduct](CODE_OF_CONDUCT.md).

## 简体中文

### 角色与归属

| 角色 | 职责 |
| --- | --- |
| 管理员 | 负责产品方向、仓库权限和规则、发布策略、生产凭据与部署；验收授权、存储合同、迁移和协作规则的变更，可明确委派一次发布。 |
| Maintainer | 在负责仓库和约定范围内直接实现、验证、提交并推送，评审外部贡献并跟进发布；日常工作无需先开 issue、PR 或等待另一人批准。 |
| 外部贡献者 | 通过工作分支或 fork 提交范围明确的 PR、验证依据并处理评审反馈。 |
| Agent | 阅读相关合同、实现任务并运行已授权检查，遵循发起者对应的贡献流程和已有授权；发起者对改动及发布、部署决定负责。 |

平台负责集成、导航、身份和自身测试，应用在所属仓库维护实现、数据含义和测试。应用修复先进入所属仓库，再由 Praxis 固定已发布版本。

生产凭据存放在管理员控制的部署环境。GitHub Maintain 包含工作流及 Actions secret 相关能力，部署隔离还需依靠环境与审批控制。[GitHub 仓库权限](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)

管理员和 maintainer 可在负责仓库直接工作：阅读适用合同、实现、验证，然后提交并推送。需要协调或评审时再使用 issue、工作分支或 PR。外部贡献遵循下文的 issue 和 PR 流程。敏感变更仍须管理员授权，已有授权无需重复索取。

### 改动前阅读

先读 [AGENTS.md](AGENTS.md)、本指南、[运维技能](skills/praxis-operator/SKILL.zh-CN.md)和所属应用说明，通过[文档目录](docs/README.md)找到适用合同。

| 变更 | 阅读并在任务说明、交付证据或 issue/PR 引用相关章节 |
| --- | --- |
| 产品行为 | 所属 PRD、路线图；跨层集成同时读[平台需求](docs/PRD.md)与[路线图](docs/ROADMAP.md) |
| 界面与导航 | [UI/UX 指南](skills/praxis-operator/references/ui-style-guide.md)、[工作台交互](docs/UI-UX.md)、应用界面与数据合同 |
| 持久化、备份或迁移 | [存储与恢复](docs/STORAGE.md)、[业务备份范围](docs/BUSINESS-STORAGE.md)、受影响的 schema 与迁移合同 |
| 身份、权限或智能体工具 | [业务授权](docs/BUSINESS-AUTH.md)、[统一登录](docs/UNIFIED-LOGIN.md)、相关[验收用例](docs/VERIFICATION.md)与工具技能 |
| 容器与部署 | [运行指南](docs/RUNNING.md)、[Docker 运维](docs/DOCKER.md)、[受管安装](docs/MANAGED-DEPLOYMENT.md)及恢复流程 |
| 应用或子模块集成 | [应用标准](docs/APP-STANDARD.md)、[仓库发布](docs/REPOSITORIES.md)、应用需求和发行分支 |

按受影响行为阅读对应章节。实现前，agent 应明确所属仓库、合同引用、验收条件、测试数据和检查计划，随任务保存这些依据，让另一人能复核同一结果。应用任务在独立检出中执行时，在任务说明或 issue 附上固定到平台提交的公开 Praxis guide 链接；应用自身的维护说明和合同仍放在应用仓。

### Issue 与验收条件

外部贡献者提议新增功能、工作流或公共接口变化、权限或存储变更、迁移、跨仓任务时先开 issue，说明用户任务、所属仓库、具体例子及可观察的成功条件。范围明确的小缺陷、翻译和文档修正可直接 PR。管理员和 maintainer 可在约定范围直接执行，在任务或交付说明中记录验收条件与结果。

采用可观察的验收条件，关联对应 PRD、路线图或 guide 章节。Issue 或 PR 中可用 AC1、AC2 编号。行为变更先更新所属 PRD 和路线图，再实现。Maintainer 确认归属和实现问题；产品范围或敏感合同的变化由管理员验收。

外部跨应用贡献在 Praxis 保留总 issue，关联各应用 issue 和 PR；应用版本全部集成、组合验收通过后关闭总 issue。内部维护可直接在任务说明中记录依赖，无需创建 issue。

### 分支与 Commit

- 外部贡献者从目标发行分支建立短分支或 fork，例如 `fix/123-reminder-filter`、`feat/123-source-import`。管理员和 maintainer 可直接向发行分支提交，需要时再使用工作分支。
- Commit 聚焦一个问题。外部 PR 解决一个完整问题，无关工作分开；待合并依赖或提前讨论使用 draft。
- Commit 描述可观察的结果，推荐 `type(scope): summary`，例如 `fix(knowledge): preserve imported source references`、`docs(storage): clarify restore verification`。
- PR 分支内可有多个实现和修复提交；外部 PR 默认 squash merge。直接维护提交无需额外套一层 PR。
- 发布前和最新主线协调版本。平台行为改动使用一次 `npm run version:patch`，同步 package、lockfile 和中英文发布记录；应用使用自己的版本策略，单纯文字编辑可保留版本。
- 保护已合并历史，用后续修复或 revert 处理问题。重排个人工作分支时使用 `--force-with-lease`，并在评审 head 变化后重跑受影响的检查。

### 一主仓、多应用仓的发布顺序

1. 从 [.gitmodules](.gitmodules) 和应用维护说明确认仓库与发行分支。Memo、TingProof、Lattice 当前使用 `praxis-release` 发布 Praxis 组件；Polaris 使用独立 reader 仓库。
2. 应用实现和测试进入应用仓。管理员和 maintainer 可在授权范围直接提交并推送到其发行分支；外部贡献者提交应用 PR，依赖它的 Praxis PR 可先开 draft。
3. 先发布应用改动。外部贡献先评审合并应用 PR，再取最终发行 SHA；squash merge 后应使用新生成的 SHA。
4. 父仓更新为该已发布 SHA，在任务或 Praxis PR 中列出具体提交、集成检查及存在的子 PR。源码须可匿名获取，并位于约定发行分支的历史中。
5. 同时验证应用自身与平台实际组合。导航或传输变化还需检查原生界面与返回工作台的路径。
6. 依赖与验收条件通过后发布平台改动；外部贡献通过 Praxis PR 合并。另行记录有明确负责人的发布、部署事项。

### 验证证据与评审

每个验收条件都要有对应检查和结果，至少包含合同引用、仓库 SHA、环境、命令或交互以及实际观察。

| 变更 | 最小相关证据 |
| --- | --- |
| 文档或文案 | 中英文一致、链接有效；修改过的 PRD 通过工作台阅读器回读 |
| 局部行为修复 | 覆盖原缺陷、预期行为及相关有效/无效输入的定向检查 |
| UI 或导航 | 使用合成内容检查受影响的交互与状态，适用时检查键盘；导航变更检查桌面/手机宽度的入口与返回 |
| 权限或 MCP | 允许与拒绝、资源及动作边界、受影响的到期/撤权行为，拒绝时无意外副作用 |
| 存储或迁移 | 合成数据迁移前后、完整性与身份核对、重试、一致备份及受影响的试恢复 |
| 容器或应用集成 | 受影响服务干净构建、启动、实际原生操作、回读与重启持久化；发行版整体变化覆盖全部内置应用 |
| 独立客户端或设备声明 | 按验收计划提供相应外部业务客户端、实体手机或云恢复证据 |

例如，语言设置改动可按需求及 UI 指南要求“刷新后选择仍生效、PRD 阅读器采用同一语言”；存储迁移可按存储合同要求“工作区身份一致、已提交记录完整、向空目录恢复成功”。证据列填写实际检查所得。

状态使用 Pass、Fail、Pending、N/A，并说明原因。准确标注合成数据、模拟服务和示意输出。声明真实执行时提供实际日志、截图或产物检查。私人记录、令牌和部署配置不进入提交、议题或公开证据。

外部 PR 须经 maintainer 或管理员评审后合并。管理员和 maintainer 对自己的直接改动负责，需要时再请另一人评审。敏感变更按任务已有授权由管理员把关。Agent 评审可以补充发现和检查。

源码交付前完成相应检查。发布检查需要后续执行时，列出剩余事项、负责角色及部署前置条件；外部 PR 由评审者接受后续安排。分别记录源码发布、发行与部署结果。

任务包含本地自托管安装发布时，完成已授权的部署并回读入口。Maintainer 在获授权的开发或 staging 环境验证；生产发布由管理员或明确受委派的操作员执行，SaaS 按发布计划部署。

### GitHub 门禁

仓库 CI 在 PR 和 `main` 推送时运行固定检查 `Platform checks`，验证应用已发布 pin 可匿名获取、安装锁定的平台依赖并运行包含版本检查的合成测试。应用改动同时运行所属仓库检查；相关浏览器、私有恢复及独立客户端证据记录在任务或 PR 中。直接推送的 CI 在发布后运行，因此 maintainer 应先运行相关本机检查，及时处理 CI 失败。

外部 PR 合并前应通过 CI、解决评审讨论，并获得 maintainer 或管理员认可。配置 GitHub 规则时保留管理员和 maintainer 的直接推送权限；存在强制 PR 规则时为其设置适当的绕过权限。支持时保护发行历史，禁止强推和删除。先实际跑通工作流，再设置 required check。外部 PR 默认 squash merge，合并后清理工作分支。

组件责任团队获得相应仓库权限后，可用 CODEOWNERS 路由外部贡献的评审。远端权限、规则是否生效需另行核对。[GitHub 分支规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) · [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

贡献采用 [Apache 2.0](LICENSE)，请遵循[行为准则](CODE_OF_CONDUCT.md)。
