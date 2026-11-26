# 业务空间的动态备份覆盖

[English](BUSINESS-STORAGE.en.md) · 简体中文

业务应用拥有唯一事实源。每次副本任务开始前，用 `withBusinessBackupSources(storageConfig, businessConfig, { knownActiveSources })` 生成临时存储配置，再交给现有快照与加密副本流程；不复制或迁移原始业务数据，不改写磁盘上的注册表或配置。

覆盖范围包括：

- `database` 与 `eventsDatabase` 中的身份、委托、审计、事件和待同步状态，登记为 SQLite，由现有在线备份保存已提交 WAL 内容。
- 已配置 TingProof 的 `apps.tingproof.dataFile`，以及 Projects 和 Memo 的 `dataDir` 下对应的 `projects.db` 和 `memo.db`。已登记同一路径时复用来源。

函数只读取受保护的空间映射配置和 SQLite 事件元数据，不读取任务或校正正文。已有 `appSources` 按真实路径去重；冲突的类型、目标或空间绑定失败，不把同一路径当作两份不同数据。符号链接、路径逃逸、与副本仓库或暂存目录重叠的来源均拒绝。

尚未创建、也没有活动证据的新空间可以缺少文件，但必须在 `coverage.omitted` 标记为 `uninitialized`。已经登记、在事件元数据中出现过、或在 `knownActiveSources` 中记录过的来源丢失时，任务失败并保留待同步状态，不能把数据丢失写成未初始化或已同步。

执行 worker 应将已观察到的活动来源路径保存到 Git 外的私有 coverage inventory，并在下轮及进程重启后传入 `knownActiveSources`。仅依靠事件收集不能覆盖“首次业务提交后尚未收集事件就丢失文件”的窗口；未接入持久 inventory 前，不能宣称该窗口已验收。Inventory 只保存来源身份与路径，不保存业务正文或服务密钥。

备份清单中的纳入、未初始化遗漏、失败三种情况分别报告。这里的“覆盖”不等于云端副本已经上传或可以恢复；真实云端往返与恢复仍按 [存储契约](STORAGE.md) 和 [验证方案](VERIFICATION.md) 分别验收。身份数据库含敏感授权元数据，只进入已有加密备份；应用签名密钥及恢复材料另行保管，不写入通用日志或 Git。
