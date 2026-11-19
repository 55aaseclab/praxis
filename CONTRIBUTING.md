# Contributing to Praxis

## English

Start with the person affected and the outcome they need. For a defect, include the release, how to reproduce it with synthetic data, the expected result and what happened. For an idea, describe the task, a concrete example, and how someone could tell the improvement worked. Either working language is welcome. During triage, add a short summary in the other language and identify the owning app or platform component.

Use an issue for discussion when a proposal changes a workflow, interface or permission boundary. A small, well-defined fix can go straight to a pull request. Link the issue if one exists. Submit app changes to the owning repository and update its pinned commit in the platform after it is available. Local-only apps can remain on their developer's machine.

In the pull request, show one example of the behavior and the focused check you ran. For navigation, verify the trip from the workbench into the app and back on desktop and at phone width. Use synthetic fixtures for screenshots and examples. Keep private records, session tokens and deployment configuration out of issue bodies, screenshots and patches.

Update the English source first, then its Simplified Chinese counterpart in the same pull request. Preserve quoted material and people's own content in the language in which it was written. Reviewers should resolve behavior and authorization concerns first and identify the exact passage when a translation needs correction.

Keep the [product requirements](docs/PRD.en.md), [roadmap](docs/ROADMAP.en.md) and [app standard](docs/APP-STANDARD.md) current. Run `npm test` before submitting. Contributions are offered under the [Apache 2.0 license](LICENSE). See the [code of conduct](CODE_OF_CONDUCT.md).

## 简体中文

先说明受影响的人和希望获得的结果。缺陷报告请包含版本、合成数据复现步骤、预期和实际现象。功能建议请说明任务、一个具体例子，以及可以观察到的成功条件。议题可以用任一工作语言发起，分流时补上另一种语言的简短摘要，并确认归属的平台组件或应用。

涉及流程、界面或权限边界的方案，先在议题中讨论。范围清楚的小修复可以直接提 PR，有相关议题时请关联。应用改动提交到所属仓库，确认提交可获取后，再更新平台的子模块指针。个人开发的本地应用可以保留在开发者机器上。

PR 中给出一个实际行为例子和对应检查。修改导航时，应在桌面和手机宽度验证从工作台进入应用再返回的路径。截图和样例使用合成数据，议题、补丁和截图中请移除私人记录、会话令牌和部署配置。

先更新英文，再在同一个 PR 中更新简体中文对照。引用和用户原创内容保留原文。评审先解决行为和权限问题，翻译有偏差时请指出具体段落。

平台改动先更新[需求文档](docs/PRD.md)、[路线图](docs/ROADMAP.md)和[应用标准](docs/APP-STANDARD.md)。提交前运行 `npm test`。贡献采用 [Apache 2.0 许可证](LICENSE)。请遵循[行为准则](CODE_OF_CONDUCT.md)。
