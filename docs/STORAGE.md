# Praxis 全局存储与恢复

[English](STORAGE.en.md) · 简体中文

F25 的目标是让本地数据能够恢复、换机和换存储。应用仍读写自己的本地真源，存储协调器负责一致性导出、加密仓库及独立副本；WebDAV用于加密副本，不作为应用工作目录，不做文件级双向覆盖。NAS默认用作副本；若选择为可配置的工作目录，必须另行验证应用的文件锁与持久化语义，单writer本身不保证任意网络文件系统适用。

## 数据身份和目录

私有配置默认在 `~/.config/praxis/storage.json`，也可通过 `PRAXIS_STORAGE_CONFIG` 或 CLI 的 `--config` 指定。配置、密钥、快照、仓库和运行状态必须在 Git 工作区之外；私有文件权限为 `600`。

```text
~/.config/praxis/
  storage.json
  secrets/
    local-repository-password
    jianguoyun.json
    jianguoyun-repository-password
<dataRoot>/
  workspaces/<workspaceId>/
    apps/<appId>/                 # 迁移完成后的本地活动数据
    .praxis-storage/              # 协调锁、状态、缓存和短期导出
  repositories/<workspaceId>/local/  # 本地加密仓库
云/NAS：praxis/<workspaceId>/       # 另一个独立加密仓库
```

`workspaceId` 是稳定 UUID，换机器或供应商时不变；`deviceId` 标识机器，`activeWriterDeviceId` 标识唯一允许发布新快照的机器。主仓库 `primaryRepositoryId` 必须为本地仓库，`preferredRepositoryId` 只决定默认校验/恢复来源。云端切换不会改变应用的文件路径或业务记录。

已有应用可先通过 `appSources` 登记当前真实路径，不要求为了备份立即移动在线服务的数据。将来迁移到统一目录，需要停止全部 writer、一致性导出、校验及显式切换；不能留下两份同时可写的事实源。

## 快照范围

| 应用 | 已纳入的服务器数据 | 单独迁移的部分 |
|---|---|---|
| Reminder | schema v2 JSON、完整条目 | `.lock`、`.tmp` 不属于数据；CLI 与服务器继续共用同一真源 |
| TingProof | SQLite 一致性备份，含 WAL 中已提交内容 | 原始音频正文不在服务器数据库中；浏览器文件句柄需重新关联，可显式登记媒体目录 |
| Slides | decks、资产、`.lattice` 业务状态 | 不能把整个 `.lattice` 当缓存；依赖和明确可重建的产物才可排除 |
| Slides受控制作 | 额外登记Git外`apps/slides-business/`目录，包含原子JSON文稿／版本／作业和内容寻址素材／产物 | 原生文稿不迁移或复制成第二事实源；新状态无活动SQLite，目录稳定性检查后纳入一致性快照 |
| Travel / Knowledge | 应用根下独立内容目录、照片、结构化数据；Knowledge版本数据库与Travel受控行程另按各自格式登记 | 签名／高德／飞猪秘密不作为业务数据，锁和临时文件不入快照 |
| Memo | `memo.db`指南、记录、照片与历史 | 旧设备尚未导入的记录、浏览器偏好／流程仍需设备打开导入或完整JSON导出 |

JSON 复制后校验，SQLite 使用 Online Backup API；目录在复制前后检查稳定性，变化时拒绝提交并保留旧备份。源码使用 Git bundle 保留本地未推送提交，并保存允许范围内的工作差异和未跟踪文件。清单记录源码版本、实际包含项及遗漏项，不把“服务器备份成功”等同于“所有浏览器和音频都已迁移”。

每份快照含 `manifest.json`、`apps/` 和 `source/`；清单记录 workspace、writer、快照及父快照 ID、文件大小和 SHA-256。`restic backup .` 从导出目录运行，恢复时直接得到这些相对路径，不携带旧机器的绝对目录。加密仓库备份成功后清理临时明文导出；失败导出留在私有 staging 中，旧备份不变。

## 初始化与命令

需要 Node 22.16 或更高版本、`restic` 与 `rclone`（SQLite Online Backup 使用 Node 内置接口）。当前已验证工具版本为 restic `0.19.1`、rclone `1.76.0`；可在私有配置中指定 `resticBinary`、`rcloneBinary` 的绝对路径。安装包应来自官方发布并核对 `SHA256SUMS`，工具不从仓库测试自动下载。没有 restic 时纯单元测试仍运行，真实仓库集成测试会明确标记跳过。

