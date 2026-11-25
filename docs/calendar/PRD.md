# Calendar / 日历

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

Version: 0.2.0

Browse a month, select a day and see the agenda. In the workbench, include dated reminders the signed-in user may read, and link back to the exact source. Standalone users can plan a single event and download a standard calendar invitation for their own calendar. Use local civil dates. The interface language follows the workbench language preference; standalone use defaults to English and the app renders no separate language toggle. The app relies on the managed platform for its Home control.

## Workbench projections and browser events

The read-only provider groups authorized Reminder dates and browser-created events into one native Calendar day card. A date link selects the exact civil day. Downloading an invitation also retains that real event under the current native Praxis user in this browser. Another native account cannot reuse the record projection. Derived Reminder dates and external .ics downloads retain their original ownership; there is no server-side calendar store or remote write capability.

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

# 日历

版本：0.2.0

按月浏览，选择日期查看当天议程。工作台模式显示本人获准读取的有日期提醒，可打开具体来源事项。独立使用时可填写单个日程，下载标准日历邀请并导入个人日历。日期采用本地日历日期。界面语言跟随工作台的语言偏好设置，独立运行时默认英文，应用内不再提供独立切换按钮。受管模式由平台提供返回工作台按钮。

## 工作台投影与浏览器日程

只读供数模块将获授权的 Reminder 日期和本浏览器创建的真实日程按天合并成日历卡片，日期链接选中对应的本地日历日。下载邀请时，真实日程同时保存在当前原生 Praxis 用户的浏览器空间，其他原生账号不能复用其记录投影。Reminder 派生日期及外部 .ics 文件保持原有归属，不提供服务端日程库或远程写入能力。

## 应用自有 Praxis 集成

本应用在所属仓库维护经审核的 `praxis-integration.mjs`，声明原生入口策略，以及已支持的类型明确的业务操作与 MCP 指引。Praxis 从已安装源码加载声明，继续统一执行授权、签名、策略租约与审计。安装声明不会授予访问权限，也不会启动后端；已有原生界面、数据归属与恢复边界继续生效。

## Device database / 设备数据库

Store owner-bound events in IndexedDB, preserving exact IDs/times and migrating existing localStorage data on the same device. Keep the legacy bytes and import receipts; never move encryption keys or browser events to the server. Native and workbench card reads use the same database. Saving waits for transaction completion before downloading an invitation.

按身份将日程保存到 IndexedDB，在原设备导入已有 localStorage 数据，保留原 ID/时间、旧字节和导入回执；不将浏览器日程或加密密钥移到服务器。原生界面和工作台卡片读取同一数据库，事务提交后才下载邀请。
