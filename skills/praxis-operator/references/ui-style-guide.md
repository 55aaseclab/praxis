# Praxis UI/UX 设计指南

[English](ui-style-guide.en.md) · 简体中文

工作台、独立应用和受管项目共用这份指南。设计一项功能时，先说明用户怎样完成任务，再决定页面怎样排列。例如，用户点开「DSL 与安全」，预期先看到这个项目；想读研究资料时，再从项目的「资料」打开原文。这个预期决定了入口归属、首次加载的内容，以及返回时应回到哪里。

## 从任务选择界面

| 用户此刻要做什么 | 采用的界面 | 怎样知道走对了 |
|---|---|---|
| 找到并打开一个应用或项目 | 启动台按用户认识的对象分组。同类对象取自所属应用的授权列表，共用一种入口。 | 点击任一项目都进入对应 Projects 概览；标题与刚才点击的项目一致。 |
| 在一组对象之间挑选、比较或切换 | 集合页保留列表、选中项和必要的筛选；主栏显示当前对象。 | 从详情返回时，原来的范围、筛选和位置仍可辨认。 |
| 阅读资料、查证一句话 | 阅读页把空间留给正文。分别命名「内容目录」「章节目录」「文件目录」或「本页目录」，让用户知道每个控件会带他去哪。 | 从 Knowledge 引文进入能看到对应原件和段落；目录可以跨页定位。 |
| 修改内容或完成专业操作 | 编辑页把主操作放在所影响的对象附近，清楚区分草稿、提交中和已保存。只读视图提供阅读及来源操作。 | 用户能看出修改是否已保存，离开可能丢失输入时有机会留下。 |

## 导航、返回和权限

- 用链接打开有地址的目的地，用按钮执行动作，用展开控件显示同一处的更多内容。相同动作使用同一名称。「返回工作台」回平台首页；浏览器后退回上一步；「上一节」沿当前文档顺序移动。
- 可分享的深链接要带足定位信息，如项目和空间、原件和段落。打开链接或刷新时重新鉴权。对象不存在或无权访问时，就地说明并提供可访问的返回入口，避免自动跳到另一个项目造成误认。
- 首次确认授权后才展示私有名称、数量和入口。同一身份在原范围内后台复核时，保留仍有效的画面和焦点；确认撤权、会话结束或切换身份时，及时清掉受影响的数据。资源复核失败按应用的访问合同收起相关范围，仍可用的独立区域继续工作。切换对象后丢弃旧请求的迟到结果。
- 受管私有页面沿用平台提供的左下角工作台入口；独立应用保留自身导航，公开分享页仅展示本次分享允许的内容。手机可折叠目录，当前对象、返回目的地和权限边界与桌面一致。

## 让用户看懂系统状态

| 情境 | 用户看到什么 | 接下来可以做什么 |
|---|---|---|
| 首次读取 | 在相应区域显示「正在读取项目…」等具体状态；相关结果就绪后一起呈现。独立区域可分别就绪。 | 先使用已就绪的区域。工作台不会先出现两项固定项目，随后又插入其他项目。 |
| 同一范围后台刷新 | 数据未变时保持画面；有变化时更新相应条目和统计，保留有效的选中项、展开状态和滚动位置。 | 继续阅读或操作。当前项被移除时给出返回列表的路径。 |
| 确认空、无匹配或数量未知 | 已确认空的数量可显示 0；无匹配说明当前筛选；未知显示「—」或省略。 | 有筛选时可清除筛选；只在当前身份有权新增且界面支持时提供新增操作。 |
| 长任务或部分完成 | 按实际进展显示「等待解析」「正在解析」「可检索」或「部分文件未能解析」。只展示服务端能够确认的计数。 | 完成的部分可用时允许先读；保留对同一任务、失败范围和恢复方式的入口。 |
| 操作失败或结果待确认 | 在操作发生处说明受影响的对象、已知原因和可用动作。登录失效提供登录入口，输入错误指向具体字段。 | 保留允许保留的输入。写入返回超时时先核对保存状态，再按原操作重试，避免重复创建。 |

成功反馈以用户的目标为准。项目创建完成后给出可进入的项目；书籍提交后先说明「已接收」，能搜到并打开原文后再说明「可检索」。外部 agent 报告的状态与网页采用同一业务含义。需要确认的破坏性操作写明对象、后果和取消选项；普通浏览和可逆切换直接响应。

