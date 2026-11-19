# 平台迁移对照

[English](MIGRATION.en.md)

本次对照以冻结的平台提交 `8e666c2` 为源码基线。平台维护代码及其合成测试保存在 Praxis；独立应用固定到各自公开仓库的提交。真实业务记录、安装凭据和私有运维历史继续私有保存。

## 部署与运维合同

| 原有能力 | 当前源码 |
| --- | --- |
| 原生应用镜像与 Compose 服务 | [Dockerfile.builtins](../Dockerfile.builtins) 与 [compose.yaml](../compose.yaml) 构建固定版本的原生应用；静态阅读器随平台镜像提供。 |
| 应用栈控制 | [stack.mjs](../scripts/stack.mjs) 保留计划、构建、启动、资产构建、激活、状态、日志和 exec 流程。 |
| 统一服务控制 | [run-stack.mjs](../scripts/run-stack.mjs) 协调已配置的应用、核心后端、存储和观察服务。 |
| 核心后端服务控制 | `npm run core:stack` 使用 [business-stack.mjs](../scripts/business-stack.mjs)，保留私有身份、应用密钥和来源映射。 |
| 备份登记 | [storage-bootstrap.mjs](../scripts/storage-bootstrap.mjs) 与[登记实现](../src/storage/registry.mjs) 登记既有规范来源。 |
| 应用数据计划 | [app-data.mjs](../scripts/app-data.mjs) 与[应用路径](../src/storage/app-paths.mjs) 保留显式工作根目录和可恢复交接。 |
| 运维数据清单 | [data-inventory.mjs](../scripts/data-inventory.mjs) 展示登记的来源绑定和覆盖范围。 |
| 版本同步 | [version.mjs](../scripts/version.mjs) 同步 package、需求和路线图中的版本，并保留历史记录。 |
| Lattice 原生工作台及媒体功能 | [公开构建适配器](../scripts/build-slides-public.mjs) 与[原生门户适配器](../scripts/serve-slides-public.mjs) 保留原引擎、创作、文件及渲染接口。 |
| Polaris 观察记录 | [查看器部署](POLARIS-VIEWER.md) 使用已独立发布的只读版本及私有工作区观察投影。 |
| 既有受管安装 | [受管部署](MANAGED-DEPLOYMENT.md) 保留显式项目名、固定镜像、挂载和写者交接。 |

## 验收范围

进程健康只说明服务就绪，不能证明原有应用功能已经迁移。用合成记录检查原生浏览器界面及底层操作，按应用支持范围验证导入、编辑、创作、文件交付和导出。重启服务后再比对同一组记录。分别核对所有者、普通成员、限定资源委托、匿名请求和撤权行为。

全新 Compose 安装只首次生成私有密钥和身份，数据卷绑定标记用于检测缺失或混用的工作目录。初始化重试保留既有账号及授权策略。原受管安装使用其私有描述文件和恢复点独立验收。

历史私有内容由获授权的所有者通过登记的私有绑定恢复。公开应用源码、首次空存储和实际业务资料分别管理。

## 既有 TingProof 集成

对于尚未把 TingProof 连接到限定业务空间的既有安装，恢复的原生创作模式保留现有网关入口授权。完整内置安装启用按空间核对的原生创作授权，要求在所有配置空间同时拥有全部资源的读取和任务分配权限。既有受管部署配置好空间映射后，可显式设置 `PRAXIS_TINGPROOF_SCOPED=true` 启用该集成。外部的限定 assignment 调用继续独立核对业务权限。
