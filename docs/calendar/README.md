# Calendar / 日历

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).
> 已于 2026-11-25 从 Praxis 发行版退役；文档存档说明见 [RETIRED.md](RETIRED.md)。

Run `python3 -m http.server 8080 --bind 127.0.0.1 --directory public` and open http://localhost:8080. Choose a date, enter a title and times, and download an .ics invitation to keep it in your calendar. The managed workbench also shows authorized Reminder dates.

运行上述命令后打开本机地址。选择日期，填写标题和起止时间，下载 .ics 邀请后导入自己的日历。工作台版本还显示已获授权的 Reminder 日期。

## Workbench cards and checks / 工作台卡片与验证

`praxis-provider.mjs` supplies read-only day cards and data locations. Browser events created by downloading .ics use the signed-in native Praxis identity. A different native account sees its own browser events. Standalone events use a separate local namespace. Run `npm test` with Node 22.12+ for synthetic provider and isolation checks.

`praxis-provider.mjs` 提供只读日期卡片及数据位置。下载 .ics 时创建的浏览器日程按已登录的原生 Praxis 身份隔离；另一原生账号只显示自己的浏览器日程，独立模式另用本机命名空间。使用 Node 22.12+ 运行 `npm test` 验证合成供数及身份隔离。

## Praxis registration

App release: `0.1.1`. The app owns [`praxis-app.json`](praxis-app.json), its English and Simplified Chinese presentation, the icon at `public/praxis-icon.svg`, the declared PRD locations and any legacy icon aliases. `schemaVersion: 1` identifies the registration format; it is separate from this app release and from data, protocol and document revisions. Package and lockfile release metadata, where present, agree with the declaration.

[`apps.example.json`](apps.example.json) registers a local alias by referencing `./praxis-app.json` and `http://127.0.0.1:8080/`. Start the standalone service described above before using the example; registration does not start a backend or grant account, administrator or business-data access. Installation origins, data locations and access policy remain separately configured.

## Praxis 登记

应用发行版本：`0.1.1`。本应用维护 [`praxis-app.json`](praxis-app.json)、英中展示文案、`public/praxis-icon.svg` 图标、PRD 路径及需要保留的旧图标别名。`schemaVersion: 1` 表示登记格式，与应用发行版本、数据、协议和文档修订分别管理；已有 package 和 lockfile 的发行版本须与声明一致。

[`apps.example.json`](apps.example.json) 引用 `./praxis-app.json`，使用 `http://127.0.0.1:8080/` 登记本地别名。先按上文启动独立服务；登记不启动后端，也不授予账号、管理员或业务数据权限。安装地址、数据位置与授权策略仍独立配置。
