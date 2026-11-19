---
name: mcp-control
description: Inspect the tools, skills and user permissions available on the current Praxis MCP connection. 核对当前 Praxis MCP 连接的工具、skill 和授权能力，避免把界面入口或旧工具缓存当成实际能力。
---

# Check Praxis MCP capabilities

English · [简体中文](#praxis-mcp-能力核对)

Use `praxis_refresh_capabilities` to read this connection’s service version, negotiated instructions, authorized tool schemas and companion skills. It reads capability metadata only. It does not widen grants, reconnect the transport or update an external agent’s tool cache.

Check `tools/list` and the actual input schema before committing to an action. Read the skill associated with the selected tool. Resource-capable clients can discover the fixed skill URI with `resources/list` and read it with `resources/read`. Tool-only clients can read the same instructions from the refresh result’s `skills[].content`.

A discovered tool remains subject to space, resource and action checks on every call. If the client’s cache omits a tool, report that limitation. Never invent a tool, report a call you did not make or modify the client’s startup/configuration/cache to get around a missing capability. Stop on authentication failure and report the need to restore the connection; do not guess credentials or switch business identity.

# Praxis MCP 能力核对

`praxis_refresh_capabilities`读取当前服务版本、协商说明、已授权工具 schema 及配套 skill。它不读取业务正文，不扩大权限，不重连客户端，也不更新外部 harness 的工具缓存。

先按实际`tools/list`和 schema 判断能否执行用户请求，再读取该工具关联的 skill。支持资源的客户端可使用`resources/list`和`resources/read`读取固定 skill URI；只有工具调用能力的客户端可从本工具返回的`skills[].content`获取相同说明。

工具存在只说明当前连接有该类能力，每次业务调用还要检查空间、资源及动作。客户端缓存没有暴露工具时如实说明，不能假称已经调用、制造工具名，或改启动、缓存、配置来绕过。认证失败停止请求并报告需要恢复连接，不能反复猜测凭据或换业务身份。
