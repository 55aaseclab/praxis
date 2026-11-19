# Running Praxis / 运行 Praxis

## English

### Docker Compose

Install Git, Docker Engine and Compose v2. From the root of a recursive checkout, run:

```sh
git submodule update --init --recursive
docker compose up --build -d --wait
```

Open <http://127.0.0.1:4321/>. The image includes Calendar and a production build of Matrix Reader. Both provide the Home control. Calendar's private agenda requires the authorized business service. The default service starts the local workbench. Service-backed apps use their installation's identity and app services. Polaris, Letters and Profiles are available through their authorized managed routes.

`docker compose logs -f praxis` shows the workbench logs. `docker compose down` stops it. To select a free loopback port, set `PRAXIS_PORT`, for example `PRAXIS_PORT=24321 docker compose up --build -d --wait`.

Start the optional public guide with `docker compose --profile guide up -d --wait`. Its two public tools are available at `http://127.0.0.1:4181/mcp/guide`. `PRAXIS_GUIDE_PORT` selects a different loopback port. Stop both services with `docker compose --profile guide down`. For authorized business tools, use the configured installation's HTTPS `/mcp` endpoint and sign in through the client.

### Native development

Use Node.js 22.16 or later for platform development:

```sh
npm ci
npm start
```

For Matrix Reader in native mode, run `npm ci --prefix third_party/matrix-reader` and `npm run build --prefix third_party/matrix-reader`. Use the [built-in app guide](BUILTINS.md) to launch an isolated service-backed demo.

The local workbench binds to `127.0.0.1:4321`. Open `/about/` for an overview, `/prds/` for requirements, and `/health` for a JSON status. For a local app, run its service and pass a manifest to `npm run apps:dev -- /absolute/path/to/manifest.json`. That command starts a separate loopback workbench on port 4180. [App manifest example](APP-STANDARD.md)

To build the workbench image after initializing the pinned submodules, run `docker build --target praxis -t praxis:local .`. Start it with `docker run --rm -p 127.0.0.1:4321:4321 praxis:local`. The image contains the public reader interfaces. The owner’s documents are supplied to a managed web service as read-only mounts.

For private Compose groups and blue/green slots, follow the [managed deployment guide](MANAGED-DEPLOYMENT.md).

For a managed install, supply a native identity service and the enabled app services, then configure the web gateway with `PRAXIS_WEB_GATEWAY=true`, the HTTPS `PRAXIS_CANONICAL_URL` and local `PRAXIS_WEB_CORE_URL`. Run `npm run gateway` behind your TLS endpoint. The managed gateway generates same-origin links from the signed-in account’s grants. A standalone workbench can use `PRAXIS_PUBLIC_URLS_FILE` to map registered app IDs to HTTPS URLs. The public MCP guide runs at `/mcp/guide`. Business MCP requires a separate authorization for each accessible resource.

Set `PRAXIS_DOCUMENT_OWNER_ID` to the immutable native ID of the owner and set `PRAXIS_LETTERS_DIR` and `PRAXIS_PROFILES_DIR` to separate private directories. Each reader requires the owner’s active administrator session. Keep native-user databases, source documents, account tokens, snapshots and deployment manifests outside the checkout. Validate your installation using synthetic records.

## 简体中文

### Docker Compose

安装 Git、Docker Engine 和 Compose v2，在递归检出的仓库根目录运行：

```sh
git submodule update --init --recursive
docker compose up --build -d --wait
```

打开 <http://127.0.0.1:4321/>。镜像包含日历与 Matrix 阅读器的生产构建，均可通过主页按钮返回工作台。日历的私人日程需要已授权的业务服务。默认服务启动本机工作台，依赖后端的应用使用各安装环境配置的身份和应用服务。Polaris、信件和个人材料通过受管入口验权访问。

使用 `docker compose logs -f praxis` 查看日志，`docker compose down` 停止服务。可设置 `PRAXIS_PORT` 选择空闲的回环端口，例如 `PRAXIS_PORT=24321 docker compose up --build -d --wait`。

运行 `docker compose --profile guide up -d --wait` 启动可选的公共指南，在 `http://127.0.0.1:4181/mcp/guide` 发现两项公共工具。需要更换回环端口时设置 `PRAXIS_GUIDE_PORT`。运行 `docker compose --profile guide down` 停止两个服务。已授权的业务工具使用配置好的安装环境中的 HTTPS `/mcp` 入口，并由客户端引导登录。

### 原生开发

平台开发使用 Node.js 22.16 或更高版本：

```sh
npm ci
npm start
```

原生模式下的 Matrix 阅读器需要运行 `npm ci --prefix third_party/matrix-reader` 和 `npm run build --prefix third_party/matrix-reader`。需要隔离试用依赖服务的应用时，请按[内置应用指南](BUILTINS.md)启动。

本机工作台默认监听 `127.0.0.1:4321`。`/about/zh-cn/` 提供中文介绍，`/prds/` 展示需求，`/health` 返回 JSON 状态。启动自己的应用后，执行 `npm run apps:dev -- /绝对路径/manifest.json`，即可在回环地址的 4180 端口打开独立工作台。[应用清单示例](APP-STANDARD.md)

递归检出固定版本的子模块后，执行 `docker build --target praxis -t praxis:local .` 构建镜像，执行 `docker run --rm -p 127.0.0.1:4321:4321 praxis:local` 运行。镜像携带可公开的阅读器界面，原件在受管运行时只读挂载。

私有 Compose 服务组和蓝绿槽的运维步骤见[受管部署指南](MANAGED-DEPLOYMENT.md)。

受管安装需提供原生身份服务和启用的应用服务。配置 `PRAXIS_WEB_GATEWAY=true`、HTTPS 地址 `PRAXIS_CANONICAL_URL` 和本机核心服务地址 `PRAXIS_WEB_CORE_URL`，在 TLS 入口后启动 `npm run gateway`。受管网关按登录账号的授权生成同源入口。独立工作台可用 `PRAXIS_PUBLIC_URLS_FILE` 将已登记应用映射到 HTTPS 地址。公共 MCP 指南路径为 `/mcp/guide`，业务 MCP 需按资源另行授权。

`PRAXIS_DOCUMENT_OWNER_ID` 使用所有者固定原生账号标识。`PRAXIS_LETTERS_DIR` 和 `PRAXIS_PROFILES_DIR` 指向不同的私有目录，访问需有所有者的有效管理员会话。将账号数据库、文档、令牌、快照和部署配置保存在源码检出目录外，用合成记录验收。
