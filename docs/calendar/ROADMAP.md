# Roadmap / 路线图

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

0.1.0 delivers month navigation, daily agenda, scoped reminders and timed event export. Check short months, leap days, month navigation, keyboard access, mobile width and export escaping.

0.1.0 交付月份切换、每日议程、受控提醒和定时日程导出。验收小月、闰日、键盘操作、手机宽度及日历导出转义。

0.1.1 adds authorized day cards, exact-day links, identity-bound browser events and derived/browser/external data-location metadata. Verify empty sources, account isolation, stable revisions and genuine ICS export.

0.1.1 增加已授权日期卡片、日期深链、按身份隔离的浏览器日程，以及派生、浏览器和外部位置元数据；验收真实空状态、账号隔离、版本稳定及实际 ICS 导出。

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

## 应用自有 Praxis 集成

本应用在所属仓库维护经审核的 `praxis-integration.mjs`，声明原生入口策略，以及已支持的类型明确的业务操作与 MCP 指引。Praxis 从已安装源码加载声明，继续统一执行授权、签名、策略租约与审计。安装声明不会授予访问权限，也不会启动后端；已有原生界面、数据归属与恢复边界继续生效。
