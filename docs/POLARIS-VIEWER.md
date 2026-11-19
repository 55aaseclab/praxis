# Polaris observation viewer / Polaris 观察查看器

## English

The managed workbench opens the viewer at `/apps/polaris/` after verifying a platform administrator's session. Its backend listens through a single host loopback mapping at `127.0.0.1:18787`. This port is local maintenance access on a trusted host. With the base configuration the work desk, pack list and run history start empty.

From the platform repository, build the fixed viewer revision and start its dedicated Compose project.

```sh
git submodule update --init third_party/polaris
bash scripts/build-polaris-viewer.sh
export PRAXIS_POLARIS_VIEWER_REVISION=$(git rev-parse HEAD:third_party/polaris)
docker compose -f compose.polaris-viewer.yaml up -d --wait
```

The image contains the read-only server and built browser assets. The viewer joins only an internal network. A separate ingress container forwards to the fixed viewer address and publishes the loopback port. Both containers use non-root accounts, read-only root filesystems, and empty capability sets. The base configuration has zero host mounts. The GET/HEAD API reads observation projections. HTTP mutations receive 405.

### Display authorized academic observations

An independently authorized publisher may supply a workspace-scoped JSON snapshot of academic workflows. The required envelope includes `workspaceId`, `packs`, `runs`, and `graphs`. Optional `events` maps run IDs to ordered observations. Use the viewer's native types in `third_party/polaris/packages/polaris-shell/src/workflow.ts`. The following empty snapshot uses a synthetic workspace ID.

```json
{"workspaceId":"example-academic","packs":[],"runs":[],"graphs":[],"events":{}}
```

Mount a single regular, owner-only file outside the checkout. Set mode 0600, use a non-root owner and keep the parent directory private. The configured ID must match the file. The server checks file ownership, permissions, size and workspace when reading each API request. Set the following values for the existing authorized projection.

```sh
export PRAXIS_POLARIS_OBSERVATIONS_FILE=/absolute/private/academic-observations.json
export PRAXIS_WORKSPACE_ID=example-academic
export PRAXIS_VIEWER_UID=$(stat -c %u "$PRAXIS_POLARIS_OBSERVATIONS_FILE")
export PRAXIS_VIEWER_GID=$(stat -c %g "$PRAXIS_POLARIS_OBSERVATIONS_FILE")
docker compose -f compose.polaris-viewer.yaml -f compose.polaris-observations.yaml up -d --wait
```

The overlay adds one read-only file mount. When the publisher atomically replaces the file, rerun that Compose command with `--force-recreate` to mount its new inode. A missing, unreadable or mismatched projection fails the API readiness check. The viewer can display previous work as soon as its authorized projection is available.

## 简体中文

受管工作台会核对平台管理员会话，然后通过 `/apps/polaris/` 打开查看器。后端在可信主机上通过唯一的回环端口映射 `127.0.0.1:18787` 提供本机维护入口。按基础配置启动时，工作台、工作流包列表和运行历史都为空。

在平台仓库中构建固定版本，然后启动独立的 Compose 项目。

```sh
git submodule update --init third_party/polaris
bash scripts/build-polaris-viewer.sh
export PRAXIS_POLARIS_VIEWER_REVISION=$(git rev-parse HEAD:third_party/polaris)
docker compose -f compose.polaris-viewer.yaml up -d --wait
```

镜像携带只读服务和编译后的浏览器资源。查看器只加入内部网络。单独的入口容器向固定查看器地址转发流量，并发布回环端口。两个容器都使用非 root 账号、只读根文件系统和空的 Linux 能力集。基础配置没有宿主机挂载。GET/HEAD 接口读取观察数据，写请求返回 405。

### 展示已授权的学术观察数据

独立获授权的发布方可提供限定工作空间的学术工作流 JSON 快照。外层字段包括 `workspaceId`、`packs`、`runs` 和 `graphs`，可选的 `events` 将运行标识映射到有序观察记录。字段类型见 `third_party/polaris/packages/polaris-shell/src/workflow.ts`。上面的空快照使用合成工作空间 `example-academic`。

在源码检出目录外准备一个普通文件，权限为 0600，由非 root 账号持有，父目录设为私有。配置中的工作空间标识须与文件一致。每次读取接口时，服务会检查文件所有权、权限、大小和工作空间。将以下变量指向已经授权的快照。

```sh
export PRAXIS_POLARIS_OBSERVATIONS_FILE=/absolute/private/academic-observations.json
export PRAXIS_WORKSPACE_ID=example-academic
export PRAXIS_VIEWER_UID=$(stat -c %u "$PRAXIS_POLARIS_OBSERVATIONS_FILE")
export PRAXIS_VIEWER_GID=$(stat -c %g "$PRAXIS_POLARIS_OBSERVATIONS_FILE")
docker compose -f compose.polaris-viewer.yaml -f compose.polaris-observations.yaml up -d --wait
```

叠加配置只增加一个只读文件挂载。当发布方通过原子替换更新文件后，再次运行上述 Compose 命令并加上 `--force-recreate`，使容器挂载新的 inode。文件缺失、无法读取或工作空间不匹配时，接口就绪检查失败。提供已授权的观察快照后，查看器即可展示既有工作。
