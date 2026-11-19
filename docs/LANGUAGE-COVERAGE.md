# Language coverage

English · [简体中文](#语言覆盖范围) · Reviewed 2026-11-19

The supported interface languages are English (default) and Simplified Chinese. In the standalone or signed-in workbench, open **Settings → General → Language**. The choice is saved in this browser and also applies to the PRD reader. Maintainers update English first and ship the corresponding Chinese text in the same change. The app standard describes the contract for official and locally developed apps. [App standard](APP-STANDARD.md)

The [developer and operator documentation index](README.md) lists paired procedures for the audited first-party apps and identifies the scope of their historical editions.

## What has been checked

| Surface | Evidence and limits |
| --- | --- |
| Workbench, sign-in, authorization, admin and shared navigation | Browser checks covered English and Chinese sign-in, deep-link retention, the app list, account controls, attention cards, the managed Home link and mobile navigation. Tests cover consent scopes, expiry and retry. The selected language also applies to the workbench’s own Paseo controls. The embedded Paseo client has a separate release and language policy. |
| MCP guidance and skills | Official SDK tests read the scoped skill resources, verified each registered operation in both language editions, and checked resource denial after revocation. The two public guidance tools support English by default and Chinese through `Accept-Language`. [Platform reference](PLATFORM.en.md) |
| Calendar | The app owns English/Chinese controls for dates and events. A synthetic browser journey covered export and returning to the workbench. Event titles stay as entered. [Calendar](../third_party/calendar/PRD.md) |
| Matrix Reader | Typed messages cover setup, reader views, keyboard/accessibility labels, counts, dates and recovery states. Browser checks covered switching, refresh, the setup screen and the managed Home link at mobile width. Historical message availability depends on Matrix devices and keys. [Reader](../third_party/matrix-reader/PRD.md) |
| Reminder and Finance | Native and managed browser checks covered both languages at 390 CSS pixels. Reminder checks covered tasks, statistics and focus. Finance checks covered language persistence, form drafts, navigation and revision-conflict recovery. [Reminder](../third_party/reminder/docs/PRD.en.md) · [Finance](../third_party/finance/docs/PRD.md) |
| Projects, Intelligence, Knowledge and Travel | Browser checks covered the main app surfaces in both languages. Separate tests switched the legacy Knowledge index and chapter outline between languages while preserving the original passage. Travel browser checks exercised both map renderers, loading and failure states, accessible expanded map controls, place details and a single-trip share with no private provider requests. [Projects](../third_party/projects/public/app.js) · [Intelligence](../third_party/intelligence/public/app.js) · [Knowledge runtime](../third_party/knowledge/src/runtime/public/app.js) · [Travel interface](../third_party/travel/src/interface-locale.js) |
| Memo, TingProof and Polaris | App-owned copy and language selection are implemented. Memo’s included example material, TingProof’s proofreading UI and Polaris’s portal catalogs have dedicated checks. No private recordings, personal guides or live workflow output were translated to perform these checks. [Memo](../third_party/memo/index.html) · [TingProof](../third_party/tingproof/src/i18n.ts) · [Polaris](../third_party/polaris/apps/polaris-portal/src/i18n) |
| Lattice | The main deck directory, deck menu and presentation controls use app-owned language messages. A browser check loaded a synthetic slide in the native CLI video workbench, exercised timeline and rehearsal controls, and switched languages. At the time of the audit, broader Lattice tests had separate CLI import-path and video-backend expectation failures. [Deck renderer](../third_party/lattice/packages/runtime/src/renderer/deck-app.js) |

## Remaining work

1. **External services and specialist tools.** Map tests used an isolated AMap adapter, a pinned Leaflet library, synthetic tiles and a failing-provider fixture. Actual provider translations, availability and global map coverage require separate checks. Lattice’s video browser test covered a synthetic slide; validate other codec, publishing and hardware paths on their target systems. [Map UI](../third_party/travel/src/itinerary-map.js) · [Video controls](../third_party/lattice/packages/cli/src/video/ui/app/app.js)
2. **Secondary flows and documentation.** A successful default screen or language switch establishes that flow only. Pending proof includes every technical panel, provider-specific recovery path, generated export, physical phone and assistive technology. The English platform PRD, roadmap, verification overview and several app PRDs describe current contracts; the Chinese ledgers also contain historical discussions and granular evidence. For historical/operational parity, translate the remaining entries and validate commands before retiring either version. [Requirements](PRD.en.md) · [Detailed ledger](PRD.md) · [Roadmap](ROADMAP.en.md) · [Verification](VERIFICATION.en.md)

**Content stays in its authored language.** Task and event names, room and sender names, messages, book passages, citations, author notes, real slides, transcripts, provider responses and user filenames are data. Language switching localizes the surrounding interface and formatting. A translated content edition needs its own provenance, review and publication decision.

# 语言覆盖范围

界面支持英语（默认）和简体中文，可在独立或已登录的工作台打开**设置 → 通用 → 语言**。选择保存在当前浏览器中，需求阅读器也使用这一偏好。维护时先更新英文，同一改动交付中文。官方应用与本地开发应用的要求见[应用标准](APP-STANDARD.md)。

## 已核对的范围

| 界面 | 验证和边界 |
| --- | --- |
| 工作台、登录、授权、管理、公共导航 | 浏览器验证了中英文登录、深链接保留、应用列表、账号控件、事务卡片、受管小房子与移动导航，测试覆盖授权范围、过期及重试。工作台拥有的 Paseo 控件跟随语言，嵌入的 Paseo 客户端有自己的发布及语言策略。 |
| MCP 指南与技能 | 官方 SDK 测试读取受限技能资源，逐工具核验英中文档，检查撤销后拒绝访问。两个公共指南工具默认返回英语，可通过 `Accept-Language` 选择中文。[平台手册](PLATFORM.md) |
| 日历 | 日期与日程控件有中英文。合成浏览器验证了导出和返回工作台。日程标题保留录入内容。[日历](../third_party/calendar/PRD.md) |
| Matrix Reader | 类型化词条覆盖首次设置、阅读、键盘与无障碍标签、计数、日期及恢复提示。浏览器验证了切换、刷新、移动宽度的设置页面与返回工作台。历史消息可读性仍取决于 Matrix 设备及密钥。[阅读器](../third_party/matrix-reader/PRD.md) |
| Reminder、Finance | 两种入口都在 390px 浏览器验证了中英切换。Reminder 验证了任务、统计与焦点；Finance 验证了语言持久化、表单草稿、导航和版本冲突恢复。[Reminder](../third_party/reminder/docs/PRD.md) · [Finance](../third_party/finance/docs/PRD.md) |
| Projects、Intelligence、Knowledge、Travel | 已对应用主界面做双语浏览器检查。另测 Knowledge 旧书目录、章节侧栏和无障碍标签中英切换，并逐字核对同一段正文。Travel 浏览器验证覆盖国内外两种地图、加载和失败提示、展开地图、地点详情及单行程分享零私有地图请求。[Projects](../third_party/projects/public/app.js) · [Intelligence](../third_party/intelligence/public/app.js) · [Knowledge](../third_party/knowledge/src/runtime/public/app.js) · [Travel](../third_party/travel/src/interface-locale.js) |
| Memo、TingProof、Polaris | 已实现应用自有文案与语言选择，并对 Memo 示例材料、听校 UI、Polaris 门户词表进行定向检查，使用合成内容。[Memo](../third_party/memo/index.html) · [听校](../third_party/tingproof/src/i18n.ts) · [Polaris](../third_party/polaris/apps/polaris-portal/src/i18n) |
| Lattice | 文稿目录、菜单与演示控件已有应用自有词条。浏览器在原生视频工作台载入合成幻灯片，验证时间轴、排练控件及中英切换。审计时较大范围的 Lattice 测试存在 CLI 导入路径与视频后端预期问题。[文稿界面](../third_party/lattice/packages/runtime/src/renderer/deck-app.js) |

[开发与运维文档目录](README.md)列出此次核查的自有应用开发／运维文档及其英中对照。

## 尚待完成

1. **外部服务与专业工具**。地图验证使用隔离高德适配器、固定版本 Leaflet、合成瓦片及服务失败夹具。真实供应商的地图文字、可用性及各地区覆盖需另查。Lattice 视频浏览器验证使用合成幻灯片，其他编解码、发布和硬件路径需在目标环境实测。[地图界面](../third_party/travel/src/itinerary-map.js) · [视频控件](../third_party/lattice/packages/cli/src/video/ui/app/app.js)
2. **次要流程与文档**。英语首屏和切换语言的验收只证明对应流程。各专业面板、第三方失败路径、导出、实体手机及辅助技术仍需逐项检查。平台英文 PRD、路线图、验证概览及部分子应用 PRD 覆盖当前合同；中文台账还有逐项历史讨论和验收细节。后续应按文档补译并复核命令，再考虑调整版本入口。[需求](PRD.en.md) · [详细台账](PRD.md) · [路线图](ROADMAP.en.md) · [验收](VERIFICATION.en.md)

**业务内容按原文保存。** 任务与日程名称、房间名、发言人、消息、书籍段落、引文、作者笔记、实际文稿、转写、供应商响应和文件名均属于数据。切换语言影响界面和格式。若需发布内容译本，须独立记录来源、评审与发布决定。
