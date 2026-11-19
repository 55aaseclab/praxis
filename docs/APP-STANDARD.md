# Praxis app standard / Praxis 应用标准

## English

An app owns its source, typed data and standalone entry. A maintained app has a named owner, PRD, roadmap, version, license, icon, English and Simplified Chinese interface, and documented storage/export and recovery behavior. Release the same function through the same renderer for every authorized record. Preserve content in its author's language. Write English controls, errors, accessibility labels and docs first. Ship their Chinese counterparts with the change. Use the saved `praxis.locale` preference (`en` or `zh`); the initial locale is English.

Managed entry permissions cover the HTML, scripts and app endpoints. Resource grants apply to every business read or write. Handle revoked access, transient failures, empty state, retry and navigation back. Gateway-managed pages receive the shared Home control at the bottom left. Keep controls above the safe area and reserve space for it. Verify an actual workbench → app → Home round trip at desktop and phone widths. Use synthetic data for writes. See the [UI/UX guide](UI-UX.md) and [release runbook](RUNNING.md).

The official registry keeps the English name and description in the default fields and the Chinese pair in `labels.zh`. The local manifest below supplies both languages and is normalized to the same launcher representation.

### Run your own app locally

1. Serve your app separately, for example on `http://127.0.0.1:8000/`. Keep your private data and manifest outside the Praxis repository.
2. Save this JSON array as `~/my-praxis-apps.json`.

```json
[{
  "id": "lab-notes",
  "name": {"en": "Lab notes", "zh": "实验笔记"},
  "description": {"en": "My local notebook", "zh": "我的本地笔记"},
  "url": "http://127.0.0.1:8000/"
}]
```

3. In the Praxis checkout, run `npm ci`, then `npm run apps:dev -- ~/my-praxis-apps.json`. Open `http://127.0.0.1:4180/`. Your entry appears in that local workbench. Stop with Ctrl+C. The local launcher opens a separate loopback origin and grants no production session, data or agent tools.
4. For maintained status, propose the app in an issue with a user task, screenshots in both languages, owner, license, data and permission contract, tests, and rollback. Maintainers review, register the app explicitly and perform the normal Docker release.

## 简体中文

应用独立维护源码、类型化数据和独立入口。受维护应用需有负责人、PRD、路线图、版本、许可证、图标、英中界面及存储、导出和恢复说明。同类功能共用界面，用户内容保留原语言。先更新英文控件、错误、无障碍标签和文档，再在同一变更中同步中文。语言偏好使用 `praxis.locale` 中的 `en` 或 `zh`，首次默认英文。

受管入口对页面、资源和接口执行准入，业务访问另按资源逐次验权。提供撤权、暂时失败、空状态、重试和返回路径。受管页由网关注入左下角小房子，要给按钮和安全区留出空间。用桌面与手机宽度实际从工作台打开应用，再点小房子返回。写操作测试使用合成数据。设计和发布步骤见上方链接。

正式目录在默认名称和描述字段填写英文，`labels.zh` 填写中文。本地清单使用下列双语字段，启动时转换为相同的桌面入口格式。

### 本地开发自己的应用

1. 在独立端口启动自己的应用，例如 `http://127.0.0.1:8000/`。私有数据和清单放在 Praxis 仓库之外。
2. 将上方示例保存为 `~/my-praxis-apps.json`，填写唯一 ID、英中名称和描述以及本机回环地址。
3. 在主仓运行 `npm ci` 和 `npm run apps:dev -- ~/my-praxis-apps.json`，打开 `http://127.0.0.1:4180/`。入口只出现在本地工作台，Ctrl+C 停止。它使用独立来源，且不会获得生产会话、数据或工具权限。
4. 若希望列入维护清单，用 Issue 提交用户任务、双语截图、负责人、许可证、数据与权限合同、测试和回滚说明。维护者评审、显式登记后再按标准流程上线。
