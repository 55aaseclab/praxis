# Knowledge roadmap / 路线图

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

Keep the standalone app and its Praxis integration working from an empty installation. Add new contracts with synthetic examples and tests.

维护空数据安装下的独立入口及 Praxis 集成。新增功能使用合成示例和测试。

## Interface language and library sidebar / 界面语言与文库侧栏

The interface follows the workbench language preference exclusively with no in-app language control, and the library sidebar renders the content directory without a literal contents label; the reading view keeps its page-outline block. Verify with synthetic fixtures that no language control or stray directory label renders and the reading outline still works.

界面仅跟随工作台语言偏好，不提供应用内语言设置；文库侧栏渲染内容目录时不显示字面目录标签，阅读视图保留本页目录区块。用合成夹具验证不渲染语言控件与多余目录标签，且阅读目录仍可用。

## Praxis provider / 工作台供数

Publish the app-owned card and data-source contract. Verify synthetic authorized records, native links, stable revisions, empty/error separation and metadata resolution. Keep storage keys, business records and video provisioning outside this module.

发布由应用维护的卡片与数据源合同，使用合成授权记录验证原生入口、稳定版本、空态与错误区分及元数据解析。供数模块不接触密钥、真实业务记录或视频引擎安装。

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

## 应用自有 Praxis 集成

本应用在所属仓库维护经审核的 `praxis-integration.mjs`，声明原生入口策略，以及已支持的类型明确的业务操作与 MCP 指引。Praxis 从已安装源码加载声明，继续统一执行授权、签名、策略租约与审计。安装声明不会授予访问权限，也不会启动后端；已有原生界面、数据归属与恢复边界继续生效。
