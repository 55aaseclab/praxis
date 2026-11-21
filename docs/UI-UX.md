# Workbench interactions / 工作台交互

## English

The [full design guide](../skills/praxis-operator/references/ui-style-guide.en.md) includes the launcher, collection, reader and editor layouts, keyboard behavior and acceptance examples.

- The workbench lists accessible apps and projects. The bottom bar switches between Apps and For you. Task previews and due-date notices belong to For you. Start both views at the top of the main area, including empty and sparse states. Each app should take the person directly to its main task. Give the main pane to the result and put navigation in the sidebar.
- Distinguish a successful empty collection from loading, lost access and a failed connection. Preserve the selected item and scroll position on a safe retry. When access expires, clear previously displayed protected content.
- Give each control a visible focus state and an accessible name. Reserve space for the workbench Home button at the bottom left, including the device's safe area. Check the complete trip from a tile into an app and back using a keyboard, desktop and a narrow viewport.
- Start with English and add Simplified Chinese in the same change. Test long labels, wrapping and announcements. Keep user-authored content in its original language.

- Settings forms and lists align controls to the main pane’s left edge and actions to its right edge, using a shared full-width row with a 12 px gap. Stack only at 390 px and below; keep section notes outside the row with 12 px above and 20 px below. Keep static bottom clearance, but never scroll on select focus or pointerdown to make room for a popup, or use oversized scroll-padding/scroll-margin for that purpose. This stable-opening rule replaces the earlier low-select auto-scroll rule in the linked guide. At 1440/391/390 px, check every select in every management view with pointer and keyboard: record scroll offsets and surrounding control/layout positions before focus, while open and after Escape; all deltas must be zero, including fully visible selects near the viewport bottom. Inspect actual browser-owned menus aligned with their controls, current-value visibility and focus; DOM control geometry alone does not prove popup placement. Use a matching physical/virtual screen size when capturing native menus (the default headless Chromium screen can clip a wide menu), and confirm with a headed browser. See the [control-row rules](../skills/praxis-operator/references/ui-style-guide.en.md#settings-control-rows-and-edge-alignment).

- Preview/copy controls use a pointer cursor and reveal full values on hover or focus, with a touch-accessible equivalent. Use a viewport-bounded overlay and a reserved icon slot for copy feedback, plus a hidden status announcement. Do not add success/error lines that move the surrounding layout. Repeated actions and unchanged refreshes preserve the current preview, focus and scroll.

- Settings → Spaces separates the space overview from app management. Keep the New space form in its existing top position. The overview shows the selected space, members and all installed apps (fourteen built-ins), clearly marking agent-business support. Each app row ends with **Manage**. Its dedicated page fixes the space and app, provides a return to the overview, and contains only this app's enrollment, member resource permissions and grant form. Keep the existing labels, owner boundaries and enable/disable confirmations. Grant-policy apps without business actions explain that enrollment gives current members web entry, with no resource/action grant form; protected or unavailable apps explain why enrollment is unavailable. Polaris retains platform-administrator access; Letters/Profiles retain document-owner access. Returning preserves the selected space. Check Manage/return, enable/disable, member add/remove and app-scoped grant/revoke at 1440/390 px with synthetic data and zero horizontal overflow.

- Management section boundaries have one owner: use a single separator between adjacent sections, none before the first section, and no doubled lines from nested editors or a list's trailing border against the next section. Apply this consistently to every management view. Success feedback uses a separate browser `window.alert` dialog that closes only after user acknowledgment, without a page notice/text row or auto-dismiss timer; the page layout and copy remain unchanged. Remaining error/loading notices use a fixed bottom-right overlay, above Home on phones, outside document flow; they must never insert a layout row. Showing or clearing an error preserves actual content geometry. Errors persist across view changes until addressed, retried or explicitly refreshed. When an operation succeeds but its follow-up read fails, retain the read error and do not show a success alert. During same-view saves, keep existing controls in place until the refreshed result is ready, preserving content height, scroll and focus without an intermediate loading collapse. Verify actual rendered separators, acknowledged browser success alerts without page rows, persistent read/write errors and unchanged geometry/scroll/focus during saves and error appearance/clearance in the browser.

## 简体中文

[完整设计指南](../skills/praxis-operator/references/ui-style-guide.md)收录了启动台、集合、阅读器与编辑器布局，以及键盘行为和验收示例。

- 首页列出可访问的应用和项目。底部栏切换「应用」和「待关注」，事项预览和到期提示在「待关注」中展示。两个视图始终顶部对齐，内容很少或为空时也遵循同一布局。点开即进入核心任务，主区域展示结果，侧栏提供导航。
- 明确区分空目录、加载中、失去授权和网络错误。安全重试时保留选择和位置，撤权后清除先前显示的私有内容。
- 每个控件都有明确的无障碍名称和焦点状态。为左下角首页按钮和设备安全区留出空间。用键盘、桌面和窄屏走通从首页打开应用再返回的流程。
- 先更新英文，再同步简体中文。检查长标签、换行和状态播报。用户撰写的内容保留原语言。

- 设置表单与列表统一两端对齐：控件在主内容区左边缘，动作在右边缘，共用全宽行和 12 px 间距，仅在不超过 390 px 时纵向排列。说明在行外，统一上方 12 px、下方 20 px 间距。保留静态底部空间，但不得在下拉框聚焦或按下时为菜单主动滚动，也不得为此设置过大的 scroll-padding/scroll-margin。本条稳定展开规则替代链接指南中原有的低处下拉框自动上移要求。在 1440/391/390 px 对每个管理视图的每个下拉框检查鼠标与键盘操作：记录聚焦前、展开时及 Escape 关闭后的滚动位置与周围控件／布局位置，差值均须为零，覆盖完全可见且靠近视口底部的下拉框。实际检查与控件对齐的浏览器原生菜单、当前值可见性及焦点；仅凭 DOM 控件几何不能证明菜单位置。截图时让物理／虚拟屏幕尺寸匹配视口（无头 Chromium 的默认屏幕可能截窄菜单），并用有界面浏览器确认。详见[控件行规则](../skills/praxis-operator/references/ui-style-guide.md#设置控件行与两端对齐)。

- 预览/复制控件使用小手光标，悬停、聚焦或触屏均可查看完整内容。预览浮层不超出视口，复制反馈使用预留图标位置及隐藏状态播报，不插入挤动布局的成功/失败行。连续操作和相同数据刷新保留当前预览、焦点与滚动位置。

- 「设置 → 空间」分开空间概览与应用管理。新空间表单保留在原有顶部位置。概览展示选定空间、成员及全部已安装应用（内置十四款），明确标记智能体业务能力；每个应用行右侧为「管理」。独立管理页固定空间和应用，提供返回概览的入口，只包含此应用启用状态、成员资源权限及授权表单。保留既有标签、owner 边界和启用／停用确认方式。使用授权式入口但不支持业务动作的应用说明启用会向当前成员提供网页入口，不提供资源／动作授权表单；受保护或不可用应用解释不能启用的原因。Polaris 保留平台管理员访问，Letters/Profiles 保留文档所有者访问。返回保留选定空间。用合成数据在 1440/390 px 检查管理／返回、启用／停用、添加／移除成员和逐应用授权／撤销，确保无横向溢出。

- 管理区块边界只由一处绘制：相邻区块仅一条分隔线，首区块前不画线；嵌套编辑器、列表尾线与下一区块不得叠出双线。全部管理视图统一遵循。成功反馈使用独立浏览器 `window.alert` 弹窗，由用户确认后关闭，不插入页面通知或文字行，不设置自动消失计时；正文布局和文案不因提示改变。其余错误／加载通知使用右下固定浮层，手机上位于首页按钮上方，脱离文档流，不得插入布局行；错误出现或清除时，实际内容几何位置保持不变。错误跨视图保留，直到处理、重试或明确刷新。操作成功但跟随读取失败时，保留读取错误，不弹成功提示。同一视图保存时，原控件保留到刷新结果就绪，内容高度、滚动与焦点稳定，不出现中间加载塌缩。通过真实浏览器检查渲染分隔线、成功弹窗确认且不插入页面行、持续可见的读写错误，以及保存中和错误出现／清除时几何、滚动与焦点均不变。
