# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis 工作台

[English](README.md) · [快速开始](#快速开始) · [本机运行 Praxis](#本机运行-praxis) · [连接 Praxis](#连接-praxis) · [参与贡献](#参与贡献)

**Praxis 是一个可自托管的平台。你选择的 AI 智能体，就是你使用应用的入口。** 你告诉它想要的结果，并决定它能访问哪些记录、执行哪些操作。意图、材料和授权就绪后，日常执行的目标是零次必需点击，让实际做事的人能专注。智能体处理例行步骤和检查，你把时间留给需要自己判断的验证。例如，你可以让它用已确认的项目材料更新 Lattice 演示稿并检查渲染效果。你打开的就是可以审阅和演示的文稿。

对团队而言，目标是在保持交付质量和时效的前提下，由同一支团队交付更多工作。员工可以把更多时间用在决定成果能否交付的判断和核验上。[产品需求](docs/PRD.md)

Praxis 打磨内置应用，让人可以直接读、看、听结果，并据此判断。这些应用也展示了如何围绕自己的记录、操作和流程开发新应用。让个人、家庭和组织快速构建、部署自己的应用，是产品方向的一部分。你可以用自己的数据直接构建新应用，按需接入外部服务。目前，你可以独立运行自己的应用，并将它登记到本机工作台。[应用标准](docs/APP-STANDARD.md)

部署前可以试用[在线工作台](https://polaris.jianxiaoyitech.com/)。

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/workbench-zh.png?v=2">
  <img src="docs/images/workbench-zh.gif?v=2" alt="真实 Paseo 对话与 Praxis 工作台：发送提醒后显示对应的合成提醒卡片">
</picture>

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
