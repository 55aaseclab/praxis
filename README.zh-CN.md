# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis 工作台

[English](README.md) · [快速开始](#快速开始) · [连接 Praxis](#连接-praxis) · [参与贡献](#参与贡献)

**Praxis 是一个可自托管的平台。你选择的 AI 智能体，就是你使用应用的入口。** 你告诉它想要的结果，并决定它能访问哪些记录、执行哪些操作。意图、材料和授权就绪后，日常执行的目标是零次必需点击，让实际做事的人能专注。智能体处理例行步骤和检查，你把时间留给需要自己判断的验证。例如，你可以让它用已确认的项目材料更新 Lattice 演示稿并检查渲染效果。你打开的就是可以审阅和演示的文稿。

对团队而言，目标是在保持交付质量和时效的前提下，由同一支团队交付更多工作。员工可以把更多时间用在决定成果能否交付的判断和核验上。[产品需求](docs/PRD.md)

Praxis 打磨内置应用，让人可以直接读、看、听结果，并据此判断。这些应用也展示了如何围绕自己的记录、操作和流程开发新应用。让个人、家庭和组织快速构建、部署自己的应用，是产品方向的一部分。你可以用自己的数据直接构建新应用，按需接入外部服务。目前，你可以独立运行自己的应用，并将它登记到本机工作台。[应用标准](docs/APP-STANDARD.md)

部署前可以试用[在线工作台](https://polaris.jianxiaoyitech.com/)。

![左侧为真实 Codex 会话的 Paseo 截图，右侧为使用合成示例数据的 Praxis 工作台](docs/images/workbench-zh.png)


## 快速开始

安装 Git、Docker Engine 和 Docker Compose v2。

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
docker compose up --build -d --wait
```

打开[工作台](http://127.0.0.1:4321/)。镜像包含日历与 Matrix 阅读器，可通过主页按钮返回工作台。需要账号和已授权业务操作的安装环境，还需配置身份与应用服务。[运行说明](docs/RUNNING.md) · [内置应用](docs/BUILTINS.md) · [受管部署](docs/MANAGED-DEPLOYMENT.md)

运行 `docker compose down` 停止这套本机工作台。

## 连接 Praxis

在支持 Streamable HTTP MCP 和 OAuth 的智能体客户端中，将 Praxis 添加为远程服务。

```text
https://polaris.jianxiaoyitech.com/mcp
```

在浏览器中登录，选择智能体可以访问的记录及执行的操作。可在**设置 → 智能体委托**中查看或撤销授权。自托管环境配置好身份与应用服务后，使用自己的 Praxis HTTPS 地址并在末尾加上 `/mcp`。

账号有 Knowledge 权限时，你可以问 **「现场笔记里说，哪些采样点还需要再去一次？」** 智能体可以检索获准文库、回读相关段落并引用出处。你可以在 Knowledge 中打开原文核对。[Knowledge 工具](skills/knowledge-mcp/SKILL.md)

<details>
<summary>在本机体验公共连接指南</summary>

在本机工作台之外，启动可选的指南服务。

```sh
docker compose --profile guide up -d --wait
```

将客户端连接到 `http://127.0.0.1:4181/mcp/guide`，也可以用 curl 查看两项公共工具。

```sh
curl -fsS http://127.0.0.1:4181/mcp/guide \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`praxis_about` 和 `praxis_use_guide` 返回公共说明。业务操作需要上文所述的安装配置及用户授权。运行 `docker compose --profile guide down` 停止两个服务。

</details>

## 参与贡献

欢迎为平台及应用作贡献。应用改动提交到所属仓库，再更新 Praxis 中的固定版本。小改动运行定向检查，集成变更运行 `npm test`。

[贡献指南](CONTRIBUTING.md) · [应用标准](docs/APP-STANDARD.md) · [产品需求](docs/PRD.md) · [路线图](docs/ROADMAP.md)

[文档目录](docs/README.md) · [竞品分析](docs/COMPETITIVE-POSITIONING.md) · [标志生成方法](docs/LOGO.md#简体中文) · [Apache 2.0 许可证](LICENSE)
