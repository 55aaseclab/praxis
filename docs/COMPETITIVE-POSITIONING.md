# Competitive positioning / 竞品分析

English · [简体中文](#竞品分析) · 2026-11-19

**Praxis builds the apps behind MCP.** People choose an agent and tell it what they want. Its harness runs the agent. A Praxis app accepts the authorized work, keeps the resulting records, and gives the person something they can read, see or hear. Someone who asks for a transcript review should be able to spend their time listening to the disputed sentence. Finding the file, locating the passage and copying corrections between windows are work the product should absorb.

## Two comparisons

| Question | An agent harness, represented by Codex CLI | An existing app with MCP, represented by Notion | Praxis |
| --- | --- | --- | --- |
| What does the product deliver? | An environment where an agent can inspect a repository, run tools and act on a request. | A workspace for pages and structured content, accessible to people and authorized AI clients. | Domain apps such as Knowledge, Lattice and TingProof. Each owns its records, operations and presentation. |
| Who does the routine work? | The agent follows the user's intent within the harness's tool and permission settings. | A person can edit a page directly, or an authorized assistant can read and update workspace content. | An external agent discovers the available tools and acts within the user's grant. The app validates and saves the change and can return the object and its revision. |
| What does the person receive? | The run can produce a useful file, code change or explanation. How it is presented depends on the task and tools. | The updated page can itself be the finished product, especially for a team already working there. | A result appropriate to the task: a cited passage to read, a deck to watch, or a timed segment to check against the recording. |
| What persists when the user changes agents? | Each harness manages its own session and execution context. | Notion keeps the workspace content for the next authorized client. | The owning app keeps the object, history and source references. A different compatible harness can obtain its own grant and resume from that state. |

Codex CLI is a **complement** to Praxis. Its choices about model, planning, tools and execution belong in the harness. Praxis should invest in the quality of what every compatible harness can do with the apps. Compatibility is demonstrated per client through discovery, authorization, execution and readback. [Codex CLI](https://developers.openai.com/codex/cli/) · [MCP host, client and server roles](https://modelcontextprotocol.io/docs/learn/architecture)

Notion is a **direct alternative** when the desired outcome is a shared page. Its official MCP integration already lets an authorized assistant read and update accessible workspace content. Offering MCP or promising fewer clicks is therefore insufficient differentiation. Praxis has a stronger case when the user needs a domain-specific result whose meaning must survive the handoff, such as a correction bound to a particular subtitle segment and revision. [Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp) · [TingProof assignment contract](../skills/mcp-tingproof/SKILL.md)

## What “agent-native” means for the person

**Reading.** Consider “How does this hiring packet say we should set starting pay?” A conventional manual workflow is to unpack the files, search several documents and copy the relevant clauses. In Praxis, after the packet is imported and indexed, an authorized agent can find candidate passages and reread their context. The harness writes the answer; Knowledge supplies the file and passage location. The person reads the conclusion and can inspect the exact clause, particularly if one source is an example and another is approved policy. [Knowledge evidence contract](../skills/knowledge-mcp/SKILL.md) · [Knowledge agent skill](../skills/knowledge-mcp/SKILL.md)

**Watching.** Consider “Prepare the approved project update for the meeting.” With the required deck permissions, the agent can use Lattice to update the slides and inspect the rendered result. The audience sees the presentation. Asking the presenter to copy the agent’s outline into slide boxes would leave the most repetitive part of the job with the person. [Lattice authoring contract](../skills/mcp-slides/SKILL.md)

**Listening.** For “Prepare the corrections to this interview for review,” a harness can coordinate the work, and a shared page can hold a list of suggested edits. TingProof can also bind a submitted correction to an assigned segment and check its revision. In the native editor, a reviewer with the recording linked can listen at the relevant timestamp and compare it with the text. Assignment access covers the granted segments; listening requires separate access to the recording. The valuable human action is deciding what the speaker said. [TingProof listening experience](../skills/mcp-tingproof/SKILL.md) · [Correction and readback](../skills/mcp-tingproof/SKILL.md)

**Design target.** Once intent, source material and authorization are in place, routine execution should require zero mandatory UI clicks. The result should reach the person's reading, viewing or listening surface. Consent, a material ambiguity or a consequential decision can still call for their attention. Voluntary playback, inspecting evidence and manual correction remain useful choices. Today's source-linked readers, timed editor and authorized attention cards are building blocks; automatic delivery across all apps and harnesses is a target. [Current product contract](PRD.en.md)

## How to test the distinction

For the same task and source material, compare manual app use, an existing app with its connector, and a compatible harness using Praxis. Record setup and consent separately. Count mandatory interventions between delegation and the first usable result, measure time to that result, and verify that references open the correct passage or timestamp. Repeat with a second independently authorized harness and check that it can read the same saved object and revision. A low click count is only meaningful if the result is correct and the person can verify it. These are proposed comparison criteria; no comparative benchmark is claimed here.

# 竞品分析

**Praxis 做的是 MCP 背后的应用。** 用户选择自己习惯的 agent，告诉它想得到什么。Harness 负责运行 agent；Praxis 应用接住授权范围内的工作，保存结果，让人直接阅读、观看或收听。用户要复核一段访谈，值得他花时间的是听清那句有争议的话。找文件、定位段落、在几个窗口之间搬运修改意见，应尽量由产品承担。

## 两类对照

| 比较问题 | Agent harness，以 Codex CLI 为例 | 已有应用接入 MCP，以 Notion 为例 | Praxis |
| --- | --- | --- | --- |
| 交付什么产品？ | 提供 agent 的运行环境，使它能检查代码仓、调用工具并执行请求。 | 提供以页面和结构化内容为中心的工作区，人和获授权的 AI 客户端都能访问。 | 提供 Knowledge、Lattice、TingProof 等业务应用。每个应用负责自己的记录、操作规则和呈现方式。 |
| 谁承担日常操作？ | Agent 根据用户意图，在 harness 提供的工具和权限边界内执行。 | 人可以自己编辑页面，也可以委托助手读取、更新工作区内容。 | 外部 agent 发现可用工具，按用户委托执行。应用校验并保存变更，可返回具体对象及版本。 |
| 用户最终得到什么？ | 一次运行可以交付文件、代码改动或解释；呈现方式取决于任务和所用工具。 | 更新好的共享页面本身就能完成交付，尤其适合原本就在该页面协作的团队。 | 结果按任务呈现：需要依据时读原文，需要汇报时看演示，需要辨认语音时听相应片段。 |
| 用户换一个 agent 后留下什么？ | 各 harness 管理自己的会话与执行上下文。 | 页面仍保存在 Notion，另一个获授权的客户端可以继续使用。 | 业务对象、版本和来源留在所属应用。另一个兼容的 harness 独立获得授权后，可以从同一份结果继续工作。 |

**与 harness 的关系是互补。** Codex CLI 负责模型选择、工具执行和会话。Praxis 的投入重点是让不同 harness 都能可靠地操作同一批应用。每种客户端的兼容性，都要用工具发现、授权、执行和回读分别验证。[Codex CLI 官方说明](https://developers.openai.com/codex/cli/) · [MCP 关于主机、客户端与服务器的定义](https://modelcontextprotocol.io/docs/learn/architecture)

**与已有应用的竞争发生在最终交付上。** 如果团队只需要一份共享页面，Notion 加一个获授权的助手就能满足需求。Notion 的 MCP 已支持读取和更新用户可访问的内容。Praxis 更值得选择的情形，是结果还要保留具体的业务含义，例如一条字幕修改必须对应某个片段和版本，复核者还能回到原声判断。[Notion MCP 官方说明](https://developers.notion.com/guides/mcp/get-started-with-mcp) · [TingProof 任务合同](../skills/mcp-tingproof/SKILL.md)

## Agent-native 体现在用户的哪一步

**读。** 用户问「这份招聘资料里，入职薪资应该怎么定？」手工做要解压资料包、逐份搜索，再摘录条款。资料入库并建立索引后，获授权的 agent 可以查找候选段落并回读上下文。外部 harness 组织答案，Knowledge 提供原文件和段落位置。用户可以直接读结论；遇到薪酬模板和正式制度说法不同，也能回到具体条款核对。[Knowledge 证据检索合同](../skills/knowledge-mcp/SKILL.md) · [Knowledge 操作技能](../skills/knowledge-mcp/SKILL.md)

**看。** 用户说「把已经确认的项目进展整理成开会用的演示稿」。拿到相应文稿权限后，agent 可以通过 Lattice 更新幻灯片并检查渲染结果。参会者看到的是可以演示的文稿。如果主讲人还要把聊天里的大纲逐条复制进幻灯片，这项委托就没有交付到位。[Lattice 制作合同](../skills/mcp-slides/SKILL.md)

**听。** 用户说「把这段访谈的字幕校正准备好，交给我复核」。Harness 可以安排任务，共享文档也能列出修改建议。TingProof 把提交的修改绑定到获分配的字幕片段，并核对版本。有原始录音权限、且已在原生编辑器关联音频的复核者，可以在对应时间点听原声、对照文本。用户的判断是「说话人究竟说了什么」。分配字幕任务与获得原始音频权限分别处理。[TingProof 听校体验](../skills/mcp-tingproof/SKILL.md) · [校正提交与回读](../skills/mcp-tingproof/SKILL.md)

**设计目标。** 用户表达意图、提供材料并完成授权后，日常执行应当做到 **零次必需点击**，结果直接出现在适合读、看或听的界面。授权、关键歧义和重要取舍仍应交给本人；播放、查证、手动纠正都是用户可以主动选择的动作。现有的来源定位、分段听校和按权限呈现的关注卡片已经提供了基础。覆盖所有应用和 harness 的自动送达仍是目标。[现行产品需求](PRD.md)

## 怎么判断差异是否成立

拿同一批材料、同一个任务，对照三条路径：人手工操作应用、agent 通过连接器操作已有应用、agent 通过 Praxis 完成任务。单独记录首次设置与授权；从委托开始，数一数结果可用前人还必须介入几次、要等多久，再检查来源能否定位到正确段落或时间点。最后换一个独立获授权的 harness，核对它能否读回同一条记录和版本。只有结果正确、用户能核验，少点击才有价值。这些是建议的验收口径，尚无横向实测数据。
