# Praxis workspace

For platform, app or app-data tasks, read the [Praxis operator skill](skills/praxis-operator/SKILL.md) and the affected app’s own instructions. Before changing product behavior, read the [product requirements](docs/PRD.en.md) and [roadmap](docs/ROADMAP.en.md). Maintain the platform and its tests here. Submit application changes to the owning repository, then pin a publicly fetchable revision in Praxis. Update English first and deliver Simplified Chinese in the same change. [Contributing](CONTRIBUTING.md)

## Keep small changes small

Choose the smallest check that exercises the changed behavior. For a PRD edit, open the affected document through the workbench PRD reader in both languages. For navigation changes, run `node --test tests/system-navigation.test.mjs tests/app-launcher.test.mjs` and check the affected workbench → app → Home flow on desktop and at phone width. Run `npm test` for integration changes. Expand coverage when a check fails, a cross-layer risk emerges or the release calls for it.

For a small UI fix, check the relevant interaction. Keep optional reviews and unrelated polish off the critical path. Finish source and browser checks before building the affected Docker target. Commit the verified change promptly and deploy within the scope of the task. Adding verification prose alone does not require rebuilding application images.

## Separate development from product use

Keep development and product use in separate sessions, identities, credentials, environments and audit trails, even when both roles use the same model. This maintenance role changes code, documentation, tests and necessary configuration. Use isolated synthetic fixtures. Keep business records, operator credentials and backups outside Git.

Live business operations belong to an independently authorized client. Route content updates to the designated external business agent over its scoped MCP connection. Never use maintenance access to files, CLI, SQL, HTTP or privileged helpers to create, change or delete real business records. Keep platform code and deployment privileges with the administrator.

Praxis exposes app capabilities to external agents. For an acceptance case that requires an isolated Paseo Codex business session or a physical phone running a third-party agent app, record the result from that client. See the [verification plan](docs/VERIFICATION.en.md) for the scope of each check.

## 简体中文

维护平台、应用或处理应用数据相关任务时，先读 [Praxis 运维技能](skills/praxis-operator/SKILL.zh-CN.md)及所属应用的说明。变更产品行为前，阅读[需求文档](docs/PRD.md)和[路线图](docs/ROADMAP.md)。平台与平台测试在本仓维护。应用改动先提交到所属仓库，再在 Praxis 固定可公开获取的提交。先更新英文，同一变更同步简体中文。[贡献指南](CONTRIBUTING.md)

### 按改动范围验证

先选能覆盖此次行为的最小检查。编辑 PRD 后，从工作台的需求阅读器分别打开中英文版本。修改导航时，运行 `node --test tests/system-navigation.test.mjs tests/app-launcher.test.mjs`，并在桌面和手机宽度下走通工作台 → 应用 → 首页。集成变更运行 `npm test`。检查失败、发现跨层风险或发布要求扩大覆盖时，再增加验证。

小型界面修复只检查相关交互。可选评审与无关润色不应阻塞交付。源码和浏览器检查通过后再构建受影响的 Docker 目标，及时提交已验证的改动，在任务授权范围内部署。仅补充验收记录时无需重建应用镜像。

### 分开开发与产品使用

即使使用同一模型，开发与业务使用也应分开会话、身份、凭据、环境及审计记录。维护角色负责代码、文档、测试和必要配置，测试使用隔离的合成数据。业务记录、运维凭据与备份保存在 Git 之外。

真实业务操作由独立获授权的客户端执行。内容更新交给指定的外部业务智能体，通过限定范围的 MCP 连接处理。维护会话不得利用文件、CLI、SQL、HTTP 或高权限辅助工具创建、修改或删除真实业务记录。平台代码和部署权限归管理员。

Praxis 向外部智能体提供应用能力。验收项要求使用隔离的 Paseo Codex 业务会话，或在实体手机上使用第三方智能体应用时，记录相应客户端的实际结果。各项验收范围见[验证方案](docs/VERIFICATION.md)。
