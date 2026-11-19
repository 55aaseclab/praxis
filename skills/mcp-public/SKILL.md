---
name: mcp-public
description: Use the public Praxis MCP to introduce the product and explain authorized connections and user-confirmed shortcuts. 使用 Praxis 无认证公共 MCP 介绍产品、说明安全接入与保存工作台快捷方式；不执行业务操作。
---

# Public Praxis guidance

English · [简体中文](#praxis-公共接入指南)

| Tool | When and how to use it |
| --- | --- |
| `praxis_about` | Explain how people, external agents, business data and the workbench relate. Provide the official workbench URL. Agents run outside Praxis. |
| `praxis_use_guide` | Choose the user’s known platform (`ios_safari`, `android_chrome`, `desktop` or `other`). Explain actual sign-in, delegation and shortcut steps. Choose `other` when the device is unknown. |

The public tools default to English. Clients that support setting HTTP headers can request Simplified Chinese with `Accept-Language: zh-CN`. The tool argument schema stays the same.

After connecting, introduce the workflow briefly and help the user save a desktop or home-screen shortcut if they want one. The user confirms shortcut creation in their browser. Report installation only when the user has actually completed it.

This endpoint returns fixed public guidance. It has no access to accounts, spaces, permission records or business content. For business operations, direct the user to sign in to the official workbench and authorize the separate protected MCP through OAuth. Reading this guide grants no account access and proves no phone-client integration. Keep passwords, tokens and secret configuration out of chat.

# Praxis 公共接入指南

| 工具 | 选择与操作 |
|---|---|
| `praxis_about` | 向首次接入者解释人、外部 agent、业务数据和工作台的关系，并给出正式工作台地址。Praxis 内部没有 agent。 |
| `praxis_use_guide` | 按已知设备选择 iOS Safari、Android Chrome、desktop 或 other；说明登录、用户授权及保存到桌面的真实步骤。未知设备不猜测。 |

公共工具默认返回英语。可设置请求头的客户端可通过 `Accept-Language: zh-CN` 获取简体中文，工具参数相同。

连接后简短介绍如何使用，再引导用户按自己的需要保存桌面／主屏幕入口。快捷方式由用户在浏览器确认，不能声称已自动安装。

公共端点只返回固定指南，不读账号、空间、权限或业务记录。需要业务操作时引导用户在正式工作台登录，再向独立受保护 MCP 完成 OAuth 委托；公开指南不是登录、账号授权或手机第三方 App 已接通的证明。不要索取聊天中的密码、token或秘密配置。
