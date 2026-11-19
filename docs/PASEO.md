# Paseo on the workbench

Signed-in users can open **Paseo** from the workbench toolbar. The desktop
panel loads the official client on its own origin. Paste a pairing offer from
your authorized host in Paseo to connect. For business work, pair the isolated
business host assigned to you. The platform supplies no host keys, passwords,
session history or daemon proxy to the panel.

The embedded client uses temporary browser storage for this workbench
document. Closing it removes the frame. Signing out removes the panel.
To use a persistent Paseo browser session, select **Open in new tab**. Narrow
screens and browsers without the necessary frame isolation open the web
client in a new tab. The panel denies access to the browser's local network
and loopback addresses. Pair a remote host through its existing relay.

The workbench module ships with the Praxis web slot. Deploy and authorize the
Paseo host separately. Keep its daemon state and projects in that host’s
private storage. The Polaris observation viewer reads a private observation
file. [Paseo connection options](https://paseo.sh/docs/connectivity) · [Polaris viewer](POLARIS-VIEWER.md)

# 工作台中的 Paseo

登录后可从工作台工具栏打开 **Paseo**。桌面侧栏从 Paseo 官方来源加载客户端。
在 Paseo 中粘贴获准主机的配对链接即可连接。处理业务时请使用分配给你的
隔离业务主机。工作台向侧栏提供网页入口；主机密钥、密码、会话历史和 daemon
连接由 Paseo 管理。

嵌入页使用当前工作台页面的临时浏览器存储。关闭侧栏会移除嵌入页，退出工作台
会移除侧栏。需要持久会话时点击「在新标签页打开」。窄屏或缺少嵌入隔离能力的
浏览器直接以新标签页打开网页客户端。侧栏禁止访问浏览器所在的本地网络和回环
地址，远程主机可使用已有的 relay 配对。

此入口随 Praxis 网页槽发布。Paseo 主机独立部署与授权，daemon 状态及项目保存在该主机的私有存储。Polaris 观察查看器读取独立的私有观察文件。[Paseo 连接说明](https://paseo.sh/docs/connectivity) · [Polaris 查看器](POLARIS-VIEWER.md)