容器可通过 `PRAXIS_RESTIC_BINARY`、`PRAXIS_RCLONE_BINARY` 覆盖工具路径，覆盖只作用于当前进程，不写回主机配置。

```bash
node scripts/storage.mjs init
node scripts/storage.mjs status
node scripts/storage.mjs snapshot
node scripts/storage.mjs sync
node scripts/storage.mjs check --repository local
node scripts/storage.mjs restore --repository local --target /path/to/new-empty-staging
node scripts/storage.mjs watch
```

`init` 生成独立随机本地仓库密码并初始化加密仓库，不扫描或搬动业务数据。必须先登记非空 `appSources` 再执行快照，空配置不会产生虚假“完整备份”。配置格式：

```json
{
  "schemaVersion": 1,
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "deviceId": "22222222-2222-4222-8222-222222222222",
  "activeWriterDeviceId": "22222222-2222-4222-8222-222222222222",
  "dataRoot": "/absolute/private/praxis",
  "primaryRepositoryId": "local",
  "preferredRepositoryId": "local",
  "intervalSeconds": 3600,
  "repositories": [
    {
      "id": "local",
      "type": "local",
      "path": "/absolute/private/repositories/local",
      "passwordFile": "/absolute/private/secrets/local-password"
    }
  ],
  "appSources": [
    {
      "id": "reminder",
      "kind": "json",
      "source": "/absolute/private/reminder/checklist.json",
      "target": "checklist.json",
      "schema": "reminder-v2"
    },
    {
      "id": "tingproof",
      "kind": "sqlite",
      "source": "/absolute/private/tingproof/tingproof.db",
      "target": "tingproof.db"
    }
  ],
  "sourceRepos": [
    { "id": "praxis", "path": "/absolute/path/to/praxis", "paths": ["src", "scripts", "docs"] }
  ],
  "coverage": { "omitted": ["尚未导出的浏览器记录和未登记的音频"] }
}
```

`kind` 支持 `json/sqlite/directory`。同一应用可用不同 `target` 登记多个互不覆盖的来源。`watch` 默认每小时先完成本地快照，再同步各目标；单个副本失败独立记录，不阻塞其他目标，更不阻塞应用使用。

内容、应用 schema、源码版本及覆盖范围都未变化时，协调器校验后复用已知快照并记录 `lastVerifiedAt`，不因每小时生成新 UUID 而不断增加相同备份。真实数据或 writer 改变仍会形成新的历史版本。

`status` 读取持久状态，不访问云端。每个目标分别显示 `unconfigured/pending/success/failed`、最后成功快照、待复制快照及错误代码；成功指最近一次明确操作的结果，不承诺云盘永久在线。`sync` 出现失败或未配置目标时退出码为 `2`，错误操作为 `1`。日志和 CLI 不输出原始子进程错误、命令参数、密码或云响应正文。

## 增加坚果云、NAS 或其他目标

每个目标拥有独立加密仓库和独立密码。先在 Git 外准备权限为 `600` 的密码文件和目标描述，再登记：

```bash
node scripts/storage.mjs add-target --file /absolute/private/target.json
node scripts/storage.mjs sync --to cloud
node scripts/storage.mjs check --repository cloud
node scripts/storage.mjs restore --repository cloud --target /path/to/cloud-trial-restore
```

坚果云描述：

```json
{
  "id": "cloud",
  "type": "jianguoyun",
  "remotePath": "praxis/11111111-1111-4111-8111-111111111111",
  "passwordFile": "/absolute/private/secrets/cloud-repository-password",
  "credentialsFile": "/absolute/private/secrets/jianguoyun.json"
}
```

`jianguoyun.json` 的字段为 `username` 和 `applicationPassword`，填写第三方应用授权密码，不能使用登录密码；空值显示未配置，不发起云请求。不要把凭据粘贴到聊天、放入 Git 或写在命令行参数中。协调器通过 stdin 将应用密码传给 `rclone obscure`，仅通过子进程环境传递临时 remote 配置；rclone 的 obscure 只是配置遮挡，数据加密由 restic 提供。