## 操作与评审

可点击区域要有清楚的文字或可访问名称。键盘用户能到达主操作、看到焦点、选定目标并返回；关闭菜单后把焦点还给触发控件。状态变化用文字说明，对等待中的用户可通过状态区域播报一次；后台轮询保持安静。触屏主要操作保留舒适的命中区域，减少动态效果时仍看得懂选中、完成和出错状态。

写需求或交付设计时，用一句话串起 **入口 → 动作 → 可观察的结果 → 返回或恢复**。从实际改动中选择最容易走错的一步做交互检查。例如：

- **工作台**：让项目请求慢于应用请求。观察项目区先给出加载反馈，随后一次出现获准项目；点开原参考项目进入其概览，从「资料」能到来源。
- **Knowledge**：从回答中的引用打开一本书，确认标题和目标段落；切到另一个章节再后退，能回到刚才查证的位置。
- **编辑器**：修改一个字段时模拟保存失败，确认输入仍在、原因可见；重试成功后只产生一次有效变更。

下面保留视觉与布局的实现细则。根据正在改动的任务选用相应模板及检查项。

## Visual design foundations

Use this guide when creating or changing an app interface within the requested scope. The direction is a simple, content-first native application: compact navigation, clear hierarchy, restrained color, and familiar controls. **Share a visual language; choose the layout for the user's task.** Reminder is the golden reference for breathing room and the collection-app sidebar template, not a requirement to put every page into two columns. Do not copy its business data or introduce a dependency on its code or runtime.

Apple's Human Interface Guidelines inform the principles below. Reference dimensions, template choices and sample tokens are **Praxis conventions**, not Apple requirements. Explicit user choices and the owning app's requirements take precedence. Applying the guide does not authorize retrofitting untouched apps.

Platform navigation and account controls belong to Praxis, outside an app's own navigation and content. In managed private pages, provide a compact, accessible Home control fixed at the bottom left: a 44 CSS px target, inset 12 px plus device safe areas. Keep this anchor stable during scrolling, content updates and chart rendering; never scan the page to move it or rewrite the app's body viewport. Handle a demonstrated conflict with a real app control through narrow app-owned spacing. Keep account information and logout in the workbench account menu. All authenticated users use the same management page, with contents limited by their current role. Ordinary users may view their own access and manage their own agent grants; administrator modules and data remain separately protected. Permission and delegation management stays in the existing management interface; do not duplicate it in the account menu. Independently running apps and public shares do not receive private platform controls. Preserve app-local unsaved-change protection and same-tab history; do not add a runtime dependency on Praxis to independent app code.

## Choose a layout template

### One function, one interface

Different records, regions, users and service providers use the same components, layout and interactions for the same business function. Render validated data through the existing interface; isolate provider differences in narrow adapters. Do not clone renderers, page scripts or styles for another dataset, or add old controls merely to preserve an earlier page. Code owns field types, labels, units and missing states; agents fill allowlisted data rather than inventing presentation. Verify the shared interface with multiple datasets and missing values. Keep app ownership and independent operation intact; this rule does not introduce a cross-app runtime dependency.

Start with the primary task, then choose a shell. Font, color, control states, spacing rhythm and accessibility remain consistent across shells. These are design templates, not a shared runtime library or four new product features.

| Template | Use when | Structure and reference |
|---|---|---|
| Launcher | Discovering and opening apps or projects | Centered responsive icon grid with small group headings and one compact identity/navigation row. Praxis workbench uses this template. Prefer no permanent sidebar for a small set of launchers. |
| Collection | Switching among task views, routes, users or other collections while keeping navigation available | Compact sidebar and flexible main pane. Reminder is the measured golden reference below; Travel and management use this pattern where their navigation warrants it. |
| Reading | Reading documents, notes or reference material | Comfortable 65–80-character reading width; an optional contents rail for long documents and unobtrusive contextual navigation. Do not reserve an empty sidebar for short text. |
| Editor | Creating or changing content that needs sustained working space | A generous canvas or editor with a local toolbar; optional contextual inspector when it serves the task. Do not shrink a slide or document canvas merely to reproduce collection navigation. |

### Launcher template

