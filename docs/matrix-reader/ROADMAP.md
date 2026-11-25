# Matrix Reader roadmap

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

[简体中文](#matrix-reader-路线图)

| Version | Scope | Acceptance |
| --- | --- | --- |
| 0.1.0 | Standalone reader, sign-in, verification, room scoping, mentions, bookmarks, search and source citations. | Isolated account covers device verification, excluded rooms and restoration on reload. |
| 0.1.1 | Select or clear all joined rooms during setup and in settings. | Filtering keeps the full selection available until confirmation. |
| 0.1.2 | English-first interface, Simplified Chinese and paired product documentation. | Switch languages during setup and reading, persist the choice, translate recovery states and preserve original messages. |
| 0.1.3 | Owner-bound browser workbench cards and read-only data-location metadata. | Selected-room messages produce stable exact-event cards; owner changes, room removal and sign-out invalidate them; no tokens or crypto keys enter the projection. |
| Later | Explore automation and delegated agent access after observing real use. | Show the scope of each action and link every result to its source. |

# Matrix Reader 路线图

| 版本 | 交付 | 验收 |
| --- | --- | --- |
| 0.1.0 | 建立独立浏览器应用，贯通首次登录、设备验证和阅读。实现房间范围、聚合阅读、提到我、收藏、搜索和按需复制原文上下文。 | 构建并用隔离账号验证首开和续读。覆盖加密设备验证、未选房间过滤和浏览器会话恢复。 |
| 0.1.1 | 首次设置和房间管理支持全选和取消全选。 | 搜索房间时仍可全选全部已加入房间，确认后才更新阅读范围。 |
| 0.1.2 | 界面以英语为主，支持简体中文，产品文档双语同步。 | 设置与阅读过程中可切换语言，错误提示和日期跟随语言，消息保留原文。 |
| 0.1.3 | 按所有者隔离的浏览器工作台卡片与只读数据位置元数据。 | 选定房间的消息形成稳定的精确来源卡片；账号变化、房间移除和退出时失效，投影不含令牌或加密密钥。 |
| 后续 | 在浏览体验和账号边界通过实际使用后，再确定自动整理和外部 Agent 的授权方式。 | 用户能看到每次交给 Agent 的范围，并能通过引用返回来源。 |

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

## 应用自有 Praxis 集成

本应用在所属仓库维护经审核的 `praxis-integration.mjs`，声明原生入口策略，以及已支持的类型明确的业务操作与 MCP 指引。Praxis 从已安装源码加载声明，继续统一执行授权、签名、策略租约与审计。安装声明不会授予访问权限，也不会启动后端；已有原生界面、数据归属与恢复边界继续生效。
