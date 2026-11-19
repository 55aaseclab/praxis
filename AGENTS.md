# Working on Praxis

Maintain the platform and its own tests here. Keep app changes in the owning app repository and pin a publicly fetchable revision when an integration needs it. Keep business records and operator credentials outside Git. Use isolated synthetic data when developing or testing. Live business operations belong to independently authorized clients.

Read the product requirements and roadmap in `docs/` before changing product behavior. Keep English and Simplified Chinese in sync. Use focused tests for small changes. Run `npm test` for integration changes and verify navigation into and out of the affected app. [Contributing](CONTRIBUTING.md)

## 简体中文

平台和平台测试在本仓维护。应用改动提交到所属仓库，集成时固定可公开获取的提交。业务资料与凭据存放在 Git 之外，开发和测试使用隔离的合成数据，真实业务操作由独立获授权的客户端执行。

变更产品行为前先阅读 `docs/` 的需求和路线图。先更新英文，同步简体中文。小改动运行定向测试，跨层集成运行 `npm test`，并核对应用入口和返回工作台的导航。[贡献指南](CONTRIBUTING.md)
