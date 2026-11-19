# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis 工作台

[English](README.md) · [快速开始](#快速开始) · [本机运行 Praxis](#本机运行-praxis) · [连接 Praxis](#连接-praxis) · [参与贡献](#参与贡献)

**Praxis 是一个可自托管的平台，你可以通过自己选择的 AI 智能体使用各种应用。** 在任何兼容 MCP 的智能体运行环境中，你都可以让智能体从笔记里找出一段原文，或更新一项任务。它能访问哪些记录、执行哪些操作，都由你决定。无论是个人或家庭使用，还是为团队或组织部署，你都可以用 Praxis 的 14 款内置应用整理知识、管理项目、规划旅行、记录收支。你也可以开发自己的应用并自行托管。

![左侧为真实 Codex 会话的 Paseo 截图，右侧为使用合成示例数据的 Praxis 工作台](docs/images/workbench-zh.png)

## 快速开始

想在自建之前体验 Praxis，可以将下面的提示词复制给你的智能体，连接在线服务。

> 通过 OAuth 连接 https://polaris.jianxiaoyitech.com/mcp，引导我登录并选择允许你访问的范围，然后列出我可用的应用与工具。

使用在线服务需要 Praxis 账号，自助注册计划在后续版本提供。

### 本机运行 Praxis

1. **启动 Praxis。** 安装 Git、Docker Engine 和 Docker Compose v2，然后运行。

   ```sh
   git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
   cd praxis
   docker compose up --build -d --wait
   ```

   Compose 会构建并启动全部 14 款内置应用、工作台、各应用原生服务、身份服务及已授权业务接口。首次启动生成所有者账号、服务密钥和持久应用存储。

2. **获取登录信息。** 读取本次安装生成的初始账号。

   ```sh
   docker compose exec core node scripts/builtin-install.mjs credentials
   ```

3. **打开工作台。** 打开 [Praxis](http://127.0.0.1:4321/) 并登录。浏览器访问和智能体操作均按应用与资源授权。

生成的账号信息请私有保存。`docker compose down` 停止服务并保留数据卷。[运行说明](docs/RUNNING.md) · [内置应用](docs/BUILTINS.md) · [受管部署](docs/MANAGED-DEPLOYMENT.md)

### 连接 Praxis

1. **连接智能体。** 将下面的提示词复制给你的智能体。

   ```text
   连接 http://127.0.0.1:4321/mcp 上的本机 Praxis，引导我登录，并申请读取和创建提醒的权限。
   ```

2. **登录并授权。** 打开登录链接，使用启动 Praxis 时生成的账号登录，确认授予智能体所申请的 Reminder 权限。

3. **开始第一个任务。** 对智能体说。

   ```text
   提醒我明天审阅现场笔记。
   ```

   打开[工作台](http://127.0.0.1:4321/)，进入 **Reminder → 全部**，核对保存的提醒。

你可以在**设置 → 智能体委托**中查看或撤销智能体的访问权限。

## 参与贡献

欢迎为平台及应用作贡献。应用改动提交到所属仓库，再更新 Praxis 中的固定版本。小改动运行定向检查，集成变更运行 `npm test`。

[贡献指南](CONTRIBUTING.md) · [应用标准](docs/APP-STANDARD.md) · [产品需求](docs/PRD.md) · [路线图](docs/ROADMAP.md)

[文档目录](docs/README.md) · [竞品分析](docs/COMPETITIVE-POSITIONING.md) · [标志生成方法](docs/LOGO.md#简体中文) · [Apache 2.0 许可证](LICENSE)
