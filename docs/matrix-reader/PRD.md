# Matrix Reader product requirements

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

Version: 0.1.3

[简体中文](#matrix-reader-产品需求)

Matrix Reader is a standalone, read-only Matrix client. A person signs in to their own homeserver and verifies a separate device. Their existing Matrix clients continue to provide messaging.

## Requirements

- **First run.** Discover the homeserver from a Matrix ID or URL. Offer device authorization or password login according to the server's capabilities. Verify the device with an existing trusted session or a recovery key before showing room selection. Restore the same device on reload. Return to sign-in if the server revokes it.
- **Reading.** Show recent messages, mentions, bookmarks and individual rooms. Preserve sender, timestamp, citations, source links, search, reading position and explicit navigation to new arrivals. Reading preferences are local to the browser.
- **Room selection.** Include only rooms the user selects. Select all and clear all apply to all currently joined rooms, including those hidden by a search. Apply changes on Save or Start reading. Sync and fetch history only for the chosen rooms. Matrix sessions and encryption state are stored in the browser.
- **External agents.** Users can preview a bounded set of messages with timestamps and source links before copying them for an external agent.
- **Recovery.** Show progress, errors, missing historical keys and actionable recovery in the current language.
- **Languages.** Start in English and offer Simplified Chinese on setup and reading screens. Remember the selection, format dates in that language, and preserve room names, sender names and messages verbatim. Maintain the English text first and its Chinese translation in the same release.

Verify the sign-in, device verification, room selection, browsing, source navigation and reload journey with synthetic accounts. Record real-account acceptance separately.

## Private workbench cards

In managed mode, only a verified reader with selected rooms can publish a bounded read-only projection for the same native Praxis user. Use genuine loaded message IDs, content revisions, timestamps and exact room/event links. Saved messages and mentions can appear before the latest message of a selected room. Exclude unreadable encrypted messages, deselected rooms and redacted events. The projection contains readable excerpts, never access tokens or crypto keys, and expires after fifteen minutes without a refreshed native reader. A different Praxis account, Matrix sign-out or session expiry invalidates it. Personal workbench handling changes no Matrix room or message state.

Describe browser preferences, device crypto storage and the workbench projection as browser-owned locations; homeserver history remains externally owned. Neither the server nor external MCP reads the browser crypto store. Verify account boundaries, room removal, real empty state, stable revisions and exact room/event navigation using synthetic data.

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

# Matrix Reader 产品需求

版本：0.1.3

Matrix Reader 是面向浏览的独立 Matrix 客户端。用户用自己的 Matrix 账号登录，应用以单独设备连接 homeserver。用户可在原有客户端继续聊天。

## 0.1.0 版

- **首次打开**。填写 Matrix 账号或服务器，完成设备码授权，或按服务器支持的方式登录。用现有已验证会话完成表情核对，或使用已有的 Matrix 恢复密钥。本次验证成功后才让用户选择并打开房间。刷新和下次访问恢复同一设备，设备撤销后返回登录。
- **浏览**。侧栏切换最新动态、提到我、收藏与单个房间。主栏按时间显示正文、来源、发言人、引用与日期。能按关键词找已读入的消息、进入上下文、续读和打开原消息。新消息单独提示，保留当前位置。阅读、置顶和收藏只写入当前浏览器的偏好。
- **授权范围**。加入的房间由用户显式选择。首次设置和房间管理都支持全选与取消全选，作用于全部已加入的房间，点击保存或开始阅读后生效。连接器按房间限制消息同步和历史读取。新增房间要通过设置选择。即使底层账号令牌具有读写权限，产品的消息界面只读。消息、登录和加密请求直达 Matrix 服务器。账号会话与加密状态保存在当前浏览器。正文始终作为文本渲染。
- **交给 Agent**。用户可装入当前视图的若干条消息、来源和时间，预览后明确复制给外部 Agent。浏览应用不内置模型或自动上传消息。
- **异常**。授权、验证、房间同步都有进度、失败提示和恢复入口。历史加密消息缺少密钥时显示状态。源协议、显示密度和返回位置适配手机和桌面。

- **语言**。默认英语，首次设置与阅读页均可切换简体中文，记住选择并按语言显示日期。房间、发言人和消息保留原文。先维护英文，再在同一版本更新中文。

验收从首次未登录开始，贯通授权、设备验证、选择房间、切换、查看来源、回到原阅读位置与刷新。分别记录合成测试和本人账号使用证据。

## 私人工作台卡片

受管模式中，只有已验证且已选房间的阅读器，才能为同一原生 Praxis 用户发布数量有限的只读投影。使用实际已读取消息的 ID、内容版本、时间戳和精确房间/消息链接；优先显示本人收藏、提及及选中房间的最新消息。排除无法解密、已取消选择房间和被撤回的消息。投影保存可读摘录，不包含账号令牌或加密密钥；原生阅读器十五分钟未刷新后过期。Praxis 账号变化、Matrix 退出或会话过期时使投影失效。个人卡片操作不改变 Matrix 消息或房间状态。

数据清单将浏览器偏好、设备加密存储和工作台投影标为浏览器归属，homeserver 历史仍归外部服务。服务端及外部 MCP 不读取浏览器加密库。使用合成数据验证账号边界、房间移除、真实空状态、版本稳定及房间/消息深链。

## 应用自有 Praxis 集成

本应用在所属仓库维护经审核的 `praxis-integration.mjs`，声明原生入口策略，以及已支持的类型明确的业务操作与 MCP 指引。Praxis 从已安装源码加载声明，继续统一执行授权、签名、策略租约与审计。安装声明不会授予访问权限，也不会启动后端；已有原生界面、数据归属与恢复边界继续生效。
