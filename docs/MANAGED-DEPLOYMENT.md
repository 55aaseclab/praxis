# Managing an existing Praxis installation / 管理既有 Praxis 安装

## English

The checkout supplies the image build and deployment commands. The installation supplies its existing workspace, credentials, app data and Compose definitions. Use Node.js 22.16 or later, Docker Engine and Compose v2 with support for `!override`. Run the commands from the initialized checkout under the account that owns the deployment.

### App services

Put the installation descriptor in `~/.config/praxis/managed-checkout/managed-compose.json`, owned by that account with mode 0600. Set `PRAXIS_MANAGED_COMPOSE_FILE` to select another descriptor. Each entry groups specific services within an existing Compose project. Use the original project name, immutable image IDs and exact named volumes or absolute bind mounts from the installation. The example below assumes an operator already prepared the Compose file and populated its data.

```json
{
  "version": 1,
  "projects": {
    "apps": {
      "name": "sample-installed-apps",
      "files": ["/srv/sample/private/apps.yaml"],
      "services": ["knowledge", "travel"]
    }
  }
}
```

`envFile` optionally selects an absolute environment-file path. `profiles` optionally lists Compose profiles. Keep these private files outside Git. Use a separate service group for a storage worker that shares the apps project name. The checkout is the Compose project directory, including when all Compose files live elsewhere. Use absolute mount sources and explicit installation values when generating the managed files.

```sh
node scripts/managed-compose.mjs check apps
node scripts/managed-compose.mjs status apps
node scripts/managed-compose.mjs up apps knowledge
```

`up` reconciles the specified services using local images. `recreate` replaces their containers and waits for startup. `stop` stops them. Omitting service names selects the descriptor's service list. Use the blue/green controller for its two routing services and four application slots.

### Web and core

Initialize the pinned submodules and build the candidate image. The build compiles Matrix Reader and includes Calendar and both owner-only readers. In an established blue/green deployment, `status` reads the active color, writer and slot health. For a routine image rollout, `deploy` stages the standby pair before transferring the writer lease. `rollback` switches back to the previous slot after a successful rollout.

```sh
docker build --target praxis -t praxis-managed:candidate .
npm run deploy -- status
npm run deploy -- deploy --image praxis-managed:candidate
```

During a checkout or mount migration, checkpoint the private deployment state, prototypes, Compose files, immutable images, writable-layer files and registered data first. Verify an independent restore of the consistent data backup. Stop the blue/green pair through `npm run deploy -- down` to pause routing, drain traffic and release the writer. Quiesce other writers before copying their data. Preserve the installation's workspace and writer-device identities and isolate independently authorized clients.

Install the migrated private prototypes and document mounts. Each prototype's Compose labels must identify the preserved project, its new checkout directory, existing service name, and absolute configuration files. Keep all reader mounts read-only. With routing paused and both slot pairs stopped, run the following commands.

```sh
npm run deploy -- rebind --image praxis-managed:candidate
npm run deploy -- up
npm run deploy -- status
```

Check the effective mounts, public entry and protected reader routes, then verify navigation in both directions with an authorized synthetic account. A successful offline rebind stages both colors from one image and clears the previous-slot pointer. Recovery at that boundary uses the saved prototypes, previous image and consistent private backup. Restore data only with every writer stopped. Supply `--state-dir` for a deployment state directory other than `~/.config/praxis/deployment`.

## 简体中文

源码检出提供镜像构建与部署命令。工作空间、凭据、应用数据及 Compose 配置由既有安装提供。使用 Node.js 22.16 或更高版本、Docker Engine 和支持 `!override` 的 Compose v2。用部署目录所属账号，在已初始化的检出目录运行命令。

### 应用服务

安装描述文件的默认路径为 `~/.config/praxis/managed-checkout/managed-compose.json`，所有者为部署账号，权限为 0600。可用 `PRAXIS_MANAGED_COMPOSE_FILE` 指定其他文件。上方 JSON 示例将两个服务编入 `apps` 组，假设运维人员已准备好示例中的 Compose 文件及数据。保留原项目名、固定镜像 ID、命名卷和绑定挂载的绝对路径。`envFile` 可指定环境文件绝对路径，`profiles` 可列出 Compose 配置组。私有文件存放在 Git 之外。存储服务与应用共用项目名时，分别定义服务组。新检出目录作为 Compose 项目目录，生成私有配置时使用挂载源绝对路径和明确的安装参数。

```sh
node scripts/managed-compose.mjs check apps
node scripts/managed-compose.mjs status apps
node scripts/managed-compose.mjs up apps knowledge
```

`up` 依据配置和本地镜像启动所选服务。`recreate` 替换容器并等待就绪。`stop` 停止服务。省略服务名会选择该组配置中列出的服务。两个蓝绿路由服务及四个应用槽由蓝绿控制器管理。

### Web 与核心服务

初始化固定版本的子模块后，构建候选镜像。构建过程会编译 Matrix 阅读器并打包日历和两个所有者专属阅读器。已有蓝绿安装可用 `status` 查看活动槽、写入者和健康状态。常规镜像升级用 `deploy` 先部署备用槽，再交接写租约。升级成功后可用 `rollback` 切回上一个槽。

```sh
docker build --target praxis -t praxis-managed:candidate .
npm run deploy -- status
npm run deploy -- deploy --image praxis-managed:candidate
```

迁移检出目录或挂载前，先备份私有部署状态、原型、Compose 文件、固定镜像、容器可写层中需保留的文件及已登记数据，并验证一致性数据备份能独立恢复。用 `npm run deploy -- down` 暂停路由、排空请求并释放写租约。复制其他服务的数据前也需暂停对应写入者。保留工作空间和写设备标识，维持独立授权客户端间的隔离。

安装已迁移的私有原型和文档挂载。原型的 Compose 标签应指向原项目名、新检出目录、既有服务名和配置文件绝对路径。阅读器文档挂载使用只读模式。路由暂停且两对槽均已停止后，执行以下命令。

```sh
npm run deploy -- rebind --image praxis-managed:candidate
npm run deploy -- up
npm run deploy -- status
```

核对实际挂载、公开入口和受保护的阅读器路径，用已授权的合成账号验证进入应用和返回工作台。离线重绑定会用同一镜像装配两个槽，并清除上次部署的回滚槽指针。在这个阶段恢复时，使用已保存的原型、旧镜像和一致性私有备份。恢复数据前先停止所有写入者。部署目录位于其他位置时，用 `--state-dir` 指定实际路径。
