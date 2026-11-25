# Finance

> 已于 2026-11-25 从 Praxis 发行版退役；文档存档说明见 [RETIRED.md](RETIRED.md)。

[English](README.md)

本地人民币账本，提供收支、预算、资产与储蓄目标预测。可设置目标、登记流水并比较月度预算与实际储蓄。新账本的余额均为零，目标可调整。

```sh
npm start -- --host 127.0.0.1 --port 4329
```

## Praxis 集成

应用维护的[供数合同](PRAXIS-PROVIDER.md)提供按授权过滤、有来源依据的卡片与数据源描述，不增加 HTTP 元数据入口。使用 `npm run test:provider` 验证隔离供数测试。

## Praxis 登记

应用发行版本：`0.1.3`。本应用维护 [`praxis-app.json`](praxis-app.json)、英中展示文案、`public/praxis-icon.svg` 图标、PRD 路径及需要保留的旧图标别名。`schemaVersion: 1` 表示登记格式，与应用发行版本、数据、协议和文档修订分别管理；已有 package 和 lockfile 的发行版本须与声明一致。

[`apps.example.json`](apps.example.json) 引用 `./praxis-app.json`，使用 `http://127.0.0.1:4329/` 登记本地别名。先按上文启动独立服务；登记不启动后端，也不授予账号、管理员或业务数据权限。安装地址、数据位置与授权策略仍独立配置。

## SQLite 存储与转换

结构化运行记录使用应用数据库。运维命令为 `npm run storage:migrate -- --spec /absolute/private/sources.json --database /absolute/private/app.db --receipt /absolute/private/receipt.json --writers-stopped`，私有 spec 数组每项为 `{file, spaceId, documentId}`。先停所有写者、保留原文件，比对回执后才激活新绑定。JSON 保留为显式兼容/导入来源，配置数据库时不静默回退。`--export --database /absolute/private/app.db --space SPACE --document state --output /absolute/private/new-export.json` 可导出逻辑命名空间以恢复。原件/素材保持归属。