首次初始化仅允许配置中的 `praxis/<workspaceId>` 命名空间，按层执行 WebDAV MKCOL，接受201或已存在的405，拒绝其他响应与重定向。明确的 `AncestorsNotFound` 归为尚未初始化，普通409继续失败；不会扫描账户目录、把任意冲突当作空仓，或修改其他工作区。原生请求同样限速、支持取消且不记录秘密或云响应正文。

设计本适配器时，坚果云默认单文件上限 500M，免费每半小时 600 请求、付费 1500 请求，单次目录列举上限 750 项。部署前按供应商最新限额重新核对。这里使用单并发、每个 rclone 进程每秒 `0.1` 次请求及目标 `8 MiB` pack；云到云复制可能同时有两个传输进程，合计仍预留请求余量。协调器串行执行自己的任务，其他客户端和协调器进程共享的账号配额仍需单独管理；这不是跨进程账号级限流器。pack 参数是目标大小，不是文件总配额保证。操作前后检查递归列举，任何目录达到 `749` 项就失败关闭，为响应中可能包含目录自身预留一项。超时或暂时错误最多重试三次，认证、密码及目录上限错误不盲目重试。真实账号和大目录列举/恢复测试完成前，不宣称坚果云已验收通过。[官方限制](https://help.jianguoyun.com/?p=2064)

NAS 文件系统目标使用 `type: "local"`、独立挂载目录 `path` 和独立 `passwordFile`。SFTP、其他 WebDAV 等可配置 rclone remote 后使用：

```json
{
  "id": "other-cloud",
  "type": "rclone",
  "remote": "configured_remote_name",
  "remotePath": "praxis/11111111-1111-4111-8111-111111111111",
  "rcloneConfigFile": "/absolute/private/secrets/rclone.conf",
  "passwordFile": "/absolute/private/secrets/other-repository-password"
}
```

rclone 配置同样必须在 Git 外且权限 `600`。两个通用 rclone remote 之间直接复制时，须位于同一份私有 rclone 配置文件中；坚果云专用目标不受此限制。NAS 的独立挂载、磁盘可靠性及云账号配额仍需各自验证，两个目录在同一块磁盘上只能证明流程，不能抵御整盘损坏。

## 同步、冲突和保留

同步使用 restic 的跨仓库 `copy`；新目标通过 `init --copy-chunker-params` 共享分块参数，各自密钥保持独立。已经复制的逻辑快照不会重复发布；上传失败后再次运行可利用已上传数据继续。不会执行 `sync --delete`、`bisync`、`forget`、`prune` 或强行解锁。

每次发布/复制先检查可达仓库的 workspace、writer 和父链。同一父有两个子、快照 ID 对应不同内容树、缺少父节点或出现不允许的 writer 时，保留现有分支并拒绝自动处理。来源落后于已知副本时拒绝发布，不能按修改时间覆盖数据库。某目标暂时不可达时，其他副本可继续，但无法证明离线目标没有产生分支；恢复连接后必须重新校验，不能承诺分区期间绝不分叉。

初版历史一直保留。应用中的删除只出现在后续快照里，旧版本仍可恢复，不传播为所有副本的立即删除；本次不自动清理历史。将来增加保留策略必须先证明列举完整，并禁止删除最后一份已验证副本。

## 换存储和换机器

换供应商：先增加新目标，再运行：

```bash
node scripts/storage.mjs migrate --from local --to other-cloud
```

迁移状态持久化为 copying → checking → verified → completed，失败保留状态，再次执行可安全重试。只有历史复制完成、`check --read-data` 通过、在新的空目录试恢复并完成 SHA-256/schema/SQLite 检查后，才更新 `preferredRepositoryId`。本地活动备份仓库及旧目标始终保留；脚本不会替用户删除旧供应商上的数据。

换机器须按顺序执行：

1. 停止旧机器上的应用 writer、定时 agent 和其他写入口；完成最终一致性快照并复制。
2. 将配置和各仓库解密密钥单独安全转移；在新机器空目录恢复，校验应用及源码版本。
3. 记录新设备 UUID，旧协调器执行 `writer-handover --to-device UUID --source-stopped`。所有已配置副本必须可达且包含最新快照。
4. 交接后的配置保留旧 `deviceId`，因此旧协调器已不能发布；安全转移该配置后，在新机器显式设置新 `deviceId` 和本地路径。保留 `workspaceId`、`activeWriterDeviceId` 及完整 `writerHistory`。
5. 新机应用接入已恢复的数据，检查实际页面/CLI 后再改入口；保留旧数据以便回退。

handover 在清单父链中的指定快照处设置 writer 栅栏：下一快照必须来自新设备，旧设备继续发布会被拒绝。`--source-stopped` 是操作者对服务已经停止的明确声明，不代表脚本能远程证明旧设备离线；无法联系旧机器时不自动抢占。WebDAV 锁和本地 PID 锁不能提供跨机器离线合并能力。

恢复永远要求新空目录，禁止覆盖活动 apps、仓库或协调器状态，并检查符号链接父目录的真实路径。成功恢复不自动启动应用、不更改真源。失败的恢复目录保留用于检查，需换一个新的空目录重试；旧源不变。

解密密钥必须另存离线安全副本。只把密钥放在同一台机器上不能应对机器丢失；只把密钥放进使用它加密的仓库也无法恢复。丢失唯一密钥将无法解密，仓库密码不能从应用密码推导出来。[restic 密钥说明](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)

恢复材料导出会拒绝活动数据、源码、协调状态及备份仓库内的目的地，包含通过父目录符号链接形成的重叠；避免后续快照把自身的明文解密钥一起上传。模板恢复时还需更新新机器的 `appSources`、`sourceRepos` 和工具路径，不能继续引用旧机器的绝对地址。

## 验证与当前限制

```bash
node --test tests/storage-registry.test.mjs tests/storage-snapshot.test.mjs tests/storage-status.test.mjs
```

历史 restic 集成测试使用临时合成数据，覆盖两份独立密钥仓库、重复同步、中文内容、精确路径恢复、历史保留、错误密钥、完整性校验、试恢复后切换及分叉拒绝。这些用例可用于安装验收。另测缺凭据、请求重试、列举上限、日志脱敏及协调锁。SQLite WAL、源码 bundle 和路径逃逸由一致性快照测试覆盖。

本地演练与真实坚果云验收分开记录。没有真实云账号、完整浏览器导出及源音频时，只能报告对应适配和本地流程完成。恢复时间与最后成功快照决定可恢复范围，小时调度不等于断网零损失。活动 SQLite 的一致性来自应用导出，而不是传输工具或网络文件系统。[SQLite Online Backup](https://www.sqlite.org/backup.html)、[restic 跨仓库复制](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)、[rclone WebDAV](https://rclone.org/webdav/)

## 已登记工作区与恢复材料

在私有配置中登记服务器数据来源与源码仓库，保持活动数据原位。更新清单时保留自定义来源及遗漏说明。受管部署与离线写入交接见[运行手册](DOCKER.md)。

Memo 在应用内导出完整 JSON，以应用自己的只读校验器验证内容并记录导出时间。浏览器再次修改后需重新导出。原始音频可作为单独目录登记，新浏览器仍需重新关联文件。

使用 `node scripts/storage-recovery.mjs /absolute/private/new-recovery-kit` 导出配置模板和解密材料。目标必须是新的私有目录，不允许与数据源、代码仓、备份仓库或协调状态重叠，也拒绝符号链接别名。应将该目录安全复制到独立设备/密码管理器；只生成在原机器上不等于已完成异机恢复准备。恢复时重写模板的本机绝对路径，保留稳定 workspace 身份及 writer 交接历史。

迁移新云/NAS 验证后，若不再同步旧目标，可由 agent 在私有配置中移除旧目标的登记并重新生成/启动工作器；事先保留它的解密密钥和目标位置，不能移除当前本地主仓库或默认恢复目标。此操作仅停止协调，不删除旧存储内容。

## 本轮实测结果

2026-11-12：根 137 项检查、Memo 完整导出／导入 34 项检查及 6 项浏览器检查通过。登记的服务数据及代码仓已建加密快照，完成全量读取校验和空目录试恢复，源数据未切换。当轮真实云端往返另行验收。

Docker 隔离实测还包含只读源目录中的冷 WAL 数据库，以及后台取消后等待子进程清理锁。无非空 WAL/rollback journal、主文件稳定时，备份工具可在私有 staging 校验冷数据库；无法安全读取的非空日志会拒绝，绝不丢弃已提交 WAL。恢复材料只保存在原机器仍不构成灾难恢复保证，需另行独立安全保存。

## 当前规划与执行者更新

云端验收分别记录安全保存凭据、客户端配置、实际连通、上传成功和可恢复性。记录凭据就绪仅能证明第一步。

PRD F29 将家庭实时协作与云/NAS 副本分开：多人通过单服务端事实源操作，提交后推送，云端变更触发与持久重试是待实现目标。当前 `watch` 仍默认每小时备份，不能据此宣称已有事件驱动同步。产品 `spaceId` 与本文件的存储 `workspaceId` 不等同；家庭授权不能直接暴露包含个人资料的整个备份仓库。

当前维护 agent 仅修改代码/文档并验证合成夹具；真实业务记录的创建、修改和清理交给指定外部业务执行者经受控 API/MCP。实时、权限、Codex 和手机端的完整验收与未执行台账见 [VERIFICATION.md](VERIFICATION.md)。

Projects使用独立应用数据目录中的`projects.db`，所有具体项目共用该SQLite事实源；以`id:projects,kind:sqlite,target:projects.db`登记在线备份，不按项目创建存储仓。统一业务备份解析器自动覆盖该源，丢失已登记文件时失败关闭；代码子模块作为独立sourceRepo登记。首次录入、备份来源登记、工作器健康和云副本完成分别验证，不以登记完成宣称远端副本已同步。

Knowledge结构化资料使用独立数据目录内的`knowledge.db`，同一SQLite事实源包含各业务库、集合、不可变来源、条目版本、幂等提交与事件发件箱。统一备份解析器按`id:knowledge,kind:sqlite,target:knowledge.db`登记在线备份；旧书籍源文件和照片继续由原代码来源保存，不自动迁写或复制为新业务记录。数据库与配置、签名密钥、代码仓及其他应用数据保持独立。启动新运行时后再启动读取该源的备份工作器；已有数据库丢失时失败关闭，不创建替代记录。登记来源和本地工作器健康不代表云端快照或异机恢复已完成。

## Lattice合仓保全（v0.1.63）

历史合仓后登记唯一源码 `third_party/lattice`。旧源码 Git bundle 与控制配置的恢复副本存于 Git 之外。停写迁移 deck 源文件与状态目录时，比对每个文件的大小、权限、所有者和 SHA 摘要，另行重建派生的 runtime 缓存。独立公开发行历史与私有归档分别保存。

原`apps/slides-business`事实源／blob目录、签名Key、空间与资源ID保持；没有维护侧语义数据迁移或改稿。重新登记不能用源码默认路径覆盖既有canonical数据来源。存储工作器在停写保全与Git合并提交后按新单仓／私有目录清单恢复，健康检查不代替云端副本检查或异机恢复；本次没有另做真实云端恢复。

Memo 场景指南单独登记为 `id:memo,kind:sqlite,target:memo.db`，包含分空间的主题、指南、修订与历史；在线备份使用 SQLite 一致性备份。服务端指南不替代或读取 Memo 浏览器凭证、照片与完整 JSON 备份，后者仍需通过原有导出恢复流程迁移。

独立 Polaris 只读查看器的源码和私有观察文件分别登记。安装文件、挂载与恢复步骤见[查看器文档](POLARIS-VIEWER.md)。

## 统一工作数据与应用覆盖（F92）

活动目录由 `storage.json` 的 `workingData` 统一定义：

```json
{
  "workingData": {
    "version": 1,
    "roots": {
      "memo": "/absolute/private/storage/memo",
      "polaris": "/absolute/private/storage/polaris"
    }
  }
}
```

未覆盖的应用使用 `<dataRoot>/workspaces/<workspaceId>/apps/<appId>`。
应用ID为 reminder、tingproof、knowledge、travel、lattice、memo、projects、polaris、intelligence、praxis。
每个目录必须独立于其他应用、源码、密钥、协调状态与备份库；拒绝符号链接别名。
配置仍在私有配置目录中，不放进工作数据。覆盖可以指向NAS的独立目录，但不能增加第二个活动writer。

| 应用 | 应用根内的工作数据 |
|---|---|
| Reminder | `spaces/<spaceId>/checklist.json`；Web与容器CLI读同一文件 |
| TingProof | `tingproof.db`；用户选取的音频仍是外部输入 |
| Knowledge | `knowledge.db`、`content/catalog`、两种入口的发布内容 |
| Travel | `itineraries`、`content/catalog`、`content/published` |
| Lattice | `native/decks`、`native/.lattice`、`business` |
| Memo | `memo.db`；指南、记录、照片及历史；旧浏览器记录需成功连接后导入 |
| Projects | `projects.db` |
| Intelligence | 正式模式为`data.json`；显式预览从源码fixtures读取，未创建工作数据 |
| Polaris | 私有工作空间的只读观察文件，源码和镜像不携带记录 |
| Praxis | `business`（用户／权限与事件）、`observations` |

更改根目录不是直接改一个环境变量：先计划、停写、迁移校验，再切换生成的配置与挂载。
服务器、备份与管理清单校验同一套生效绑定；不一致时拒绝启动，防止重新登记回旧源码目录。

先保存工作根、配置和实际挂载清单，按[受管部署](MANAGED-DEPLOYMENT.md)切换应用组。新的工作根示例为 `{"memo":"/absolute/private/storage/memo"}`。
迁移日志和原配置保存在私有目录；同盘 rename 核对全部文件 inode 与大小，跨盘复制逐文件核对 SHA-256，保留原源。
应用导出到独立工作根时须使用非覆盖式目标，核对目录内容后再绑定新位置。
已配置内容缺失会拒绝启动，不回退到镜像里的旧内容。

蓝绿部署也需重新绑定停止状态下的两个槽位，之后再启动；只修改prototype不会改变已有容器挂载：

```bash
node scripts/deploy.mjs rebind --image praxis-managed:candidate
node scripts/deploy.mjs up
```

迁移后查看统一服务状态及管理页数据管理，确认实际位置；保留私有迁移报告，勿提交真实数据。
Memo旧设备在打开应用并成功连接后导入，不删除失败导入的本机副本；手机未打开前不能报告已迁出。
只读观察文件只覆盖获准投影。原业务存储应分别进行一致性备份，登记遗漏范围。

## 应用自有的存储集成

已安装应用通过经审核的 `praxis-integration.mjs` 存储合同声明路径别名、数据格式、只读 schema 校验器、备份覆盖及迁移输入；部署配方维护运行默认值及初始空文件。平台负责规范路径、单写者、inode／哈希、SQLite WAL／在线备份及回滚检查，不再维护第二份应用存储表。补充缺失默认值时保留明确登记的私有路径和配置覆盖。

恢复源发现只读取声明的配置元数据及协调器中已使用空间的游标／事件，不读取业务正文。已使用或被独立记录为活跃的数据源消失时，备份必须失败；尚未初始化的映射可明确记为不含真实名称的遗漏。工作进程挂载其声明的父目录，不把缺失文件冒充为已备份。浏览器原件、导出及凭据仍分别说明覆盖边界。

`app-data.mjs plan` 会列出不可用迁移。旧执行树需要尚不支持的应用自有导出时，迁移在移动文件及写入日志前停止，不导入或运行归档执行引擎。原目录及回滚材料继续保留；受支持的物理迁移只复制或重命名已验证字节，不解释或改写业务内容。

## 应用自有结构化数据库

服务端权威结构化记录统一采用每应用独立的 SQLite 数据库。Reminder、Intelligence、Travel 与 Lattice 业务状态保存在各自数据库中，既有 Knowledge、Projects、Memo、TingProof 及平台数据库继续归原所有者维护。保留空间/资源 ID、修订、顺序、回执、事件、时间戳、历史扩展字段及授权。Reminder 使用按空间标识记录的 `reminder.db`，不再以 `spaces/<id>/checklist.json` 树作为运行主源。数据库命名空间不授予权限；JSON 只作显式导入/导出或兼容格式，配置数据库缺席时不得自动回退。

原始文档、媒体、制作源文件和导出物继续保留文件及内容摘要，需要时由数据库引用。Calendar 设备记录改用浏览器 IndexedDB，不因此变成服务端账号或宣称已纳入服务器备份；Matrix SDK 的设备加密数据库及外部 homeserver 所有权保持。Letters/Profiles 继续读取原件；Polaris 继续只读投影外部运行观测，不增加执行器。

此次切换属于存储表示转换，不是业务内容编辑。用户已授权对现有数据做保真转换与部署：停止写者，保留不可变原件、配置/镜像回滚点，校验格式，写入新数据库，比对规范内容、身份、修订、回执与事件覆盖，完成完整性检查和空目录恢复，再切换已验证绑定并启动唯一写者。不得制造记录、改写业务含义、用空库替代缺席来源或删除旧源。DB/WAL/SHM 位于同一可写挂载目录，以 SQLite 在线备份保持一致；应用维护存储、迁移和清单合同，Praxis 通用消费。
