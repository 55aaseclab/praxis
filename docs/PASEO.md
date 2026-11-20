# External Paseo client

Use Paseo through its own client interface and pair the host authorized for your role. For business work, use an independent business identity and its scoped MCP connection. Retain normal shell, local-file, browser/network and MCP/OAuth setup tools; client-tool removal is not an authorization requirement. The app checks the user’s permissions, delegation scope and resource access for each operation. The workbench displays the resulting app records through their native interfaces. [Agent authorization](BUSINESS-AUTH.en.md) · [Paseo connection options](https://paseo.sh/docs/connectivity)

Deploy and authorize each Paseo host independently. Keep its daemon state, credentials, session history and projects in that host’s private storage. The Polaris observation viewer reads a private, workspace-scoped observation file. [Polaris viewer](POLARIS-VIEWER.md) · [External-client verification](VERIFICATION.en.md)

## Workbench integration history

The optional Paseo toolbar entry and panel were retired on 2026-11-19. Earlier releases loaded the official client from its own origin in an isolated desktop frame, using temporary browser storage. Closing the panel or signing out removed the frame. A new-tab link provided persistent browser storage and supported narrow screens and browsers without the required frame isolation. The frame denied local-network and loopback access; users paired their authorized remote host through its relay. This record describes the former integration.

# 独立 Paseo 客户端

通过 Paseo 自己的客户端配对与你的角色相符、已获授权的主机。业务使用采用独立业务身份，通过限定范围的 MCP 连接操作。保留正常 shell、本地文件、浏览器/联网及 MCP/OAuth 配置工具，不以禁用客户端工具作为授权要求。应用会在每次操作时检查用户权限、委托范围和资源权限，工作台则通过各应用的原生界面展示结果。[智能体授权](BUSINESS-AUTH.md) · [Paseo 连接说明](https://paseo.sh/docs/connectivity)

各个 Paseo 主机独立部署和授权，其 daemon 状态、凭据、会话历史及项目保存在对应主机的私有存储。Polaris 观察查看器读取限定工作区的私有观察文件。[Polaris 查看器](POLARIS-VIEWER.md) · [外部客户端验收](VERIFICATION.md)

## 工作台集成历史

可选的 Paseo 工具栏入口与面板已于 2026-11-19 移除。早期版本在隔离的桌面框架中从官方来源加载客户端，使用临时浏览器存储。关闭面板或退出工作台时会移除框架。新标签页链接支持持久浏览器存储，也用于窄屏及缺少所需框架隔离能力的浏览器。框架拒绝本地网络及回环访问，用户通过 relay 配对已获授权的远程主机。本段保留当时的集成记录。