The Praxis workbench uses a device-home-screen variant: a calm full-height canvas, recognizable app icons with names, and one compact bottom system bar for the existing brand, management, PRD collection and account actions. Keep applications and projects as peer groups. Secondary app descriptions may remain accessible without a permanent visible caption row. Reuse one DOM and renderer across desktop, tablet and phone; vary grid density and spacing through responsive CSS. Do not duplicate app entries in a second dock or introduce widgets, fake status indicators, search, pagination, drag editing or layout storage without a requirement.

Give the bottom bar a real layout row with safe-area spacing, rather than covering icons with an overlay. Let the canvas scroll when content or enlarged text exceeds the viewport. The account menu opens above its trigger, stays inside the viewport and can scroll on short screens. Every touch action needs a minimum 44 CSS px target, visible keyboard focus and complete accessible naming even when a long account label is visually shortened. Verify tablet portrait/landscape, 320–390 px phones, short landscape screens, 200% text and reduced motion alongside desktop. Scope this variant to the workbench body; readers and independent apps keep their own layouts.

Use the actual apps or projects as the main visual content. Start with a centered maximum width near 1200–1350 px, 32 px desktop / 16 px narrow outer padding, a responsive grid and modest section headings. Keep icons, labels and hit areas consistent; preserve recognizable app artwork. Avoid repeated card borders, decorative shadows, oversized titles, promotional sections, footers and extra panels that compete with launching an app.

A compact, normal-flow identity row may carry the platform name, gated management/document links and account controls. This functional row is appropriate here; it is not a mandate for a global bar in collection apps. Wrap the row and grid on narrow screens without hiding logout or permitted navigation. Preserve same-tab app navigation and scoped empty/error states. Do not add counts, filters, search or persistent navigation merely to fill space.

### Collection template: golden shell and sidebar

The reference is the actual Reminder [stylesheet](../../../third_party/reminder/public/styles.css) and [page structure](../../../third_party/reminder/public/index.html). Its desktop shell uses border-box sizing with a centered maximum width of 1350 CSS px, 32 px outer padding, and a 20 px gap between a 160 px sidebar and flexible main content. The sidebar is sticky, 32 px from the top. These dimensions establish the default breathing room; do not widen the sidebar to 180–220 px when the labels fit at 160 px. The main pane uses the shell's padding rather than adding another full outer inset.

| Element | Golden starting point at a 16 px root size |
|---|---|
| Shell | `max-width: 1350px; margin: 0 auto; padding: 32px; gap: 20px` |
| Sidebar | `width: 160px; flex-shrink: 0; position: sticky; top: 32px` |
| Main pane | Flexible remaining width; `min-width: 0` |
| Root text | 16 px, line height 1.4, system font |
| English app name | 16 px, weight 650; brand padding `0 8px 16px` |
| Chinese subtitle | Block below app name; 0.72rem (11.52 px), regular, muted, 2.4 px top gap |
| Navigation entry | 14 px label; padding `7.2px 8px`; minimum height 36 px; 8 px internal gap; 3 px between rows; 8 px radius |
| Entry icon | 18 × 18 px; rounded colored glyph area, about 5.6 px radius |
| Entry count | 12 px, muted, aligned to the trailing edge |
| Selected entry | Soft neutral background and weight 650, plus semantic current state |

### Sidebar typography and vertical alignment

