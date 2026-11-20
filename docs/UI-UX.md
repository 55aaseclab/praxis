# Workbench interactions / 工作台交互

## English

The [full design guide](../skills/praxis-operator/references/ui-style-guide.en.md) includes the launcher, collection, reader and editor layouts, keyboard behavior and acceptance examples.

- The workbench lists accessible apps and projects. The bottom bar switches between Apps and For you. Task previews and due-date notices belong to For you. Start both views at the top of the main area, including empty and sparse states. Each app should take the person directly to its main task. Give the main pane to the result and put navigation in the sidebar.
- Distinguish a successful empty collection from loading, lost access and a failed connection. Preserve the selected item and scroll position on a safe retry. When access expires, clear previously displayed protected content.
- Give each control a visible focus state and an accessible name. Reserve space for the workbench Home button at the bottom left, including the device's safe area. Check the complete trip from a tile into an app and back using a keyboard, desktop and a narrow viewport.
- Start with English and add Simplified Chinese in the same change. Test long labels, wrapping and announcements. Keep user-authored content in its original language.

- Preview/copy controls use a pointer cursor and reveal full values on hover or focus, with a touch-accessible equivalent. Use a viewport-bounded overlay and a reserved icon slot for copy feedback, plus a hidden status announcement. Do not add success/error lines that move the surrounding layout. Repeated actions and unchanged refreshes preserve the current preview, focus and scroll.

## 简体中文

[完整设计指南](../skills/praxis-operator/references/ui-style-guide.md)收录了启动台、集合、阅读器与编辑器布局，以及键盘行为和验收示例。

- 首页列出可访问的应用和项目。底部栏切换「应用」和「待关注」，事项预览和到期提示在「待关注」中展示。两个视图始终顶部对齐，内容很少或为空时也遵循同一布局。点开即进入核心任务，主区域展示结果，侧栏提供导航。
- 明确区分空目录、加载中、失去授权和网络错误。安全重试时保留选择和位置，撤权后清除先前显示的私有内容。
- 每个控件都有明确的无障碍名称和焦点状态。为左下角首页按钮和设备安全区留出空间。用键盘、桌面和窄屏走通从首页打开应用再返回的流程。
- 先更新英文，再同步简体中文。检查长标签、换行和状态播报。用户撰写的内容保留原语言。

- 预览/复制控件使用小手光标，悬停、聚焦或触屏均可查看完整内容。预览浮层不超出视口，复制反馈使用预留图标位置及隐藏状态播报，不插入挤动布局的成功/失败行。连续操作和相同数据刷新保留当前预览、焦点与滚动位置。
