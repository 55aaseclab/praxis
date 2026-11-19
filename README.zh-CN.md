# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis 工作台

[English](README.md) · [本机运行](#本机运行) · [试用 MCP](#试用-mcp)

**Praxis 是一个可自托管的平台，你可以通过自己选择的 AI 智能体使用各种应用。** 在任何兼容 MCP 的智能体运行环境中，你都可以让智能体从笔记里找出一段原文，或更新一项任务。它能访问哪些记录、执行哪些操作，都由你决定。无论是个人或家庭使用，还是为团队或组织部署，你都可以用 Praxis 的 14 款内置应用整理知识、管理项目、规划旅行、记录收支。你也可以开发自己的应用并自行托管。如果想在部署前先体验 Praxis，欢迎访问我们的[在线工作台](https://polaris.jianxiaoyitech.com/)。

![左侧为 Paseo 中的智能体会话，右侧为 Praxis 工作台](docs/images/workbench-zh.png)

*左侧为真实 Codex 会话在 Paseo 中的截图，右侧为实际运行的 Praxis 工作台。演示资料和项目记录使用合成数据。*

## 本机运行

本机运行需要 Linux、Node.js 22.16 或更高版本，以及 npm。

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
npm ci
npm start
```

打开[本机工作台](http://127.0.0.1:4321/)，点开「日历」，再用主页按钮返回。要用临时数据试用依赖后端的应用，可在另一个终端运行 `npm run app:demo -- finance`，打开命令输出的演示工作台地址。受管安装会按账号权限显示入口。[内置应用指南](docs/BUILTINS.md) · [接入本地应用](docs/APP-STANDARD.md#本地开发自己的应用)

## 试用 MCP

可以先体验工具发现，再配置账号。保持工作台运行，在第二个终端进入同一仓库目录并启动网关。

```sh
PORT=4181 PRAXIS_WEB_GATEWAY=true PRAXIS_CANONICAL_URL=http://127.0.0.1:4181 npm run gateway
```

用支持 Streamable HTTP 的 MCP 客户端连接 `http://127.0.0.1:4181/mcp/guide`，试着问 **「这条连接提供了哪些 Praxis 工具？」** 公共指南提供 `praxis_about` 和 `praxis_use_guide`，用于读取产品介绍和使用说明，均不读取业务资料。

<details>
<summary>用 curl 查看工具清单</summary>

```sh
curl -fsS http://127.0.0.1:4181/mcp/guide \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

</details>

在接入 **Knowledge** 的受管环境里，你可以问 **「现场笔记里说，哪些采样点还需要再去一次？」** 获得授权的 agent 可以检索项目文库，回读相关段落，并引用原文位置。你也可以打开出处，亲自核对答案。[Knowledge 工具](skills/knowledge-mcp/SKILL.md) · [受管运行说明](docs/RUNNING.md)

## 开发与接入

- **接入自己的应用。** 为应用提供独立入口、双语名称和清单，开发期间可用本机工作台打开。[应用标准](docs/APP-STANDARD.md)
- **部署工作台。** 构建 Docker 镜像、配置登录，通过只读挂载向 [Letters（书信）](https://github.com/55aaseclab/letters) 和 [Profiles（个人资料）](https://github.com/55aaseclab/profiles) 提供私有文件。[运行说明](docs/RUNNING.md)
- **参与贡献。** 运行 `npm test` 执行合成测试。产品需求和路线图说明了平台负责的工作。[产品需求](docs/PRD.md) · [路线图](docs/ROADMAP.md) · [贡献指南](CONTRIBUTING.md)

[文档目录](docs/README.md) · [竞品分析](docs/COMPETITIVE-POSITIONING.md) · [标志生成方法](docs/LOGO.md#简体中文) · [Apache 2.0 许可证](LICENSE)