Set the sidebar's font family and unitless `line-height: 1.4` locally. The app name, Chinese subtitle, and navigation rows must inherit that 1.4 line height, even when main prose uses 1.6 or a legacy page body uses 1.65. Use Reminder's exact font order for this chrome: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`. Placing `system-ui` first can select a different font and change glyph metrics on Linux. Main content may use its own reading line height without moving the sidebar's line boxes.

Keep the subtitle's top margin at `0.15rem` and the brand's bottom padding at `1rem`. Verify the resulting line boxes, not just those declarations: a larger inherited line height can push the first entry down even when the margins and sidebar width match. At a 16 px root size on desktop, the reference brand block is about 56.9 px tall, placing the first entry about 56.9 px below the sidebar's top. This is a relative offset, not a universal viewport Y coordinate. Compare the rendered brand height, English/Chinese text positions, and first-entry offset with a golden fixture in the same browser, font environment, viewport, and zoom; use the fixture's measured values with a small rendering tolerance, such as 1 CSS px. Keep such comparison fixtures local to verification rather than introducing a runtime or test dependency between apps.

The sidebar protocol is **English app name → Chinese subtitle → navigation entries**, with each entry arranged **icon → label → count**. Use a brief Chinese subtitle that explains the app, and short navigation labels that fit the compact width. Choose meaningful icons while retaining visible text labels; decorative icons should be hidden from assistive technology. Counts must represent known, meaningful quantities within the current access scope. Omit an unknown or irrelevant count instead of inventing a number or adding a badge for decoration. A known zero can be shown when useful. Do not copy Reminder's category names or record counts into another app.

Use the measured geometry as the starting point, adapting only when actual content or accessibility requires it. On touch layouts, increase row hit areas toward 44 px without enlarging the desktop sidebar. A local label that cannot fit should wrap or receive a purposeful adaptation rather than force a wide navigation rail everywhere.

### Collection shell and navigation

- On desktop, use the golden two-column shell: a 160 px leading sidebar and flexible main content pane. Let the main pane shrink without overflowing and preserve the centered outer margins and 20 px column gap.
- Put app identity and primary navigation in the sidebar using the app-name, Chinese-subtitle, icon/label/count structure above, with at most two visible navigation levels. Show the active destination with a persistent selection treatment and appropriate `aria-current` value, such as `page` for a route or `location` for a section anchor.
- For this sidebar template, omit a global top bar and footer. Begin the main pane with a moderate page title and any necessary local actions; an in-pane heading or contextual control row is appropriate. Keep important actions near the content they affect. Do not apply this sidebar-specific rule to a launcher's compact identity row or an editor's functional toolbar.
- Navigation must respect the current access scope. A restricted or shared view must not expose another collection, a private catalog, or a broader workspace through its sidebar, back links, or mobile navigation. Preserve the app's route and authorization contracts when changing presentation.
- Use a readable content width and aligned leading edges. Prose usually benefits from a limit near 65–80 characters per line; tables, maps, and editors can use more of the pane. Use normal document scrolling unless the task benefits from independently scrolling panes.

These choices adapt the navigation and grouping principles in Apple's [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) guidance. The following visual and accessibility rules apply across templates; sidebar geometry applies only where a sidebar is chosen.


## Page boundaries

Use the approved page inventory: login, workbench, management, PRD collection, and existing app or project pages. Implement new requirements inside these pages and their existing components first. Add an independent page, settings center, or navigation entry only when the user explicitly requests it. An existing protocol login or OAuth confirmation flow does not justify another permanent authorization dashboard. Treat each extra page and navigation choice as a design cost.

## Typography and spacing

Use the reference system font stack with suitable language fallbacks: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`. Keep the sidebar's local typography contract above distinct from main prose leading. Use platform text styles in native implementations. Keep ordinary text regular and headings or active items medium/semibold; avoid light weights and decorative display fonts.

| Role | Starting point for web apps |
|---|---|
| Page title | Start near Reminder's 1.45rem (23.2 px), semibold; one clear primary heading |
| Section heading | 18–20 px, medium/semibold |
| Body and controls | 15–16 px; root line height 1.4, with more leading for long passages when useful |
| Supporting metadata | 13–14 px, sufficient contrast |

Use relative units so text respects browser settings. Adjust the scale to the content without turning the title into a marketing headline. Preserve heading order and allow Chinese labels, long titles, and enlarged text to wrap.

Use a 4 px base with an 8 px spacing rhythm for content: 4–8 px within a tightly related group, 12–16 px between related elements, and 24–32 px between sections. For collection layouts, keep the measured sidebar row spacing and the golden shell's 32 px desktop / 16 px narrow outer padding rather than double-padding the main pane. Other templates use their chosen content width and the same spacing rhythm. Align labels, values, and section edges before adding visual decoration.

The hierarchy and legibility principles follow Apple's [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) guidance; the CSS sizes and spacing above are local starting points.

## Color, surfaces, and controls

Use semantic app-owned tokens. A light appearance can start with this neutral palette and one accent, then adjust for the app's content and contrast requirements:

| Token role | Example |
|---|---|
| App background | `#fafafa` |
| Control / content surface | `#ffffff` |
| Selection / soft surface | `#f0f0f4` |
| Primary text | `#252529` |
| Secondary text | `#606069` |
| Decorative separator | `#e1e1e6` |
| Interactive accent | `#1672d4` |

These colors stay close to the reference while using darker secondary text for small subtitles and counts. Geometry and breathing room are the golden qualities; adjust color values where needed to preserve contrast.

