# Running Praxis / 运行 Praxis

## English

The local workbench binds to `127.0.0.1:4321`. Open `/about/` for an overview, `/prds/` for requirements, and `/health` for a JSON status. For a local app, run its service and pass a manifest to `npm run apps:dev -- /absolute/path/to/manifest.json`. That command starts a separate loopback workbench on port 4180. [App manifest example](APP-STANDARD.md)

To build the workbench image after cloning the two reader submodules, run `docker build --target praxis -t praxis:local .`. Start it with `docker run --rm -p 127.0.0.1:4321:4321 praxis:local`. The image contains the public reader interfaces. The owner’s documents are supplied to a managed web service as read-only mounts.

For a managed install, supply a native identity service and the enabled app services, then configure the web gateway with `PRAXIS_WEB_GATEWAY=true`, the HTTPS `PRAXIS_CANONICAL_URL` and local `PRAXIS_WEB_CORE_URL`. Run `npm run gateway` behind your TLS endpoint. `PRAXIS_PUBLIC_URLS_FILE` can point to a private JSON object mapping registered app IDs to HTTPS URLs. The public MCP guide runs at `/mcp/guide`. Business MCP requires a separate authorization for each accessible resource.

Set `PRAXIS_DOCUMENT_OWNER_ID` to the immutable native ID of the owner and set `PRAXIS_LETTERS_DIR` and `PRAXIS_PROFILES_DIR` to separate private directories. Each reader requires the owner’s active administrator session. Keep native-user databases, source documents, account tokens, snapshots and deployment manifests outside the checkout. Validate your installation using synthetic records.

## 简体中文

本机工作台默认监听 `127.0.0.1:4321`。`/about/zh-cn/` 提供中文介绍，`/prds/` 展示需求，`/health` 返回 JSON 状态。启动自己的应用后，执行 `npm run apps:dev -- /绝对路径/manifest.json`，即可在回环地址的 4180 端口打开独立工作台。[应用清单示例](APP-STANDARD.md)

递归检出两个阅读器子模块后，执行 `docker build --target praxis -t praxis:local .` 构建镜像，执行 `docker run --rm -p 127.0.0.1:4321:4321 praxis:local` 运行。镜像携带可公开的阅读器界面，原件在受管运行时只读挂载。

受管安装需提供原生身份服务和启用的应用服务。配置 `PRAXIS_WEB_GATEWAY=true`、HTTPS 地址 `PRAXIS_CANONICAL_URL` 和本机核心服务地址 `PRAXIS_WEB_CORE_URL`，在 TLS 入口后启动 `npm run gateway`。可用 `PRAXIS_PUBLIC_URLS_FILE` 提供应用标识到 HTTPS 地址的私有映射。公共 MCP 指南路径为 `/mcp/guide`，业务 MCP 需按资源另行授权。

`PRAXIS_DOCUMENT_OWNER_ID` 使用所有者固定原生账号标识。`PRAXIS_LETTERS_DIR` 和 `PRAXIS_PROFILES_DIR` 指向不同的私有目录，访问需有所有者的有效管理员会话。将账号数据库、文档、令牌、快照和部署配置保存在源码检出目录外，用合成记录验收。
