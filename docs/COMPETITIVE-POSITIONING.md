# Competitive positioning / 竞品分析

English · [简体中文](#竞品分析) · 2026-11-19

**Praxis is a platform for apps designed around work delegated to an agent.** A person chooses an agent and tells it what outcome they want. The agent carries out routine work within the person's grant. Each app defines its business objects, validates the operations an agent can perform, and preserves results in a form people can read, watch or listen to.

**Design target.** Once intent, source material and authorization are in place, routine execution should require zero mandatory UI clicks. Results should reach a surface suited to the work. Consent, material ambiguities and consequential decisions can still call for a person's attention. Playing the audio, checking evidence and making a manual correction remain choices. Source-linked readers, timed review and authorized attention cards are available in specific workflows today. Automatic delivery across apps and harnesses remains a goal. [Product requirements](PRD.en.md)

The built-in apps are useful products in their own right. They show what a carefully designed result feels like and provide reference implementations for people and organizations building apps around their own work. Praxis aims to shorten that path with AI-assisted development, a common app contract and repeatable deployment. A new app can start with the organization's own records and rules, independent of any existing SaaS integration or migration. Current documentation covers local registration and explicitly configured managed deployment. [App standard](APP-STANDARD.md) · [Managed deployment](MANAGED-DEPLOYMENT.md)

## What the person gets

**Read.** Ask, “How does this hiring packet say we should set starting pay?” Once the packet is imported and indexed, an authorized agent can find the relevant passages and check their context. Knowledge supplies the source file and passage location. The agent returns a conclusion that the person can verify against the exact clause, such as when an example differs from approved policy. [Knowledge requirements](../third_party/knowledge/docs/PRD.en.md) · [Knowledge agent skill](../skills/knowledge-mcp/SKILL.md)

**Watch.** Ask, “Prepare the approved project update for the meeting.” With the required deck permissions, an agent can update the Lattice slides and inspect the rendered result. The presenter opens the finished deck for the meeting. [Lattice authoring contract](../skills/mcp-slides/SKILL.md)

**Listen.** Ask, “Prepare the corrections to this interview for review.” TingProof binds each submitted correction to its assigned segment and checks the revision. A reviewer with separate access to the recording, linked in the native editor, can play the relevant timestamp and compare the spoken words with the proposed text. [TingProof listening experience](../third_party/tingproof/docs/PRD.en.md) · [Correction and readback](../skills/mcp-tingproof/SKILL.md)

## How the approaches compare

| Approach | What shapes the app | What the person receives |
| --- | --- | --- |
| Manually operated app | Screens and controls organize the steps a person performs to complete work. | The result of work they carry out through the interface. |
| Existing app with an agent connector | An agent operates on the records and actions exposed by the existing app. | The result in the existing workspace, such as an updated shared page. |
| Praxis app designed for delegation | The app models its business records and exposes authorized operations for the agent. Its human interface is designed for reviewing and using results. | A result presented for the task, with source or version information where it matters. The owning app keeps the record available to other independently authorized clients. |

A shared page may be all a team needs. Notion's MCP integration lets an authorized assistant read and update content that the user can access in the selected workspace. [Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp)

Agent harnesses such as Codex CLI complement Praxis. The harness runs the agent and handles tool calls. The app validates operations and owns the resulting state and presentation. Verify compatibility with each client through discovery, authorization, execution and readback. [Codex CLI](https://developers.openai.com/codex/cli/) · [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)

## How to test the distinction

**Using an app.** Compare the approaches on the same task and source material. Record setup and consent separately. After delegation, count required interventions, categorize any that called for human judgment, measure the time to a usable result, and check that references resolve to the right passage or timestamp. Give a second compatible client its own grant and verify that it can read back the same record and revision.

**Building an app.** Ask independent developers to use the app standard to build and deploy apps for different kinds of work. Verify that a separately authorized business agent can discover the tools, obtain the intended grant, execute a routine task and read back the committed result. Check that a person can use the result in the app's intended view. Measure the time and effort to build and deploy each app, then repeat the upgrade and recovery steps to check their cost and repeatability. These are proposed tests for the platform. [App standard](APP-STANDARD.md) · [Verification plan](VERIFICATION.en.md)

# 竞品分析

**Praxis 是一个应用平台，应用围绕用户委托给智能体的工作来设计。** 用户选择自己习惯的智能体，告诉它想得到什么结果。智能体在授权范围内承担日常操作。每个应用定义自己的业务对象和可委托的操作，校验执行请求，并保存结果，让人可以直接读、看或听。

**设计目标。** 用户表达意图、提供材料并完成授权后，日常执行应做到**零次必需点击**，结果应送达适合这项工作的界面。授权、关键歧义和重要决策仍可以交给本人。播放、查证和手动修正都是用户可以主动选择的操作。现有部分流程已提供原文定位、分段听校和按权限显示的关注卡片。跨应用和智能体运行环境的自动送达仍是目标。[产品需求](PRD.md)

内置应用本身就能解决实际问题，也展示面向人的结果界面该怎样打磨，供个人和组织按自己的工作方式开发应用时参考。Praxis 希望借助 AI 辅助开发、统一的应用契约和可重复的部署流程，缩短从开发到使用的时间。新应用可以直接从组织自己的业务记录和规则出发，存量 SaaS 的接入和迁移都可以按需选择。现有文档已说明本地登记和显式配置的受管部署流程。[应用标准](APP-STANDARD.md) · [受管部署](MANAGED-DEPLOYMENT.md)

## 用户得到什么

**读。** 用户问「这份招聘资料里，入职薪资应该怎么定？」资料入库并建立索引后，获授权的智能体可以查找相关段落并回读上下文。Knowledge 提供原文件与段落位置。智能体给出结论，用户可以回到具体条款查证，例如确认一段话究竟是示例还是正式制度。[Knowledge 需求](../third_party/knowledge/docs/PRD.md) · [Knowledge 操作技能](../skills/knowledge-mcp/SKILL.md)

**看。** 用户说「把已经确认的项目进展整理成开会用的演示稿」。拿到相应文稿权限后，智能体可以更新 Lattice 幻灯片并检查渲染结果。主讲人可以直接打开完成的演示稿开会。[Lattice 制作合同](../skills/mcp-slides/SKILL.md)

**听。** 用户说「把这段访谈的字幕校正准备好，交给我复核」。TingProof 将提交的校正绑定到获分配的字幕片段，并核对版本。复核者另行获得录音访问权限并在原生编辑器中关联录音后，就能播放对应时间点的原声，与拟修正的文本对照。[TingProof 听校体验](../third_party/tingproof/docs/听校_PRD_V1.0.0.md) · [校正提交与回读](../skills/mcp-tingproof/SKILL.md)

## 不同应用形态如何交付结果

| 方式 | 应用围绕什么设计 | 用户得到什么 |
| --- | --- | --- |
| 人工操作应用 | 页面和控件组织用户完成工作所需的各个步骤。 | 用户通过界面亲手完成的结果。 |
| 已有应用接入智能体 | 智能体使用已有应用开放的记录和操作。 | 现有工作区内的结果，例如更新后的共享页面。 |
| 围绕委托设计的 Praxis 应用 | 应用定义业务记录，向智能体提供可授权的操作，围绕查看和使用结果设计人的界面。 | 按任务呈现的结果，需要时附上来源或版本。所属应用保存记录，其他独立获授权的客户端也可以读取。 |

只需要共享页面的团队可以用 Notion。通过其 MCP 集成，获授权的助手可以读取和更新用户在所选工作区内可访问的内容。[Notion MCP 官方说明](https://developers.notion.com/guides/mcp/get-started-with-mcp)

Codex CLI 等智能体运行环境与 Praxis 互补。运行环境负责执行智能体并调用工具，应用负责校验操作、保存业务状态和呈现结果。每种客户端都分别验证工具发现、授权、执行和回读。[Codex CLI 官方说明](https://developers.openai.com/codex/cli/) · [MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)

## 怎么验证

**使用应用。** 用同一批材料和同一项任务对照上面几种方式，单独记录初次设置和授权。从委托开始，记录结果可用前人必须介入的次数、其中哪些需要人的判断，以及等到可用结果的时间。核对引用能否定位到正确段落或时间点。再给另一个兼容客户端独立授权，验证它能否回读同一条记录和版本。

**开发应用。** 请独立开发者按应用标准构建并部署不同用途的应用。验证业务智能体能发现工具、取得指定授权、完成一项日常操作并回读已保存的结果。确认用户能在应用为这项工作设计的界面中直接使用结果。记录开发和部署的时间与投入，再重复升级和恢复步骤，观察实际成本及过程能否复现。这些是待验证的平台目标。[应用标准](APP-STANDARD.md) · [验证方案](VERIFICATION.md)
