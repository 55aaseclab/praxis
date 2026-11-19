# Running Praxis / 运行 Praxis

## English

### Docker Compose

Install Git, Docker Engine and Compose v2. From the root of a recursive checkout, run:

```sh
git submodule update --init --recursive
docker compose up --build -d --wait
```

The default Compose file starts the complete built-in distribution. Reminder, Knowledge, Lattice Slides, Travel, TingProof, Memo, Finance, Intelligence, Projects and Polaris have their native services. Calendar, Matrix Reader, Letters and Profiles are served by the workbench image. Identity and business services enforce browser and agent authorization.

The initializer creates the installation's owner account, workspace, signing keys and empty app stores once. Retrieve the initial login information privately:

```sh
docker compose exec business node scripts/builtin-install.mjs credentials
```

Open <http://127.0.0.1:4321/> and sign in. Use an authorized agent to create the first project, then open its native reader at `/apps/projects/`. Project records appear in the workbench's project directory. Letters and Profiles open their own separate document collections for the configured owner. The language preference lives under Settings.

All application stores and private configuration are in named Docker volumes. `docker compose down` stops the services and retains those volumes. On restart the initializer preserves existing accounts, grants, keys, workspace IDs and records. A missing volume or inconsistent workspace binding fails startup so it can be recovered from its original backup. Keep the generated login details and backup keys outside Git.

The public entry binds to `127.0.0.1:4321`; native app and business ports share the internal service network and are reached through the authenticated gateway. Set `PRAXIS_PORT` before the first start to choose another local port. Persist installation settings in a private `.env` file. An existing installation's origin and workspace must be migrated explicitly.

Connect a client to `http://127.0.0.1:4321/mcp`, sign in and consent to scoped access. The public instructions remain available at `/mcp/guide` on the same entry. Use `docker compose logs -f` to inspect service logs and `docker compose ps` for service status.

Existing managed installations retain their private source bindings, Compose projects and blue/green controls. Follow the [managed deployment guide](MANAGED-DEPLOYMENT.md) for that workflow and the [migration comparison](MIGRATION.en.md) for the restored original operations.

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

默认 Compose 启动完整的内置发行版。Reminder、Knowledge、Lattice Slides、Travel、TingProof、Memo、Finance、Intelligence、Projects 和 Polaris 均启动自己的原生服务；日历、Matrix 阅读器、信件和个人材料由工作台镜像提供。身份与业务服务负责浏览器及智能体的授权。

初始化服务仅首次生成所有者账号、工作区、签名密钥和空应用存储。私下读取初始登录信息：

```sh
docker compose exec business node scripts/builtin-install.mjs credentials
```

打开 <http://127.0.0.1:4321/> 并登录。通过已授权的智能体创建第一个项目后，可在 `/apps/projects/` 打开原生项目阅读器，项目也会出现在工作台的项目目录。信件和个人材料分别向配置的所有者展示对应文档目录。语言偏好位于「设置」中。

应用数据与私有配置都保存在 Docker 命名卷。`docker compose down` 停止服务并保留这些卷。重启时初始化服务保留账号、权限、密钥、工作区标识与业务记录。缺失数据卷或工作区绑定冲突时停止启动，以便从原始备份恢复。生成的登录信息和备份密钥保存在 Git 之外。

公开入口默认监听 `127.0.0.1:4321`；各原生应用及业务端口共享内部服务网络，通过已验权的网关访问。首次启动前设置 `PRAXIS_PORT` 可更换本机端口，安装设置保存在私有 `.env` 文件。既有安装的源站地址与工作区需要显式迁移。

将客户端连接到 `http://127.0.0.1:4321/mcp`，登录并确认限定范围的授权。同一入口的 `/mcp/guide` 提供公共说明。用 `docker compose logs -f` 查看日志，`docker compose ps` 查看服务状态。

既有受管安装保留私有来源绑定、Compose 项目及蓝绿控制，具体操作见[受管部署指南](MANAGED-DEPLOYMENT.md)，恢复的原有运维能力见[迁移对照](MIGRATION.md)。

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
