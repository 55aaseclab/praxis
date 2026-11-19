# 需求与体验观测

[English](OBSERVABILITY.en.md) · 简体中文

F32 将服务请求、统一业务 HTTP/MCP 动作、适配请求和工作台浏览器事件写入独立的本地 SQLite 观测库。第三方应用自身页面尚未接入；点击应用图标只说明发起打开，不能证明应用加载成功。日志是人工复核线索，不自动生成需求、修改 PRD 或调整权限，Praxis 不运行内部 agent。

## 启用与边界

根服务可通过 `createPraxisServer({ observationsFile })` 或 `PRAXIS_OBSERVATIONS_FILE` 指定文件；统一业务服务使用私有配置的 `observationsFile`。未指定时关闭采集，不自动创建默认文件。两个服务可共用一个独立观测库。文件必须位于 Git 目录外，父目录权限 `700`、文件权限 `600`，且不能使用符号链接或硬链接。不要把它指向任何应用、身份、事件或备份数据库。已有文件只有带正确应用标识的观测库才会被打开写入。

公开工作台的反向代理可能重写 Host；此时通过 `observationsOrigin` 或 `PRAXIS_OBSERVATIONS_ORIGIN` 显式配置唯一可信公开 origin。只接受 HTTPS 或回环 HTTP，且与浏览器 Origin 完全匹配，不回退内部 Host，也不信任 Forwarded/X-Forwarded 请求头。原生工作台未配置此项时，按请求 Host 校验同源。

库保留三十天、最多五万条，启动和写入时清理。常规写入的 SQLite 锁等待为零，启动初始化的锁等待为250毫秒；锁冲突、磁盘错误、损坏或日志代码异常不改变业务结果。不把观测库注册为业务备份来源，不触发业务 outbox 或副本队列。Docker 只挂专用观测目录，不增加凭据或 Docker socket 的挂载。未执行真实服务切换时，源码交付和合成测试不能宣称线上已采集。

## 记录内容

`OBSERVATION_SCHEMA` 是唯一字段与枚举定义。服务生成事件 ID 和时间；记录固定事件/路由/方法/来源/应用/能力/结果/原因分类及有限非负整数耗时。所有未经认可的名称归 `other` 或固定未知类别。禁止记录正文、参数、资源 ID、用户原名、原 URL/path/query、未知工具或操作原名、IP、UA、设备标识、认证头、cookie、token、错误消息和堆栈。

HTTP 传输、MCP 协议、业务动作和适配请求分组报告，不把同一动作的多个跨度累加成用户次数。MCP 的 HTTP200 不代表业务成功；工具回调的 `isError` 仍按权限拒绝、冲突或不可用分类。已存在但未授权的隐藏工具不视为能力缺口。未知工具在 SDK 提前拒绝时仍只记录安全分类；未知操作可匹配固定的 search/share/import/export/schedule 等能力，无法匹配的归 `other`。

健康检查、catalog 能力探测、内部事件采集和 SSE 系统事件不进入用户失败、能力候选或业务慢榜。SSE 仅计连接建立耗时。提前断开的普通 HTTP 请求记录一次取消，不重复记录 finish/close。页面慢阈值为三秒，业务及适配请求为一秒；报告给出样本数、各结果数量及 p50/p95。拒绝、并发冲突和不可用分别显示，不能据此宣布产品缺少需求。

## 浏览器入口

仅根工作台接收 `POST /api/observations`，JSON 不超过 `1024` 字节，全服务实例合计最多每分钟 `120` 条。必须同源：Origin 的 host 与当前请求 Host 一致，且有 Sec-Fetch-Site 时只能为 same-origin。不信任转发来源头。浏览器来源始终标记为未验证的客户端上报，不据此确认真实用户或服务器成功。

允许的正文为：

```json
{"event_name":"page_load","duration_ms":123}
```

`event_name` 仅接受 `page_load`、`registry_load`、`app_open`、`page_error`；可选字段只有 `duration_ms` 和采集端枚举中的 `app_id`。浏览器耗时上限十分钟，上传最多等待两秒，超时或中断不保留部分正文。任何额外字段、非法枚举、跨源或超限均拒绝；返回码为204、400、403或429。不提供原始日志读取HTTP/MCP接口。「设置 → 状态概览」仅向显式获准浏览器身份提供聚合报告，详见[工作台状态概览](PLATFORM-STATUS.md)。

## 聚合报告与验证

```sh
node scripts/observations.mjs report --file /private/operational/observations.db --window day
node scripts/observations.mjs report --file /private/operational/observations.db --window week --json
```

CLI 只读报告，不创建缺失的库。停用、不可用、空库分别显示 disabled、unavailable、empty，不填充演示数据。浏览器报告单列且明确不可信，能力候选标记为需要复核。最近一天或七天之外的记录不参与报告。

合成验收覆盖正文、参数、URL、未知名称和错误消息的隐私哨兵、成功/拒绝/冲突/未支持/慢请求、MCP HTTP200业务失败、catalog 排除、同源/限额/大小、锁竞争、重启保留和三十天/五万条上限；不读取真实业务数据或触发线上业务写入。

运行验收（v0.1.18）：268项根测试全部通过；隔离Chromium验证一次加载、隐私过滤和采集不可用不影响页面。已部署服务的首页产生真实脱敏HTTP/浏览器记录，13项既有服务健康；真实业务数据未写入。
