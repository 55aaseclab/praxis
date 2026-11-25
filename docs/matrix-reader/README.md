# Matrix Reader

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).
> 已于 2026-11-25 从 Praxis 发行版退役；文档存档说明见 [RETIRED.md](RETIRED.md)。

[简体中文](#matrix-reader-中文说明)

Read selected Matrix rooms together in a browser. Matrix Reader uses the Matrix JavaScript SDK and sends authentication, message and encryption requests directly to the homeserver.

## Run locally

Install Node.js 22.12 or later, then run:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:18785/> on the same machine, or use SSH port forwarding for remote development. Run `npm run build` to generate static assets and `npm run preview` to serve them locally on port 18786. Serve production builds over HTTPS.

The app starts in English and follows the workbench language preference, which the workbench and the managed reader share; the app renders no separate language toggle. Sign in, verify the new device with a trusted Element session or recovery key, and select rooms. Server policy determines the available login methods.

## Reading and storage

- Browse rooms, mentions and bookmarks in the sidebar. Search loaded messages or fetch older room history.
- Open a room label, reply reference or original message to check the discussion in context. The browser stores room selection, bookmarks, pinned rooms and reading position.
- Choose **Share with agent** to preview up to 20 readable messages before copying text and citations to an external agent.
- The browser stores device encryption state in IndexedDB. Access to historical encrypted messages depends on the keys available to the device. Sign out or revoke the session from a trusted Matrix client to stop access.

## Workbench cards

When opened through Praxis, the verified reader keeps a small owner-bound snapshot of readable messages from selected rooms for private workbench cards. The snapshot contains message excerpts, not credentials or encryption keys. It expires fifteen minutes after the last reader refresh. Opening a card returns to the exact native room and event. Sign-out, deselected rooms and a changed Praxis account clear or invalidate the projection. Open Matrix Reader again in this browser to refresh it. Browser projection and crypto storage are not server-side backups.

## Verification

Run `npm test` for type checking and `npm run build` for a production build. The browser integration test at `test/live-onboarding.mjs` requires Chromium, Playwright and an isolated Synapse running locally with server name `reader.test`. Use a fresh synthetic `reader-test-*` account and set `MATRIX_READER_SYNTHETIC_USER`, `MATRIX_READER_SYNTHETIC_PASSWORD` and `MATRIX_READER_SYNTHETIC_SERVER` before running `npm run test:live`.

Version 0.1.3 adds five synthetic projection tests and passed an isolated Synapse/Chromium check for genuine encrypted-room cards, exact room/event links, omitted-room exclusion, Matrix room leave and native Praxis account-change invalidation. This check used fresh synthetic Matrix and Praxis accounts; no existing sessions or keys were reused.

Version 0.1.0 was tested with isolated Synapse and Chromium for sign-in, recovery-key rejection and verification, encrypted history, room filtering, search, bookmarks, mobile navigation, session restoration and revocation. Separate checks covered emoji comparison and device-code authorization. People authorize their real Matrix accounts when first opening the app.

## License

Matrix Reader’s original code is licensed under [Apache-2.0](LICENSE). Dependencies including the Matrix SDK retain their own license terms.

# Matrix Reader 中文说明

一个独立的只读 Matrix 网页客户端。用个人账号把选定房间放在一起浏览。它使用浏览器的 Matrix SDK，消息和加密请求直接发往 Matrix 服务器。

## 本地启动

需要 Node.js 22.12+。

```sh
npm ci
npm run dev
```

在运行主机上打开 <http://127.0.0.1:18785/>。远程访问可以通过 SSH 将该端口转发到本机。正式静态服务使用 HTTPS，避免与其它应用共用浏览器来源。发布产物可用 `npm run build` 生成，`npm run preview` 在本机的 18786 端口预览。

默认英语，界面语言跟随工作台的语言偏好设置，应用内不再提供独立切换按钮。首次打开后，依次连接账号、验证新设备、勾选房间。支持设备码的服务器会打开账号授权页。支持 Matrix 密码登录的旧服务器也可直接登录。设备验证可在现有可信 Element 会话中核对表情，或者使用已经创建的 Matrix 恢复密钥。账号服务器如果限制第三方客户端，或者只支持另一种登录流程，需要管理员放行相应方式。

## 浏览与数据

- 左栏打开房间、提到我和收藏。搜索覆盖当前浏览器已读取的消息，房间内可继续加载更早的内容。
- 点击房间标签、回复引用、原消息链接可查看上下文。房间选择、置顶、收藏和阅读位置保存在当前浏览器。
- 「交给 Agent」先显示当前视图中最多 20 条可读消息，再由你复制正文和来源给外部 Agent。首次版本由你选择外部工具。
- 加密设备身份由浏览器的 IndexedDB 保存。旧消息能否解密取决于设备可取得的历史密钥。在当前设备退出或到原 Element 撤销会话可以停止访问。

## 工作台卡片

从 Praxis 打开时，已验证的阅读器将选定房间中可读消息的小规模快照提供给私人工作台卡片。快照包含消息摘录，不含凭据或加密密钥，最后一次阅读器刷新十五分钟后过期。打开卡片回到原生房间与对应消息；退出、取消选择房间或 Praxis 账号变化时清理或使投影失效。需要刷新时，在同一浏览器重新打开 Matrix Reader。浏览器投影及加密存储不等于服务端备份。

## 验证

`npm test` 执行类型检查，`npm run build` 检查产物。浏览器协议测试见 `test/live-onboarding.mjs`，需要 Chromium、Playwright 和一个独立的、只用于测试的本机 Synapse。使用 server_name `reader.test` 和新建的 `reader-test-*` 合成账户，设置 `MATRIX_READER_SYNTHETIC_USER`、`MATRIX_READER_SYNTHETIC_PASSWORD`、`MATRIX_READER_SYNTHETIC_SERVER` 后运行 `npm run test:live`。

0.1.3 增加五项合成投影测试，并在隔离 Synapse/Chromium 中通过真实加密房间卡片、精确房间与消息链接、未选房间排除、Matrix 退群及原生 Praxis 账号变化失效。该检查使用新建的合成 Matrix 与 Praxis 账号，没有复用既有会话或密钥。

0.1.0 在隔离 Synapse 和 Chromium 通过首次登录、错误恢复密钥拒绝、恢复密钥验证、加密历史、选定房间、搜索收藏、移动侧栏、同设备刷新和服务器撤销。另测了两台合成设备的表情核对及设备码协议。本人账号登录由本人在首次打开时完成。

## 许可证

Matrix Reader 原创代码采用 [Apache-2.0](LICENSE)。Matrix SDK 等依赖保留各自的许可证条款。

## Praxis registration

App release: `0.1.3`. The app owns [`praxis-app.json`](praxis-app.json), its English and Simplified Chinese presentation, the icon at `public/praxis-icon.svg`, the declared PRD locations and any legacy icon aliases. `schemaVersion: 1` identifies the registration format; it is separate from this app release and from data, protocol and document revisions. Package and lockfile release metadata, where present, agree with the declaration.

[`apps.example.json`](apps.example.json) registers a local alias by referencing `./praxis-app.json` and `http://127.0.0.1:18786/`. Start the standalone service described above before using the example; registration does not start a backend or grant account, administrator or business-data access. Installation origins, data locations and access policy remain separately configured.

## Praxis 登记

应用发行版本：`0.1.3`。本应用维护 [`praxis-app.json`](praxis-app.json)、英中展示文案、`public/praxis-icon.svg` 图标、PRD 路径及需要保留的旧图标别名。`schemaVersion: 1` 表示登记格式，与应用发行版本、数据、协议和文档修订分别管理；已有 package 和 lockfile 的发行版本须与声明一致。

[`apps.example.json`](apps.example.json) 引用 `./praxis-app.json`，使用 `http://127.0.0.1:18786/` 登记本地别名。先按上文启动独立服务；登记不启动后端，也不授予账号、管理员或业务数据权限。安装地址、数据位置与授权策略仍独立配置。
