# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis 工作台

[English](README.md) · [快速开始](#快速开始) · [连接 Praxis](#连接-praxis) · [参与贡献](#参与贡献)

**Praxis 是一个可自托管的平台，你可以通过自己选择的 AI 智能体使用各种应用。** 在任何兼容 MCP 的智能体运行环境中，你都可以让智能体从笔记里找出一段原文，或更新一项任务。它能访问哪些记录、执行哪些操作，都由你决定。无论是个人或家庭使用，还是为团队或组织部署，你都可以用 Praxis 的 14 款内置应用整理知识、管理项目、规划旅行、记录收支。你也可以开发自己的应用并自行托管。

![左侧为真实 Codex 会话的 Paseo 截图，右侧为使用合成示例数据的 Praxis 工作台](docs/images/workbench-zh.png)

## 快速开始

想在自建之前体验 Praxis，可以将下面的提示词复制给你的智能体，连接在线服务。

> 通过 OAuth 连接 https://polaris.jianxiaoyitech.com/mcp，引导我登录并选择允许你访问的范围，然后列出我可用的应用与工具。

使用在线服务需要 Praxis 账号，自助注册计划在后续版本提供。

### 本机运行 Praxis

安装 Git、Docker Engine 和 Docker Compose v2。

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
docker compose up --build -d --wait
```

Compose 会构建并启动全部 14 款内置应用、工作台、各应用原生服务、身份服务及已授权业务接口。首次启动生成所有者账号、服务密钥和持久应用存储。

读取本次安装的初始登录信息：

```sh
docker compose exec business node scripts/builtin-install.mjs credentials
```

打开 [Praxis](http://127.0.0.1:4321/) 并登录。浏览器访问和智能体操作均按应用与资源授权，生成的账号信息请私有保存。`docker compose down` 停止服务并保留数据卷。[运行说明](docs/RUNNING.md) · [内置应用](docs/BUILTINS.md) · [受管部署](docs/MANAGED-DEPLOYMENT.md)

### 连接 Praxis

在支持 Streamable HTTP MCP 和 OAuth 的智能体客户端中，将本机 Praxis 添加为远程服务。

```text
http://127.0.0.1:4321/mcp
```

使用本机安装生成的账号，在浏览器中登录，选择智能体可以访问的记录及执行的操作。可在**设置 → 智能体委托**中查看或撤销授权。

将现场笔记导入 Knowledge 后，你可以问 **「现场笔记里说，哪些采样点还需要再去一次？」** 智能体可以检索获准文库、回读相关段落并引用出处。你可以在 Knowledge 中打开原文核对。[Knowledge 工具](skills/knowledge-mcp/SKILL.md)

<details>
<summary>阅读公共连接指南</summary>

同一套安装在 `http://127.0.0.1:4321/mcp/guide` 提供公共指南。使用 curl 查看两项说明工具：

```sh
curl -fsS http://127.0.0.1:4321/mcp/guide \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`praxis_about` 和 `praxis_use_guide` 返回公共说明。通过 `/mcp` 登录并委托权限后，可操作自己的应用记录。

</details>

## 参与贡献

欢迎为平台及应用作贡献。应用改动提交到所属仓库，再更新 Praxis 中的固定版本。小改动运行定向检查，集成变更运行 `npm test`。

[贡献指南](CONTRIBUTING.md) · [应用标准](docs/APP-STANDARD.md) · [产品需求](docs/PRD.md) · [路线图](docs/ROADMAP.md)

[文档目录](docs/README.md) · [竞品分析](docs/COMPETITIVE-POSITIONING.md) · [标志生成方法](docs/LOGO.md#简体中文) · [Apache 2.0 许可证](LICENSE)
