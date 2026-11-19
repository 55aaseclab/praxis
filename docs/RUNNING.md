# Running Praxis / 运行 Praxis

## English

From a clean checkout, use Node.js 22.16 or later and run the following commands.

```sh
git submodule update --init --recursive
npm ci
npm start
```

Open <http://127.0.0.1:4321/>. Calendar opens from the installed static files. To enable Matrix Reader, run `npm ci --prefix third_party/matrix-reader` and `npm run build --prefix third_party/matrix-reader`, then reload the workbench. The Home control in either app returns to Praxis. Calendar's private agenda requires the authorized business service. Service-backed apps appear with their access requirement. The local command starts only the workbench. Use the [built-in app guide](BUILTINS.md) to launch an isolated demo of a service-backed app. Polaris, Letters and Profiles are available through their authorized managed routes.

The local workbench binds to `127.0.0.1:4321`. Open `/about/` for an overview, `/prds/` for requirements, and `/health` for a JSON status. For a local app, run its service and pass a manifest to `npm run apps:dev -- /absolute/path/to/manifest.json`. That command starts a separate loopback workbench on port 4180. [App manifest example](APP-STANDARD.md)

To build the workbench image after initializing the pinned submodules, run `docker build --target praxis -t praxis:local .`. Start it with `docker run --rm -p 127.0.0.1:4321:4321 praxis:local`. The image contains the public reader interfaces. The owner’s documents are supplied to a managed web service as read-only mounts.

For private Compose groups and blue/green slots, follow the [managed deployment guide](MANAGED-DEPLOYMENT.md).

For a managed install, supply a native identity service and the enabled app services, then configure the web gateway with `PRAXIS_WEB_GATEWAY=true`, the HTTPS `PRAXIS_CANONICAL_URL` and local `PRAXIS_WEB_CORE_URL`. Run `npm run gateway` behind your TLS endpoint. The managed gateway generates same-origin links from the signed-in account’s grants. A standalone workbench can use `PRAXIS_PUBLIC_URLS_FILE` to map registered app IDs to HTTPS URLs. The public MCP guide runs at `/mcp/guide`. Business MCP requires a separate authorization for each accessible resource.

Set `PRAXIS_DOCUMENT_OWNER_ID` to the immutable native ID of the owner and set `PRAXIS_LETTERS_DIR` and `PRAXIS_PROFILES_DIR` to separate private directories. Each reader requires the owner’s active administrator session. Keep native-user databases, source documents, account tokens, snapshots and deployment manifests outside the checkout. Validate your installation using synthetic records.

## 简体中文

全新检出后，使用 Node.js 22.16 或更高版本，在仓库根目录依次运行：

```sh
git submodule update --init --recursive
npm ci
npm start
```

打开 <http://127.0.0.1:4321/>。日历使用本地安装的静态文件。要启用 Matrix 阅读器，依次运行 `npm ci --prefix third_party/matrix-reader` 和 `npm run build --prefix third_party/matrix-reader`，然后刷新工作台。两个应用都可通过主页按钮返回 Praxis。日历的私人日程需由已授权的业务服务提供。依赖服务的应用会显示授权要求。本机启动命令仅运行工作台。需要试用依赖服务的应用时，请按[内置应用指南](BUILTINS.md)启动独立演示。Polaris、信件和个人材料通过受管入口验权访问。

本机工作台默认监听 `127.0.0.1:4321`。`/about/zh-cn/` 提供中文介绍，`/prds/` 展示需求，`/health` 返回 JSON 状态。启动自己的应用后，执行 `npm run apps:dev -- /绝对路径/manifest.json`，即可在回环地址的 4180 端口打开独立工作台。[应用清单示例](APP-STANDARD.md)

递归检出固定版本的子模块后，执行 `docker build --target praxis -t praxis:local .` 构建镜像，执行 `docker run --rm -p 127.0.0.1:4321:4321 praxis:local` 运行。镜像携带可公开的阅读器界面，原件在受管运行时只读挂载。

私有 Compose 服务组和蓝绿槽的运维步骤见[受管部署指南](MANAGED-DEPLOYMENT.md)。

受管安装需提供原生身份服务和启用的应用服务。配置 `PRAXIS_WEB_GATEWAY=true`、HTTPS 地址 `PRAXIS_CANONICAL_URL` 和本机核心服务地址 `PRAXIS_WEB_CORE_URL`，在 TLS 入口后启动 `npm run gateway`。受管网关按登录账号的授权生成同源入口。独立工作台可用 `PRAXIS_PUBLIC_URLS_FILE` 将已登记应用映射到 HTTPS 地址。公共 MCP 指南路径为 `/mcp/guide`，业务 MCP 需按资源另行授权。

`PRAXIS_DOCUMENT_OWNER_ID` 使用所有者固定原生账号标识。`PRAXIS_LETTERS_DIR` 和 `PRAXIS_PROFILES_DIR` 指向不同的私有目录，访问需有所有者的有效管理员会话。将账号数据库、文档、令牌、快照和部署配置保存在源码检出目录外，用合成记录验收。