Reserve accent color for links, selection, and the primary action. Give success, warning, and destructive states their own semantic roles with text or icons, rather than color alone. A decorative separator can be subtle; a boundary required to identify a control needs stronger contrast.

Prefer whitespace and thin separators to repeated containers. Use lists, tables, and sections for structured information. Use a card only when the content is a meaningful independent unit. Controls and selected rows can have modest 6–10 px corner radii; keep their size and treatment consistent. Reserve shadows for meaningful elevation, such as an overlay.

Avoid promotional hero sections, decorative illustrations, gradients, ornamental badges, oversized titles, repeated rounded cards, and unnecessary shadows. Retain useful content images, diagrams, maps, and domain-specific tools. Let real content supply the interface's character.

Light mode alone is acceptable unless the app promises more. When implementing dark mode, define and verify every semantic role, state, control, and embedded surface in both appearances; do not invert a few colors and leave unreadable exceptions. Apple's [Color](https://developer.apple.com/design/human-interface-guidelines/color) guidance supports consistent semantic color and verification across appearances; the sample hex values here are not Apple's system color specifications.

## Responsive behavior and accessibility

- Adapt to available width, not a device name. Start near 760 px with 16 px outer padding. For a collection shell, stack the panes and make the sidebar static; for a launcher, wrap the compact navigation and reduce grid columns; for reading, collapse the optional contents rail; for editing, keep the workspace useful and move secondary controls out of its way. Preserve destinations, active state and access scope. Do not introduce a marketing header on small screens.
- Stack content and action groups as needed. Allow long text to wrap; contain necessary wide tables or maps locally instead of making the whole page scroll sideways. Check narrow screens and 200% text/zoom for clipped text or hidden controls.
- Use native semantic links, buttons, form fields, navigation, and main landmarks. Give controls accessible names; keep keyboard order logical and focus visible. For collapsible navigation, expose expanded state, support keyboard dismissal where applicable, and restore focus to the trigger when it closes.
- Aim for comfortable touch targets around 44 × 44 CSS px, with enough separation to prevent accidental taps. A compact visible icon can have a larger hit area. Preserve keyboard and pointer usability as well.
- Meet contrast of at least 4.5:1 for ordinary text, 3:1 for qualifying large text, and 3:1 for meaningful control/state indicators against adjacent colors. Do not rely solely on color to communicate selection or status. Respect reduced-motion preferences and avoid decorative automatic motion.

These usability principles draw on Apple's [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) guidance. Web contrast thresholds follow W3C's [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) criteria; the touch-target recommendation is a Praxis web default, not a conversion of Apple points.

## Content, ownership, and review

Preserve the app's UI language and user-authored content; Praxis interfaces default to Chinese. Keep code, comments, internal errors, and CLI output in English. Write concise labels that explain the user's action. Keep implementation details, debug information, internal paths, and architectural explanations out of product flows unless they help the user make a meaningful decision. Empty and error states should provide useful next steps.

Implement tokens, styles, and components in the owning app. This document is shared guidance, not a central CSS package or runtime dependency. An app must retain its own data, behavior, deployment, and ability to run independently; do not import another app to obtain its appearance.

Before delivery, review desktop and narrow layouts with representative content against the chosen template. For a collection shell, compare the 160 px sidebar, 20 px gap, 32 px padding and brand/first-entry line boxes with Reminder in the same browser. For a launcher, check grid alignment, compact navigation, scoped empty states and the absence of unnecessary panels. For reading or editing, check useful content width and contextual controls. Across templates, verify hierarchy, spacing, keyboard focus, long text, zoom, contrast and every implemented appearance. Follow a restricted view's actual URL and confirm that navigation and content remain within its access scope. Preserve the app's existing content and interactions.

### Knowledge section outlines

When a section has an internal heading outline, opening that section expands its outline inside the left navigation. Selecting the current section title opens that outline; its disclosure control may still collapse it. Derive the outline and anchors from the current body after content edits, including transitions from no headings to headings, while preserving sibling sections in the chapter or part. Do not require content agents to maintain navigation text or hardcode a business document title. Preserve the existing mobile navigation disclosure.
A chapter is a container; its landing section is not the chapter itself. When adding a peer section, store chapter membership through the controlled data layer and reuse the reader, rather than appending the new section body to the landing page or cloning a page implementation. Keep stable section links, sibling navigation and independent document versions.
