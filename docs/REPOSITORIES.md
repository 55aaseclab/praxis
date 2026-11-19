# Source repositories and publication / 源码仓库与发布

## English

Each built-in app is developed and published from `main` in its own public repository. The repository default branch and the branch recorded in `.gitmodules` are both `main`. Administrators and maintainers can push verified changes directly within their assigned scope; external contributions use the [contribution workflow](../CONTRIBUTING.md). Publish the app commit first, then pin its exact SHA in Praxis and verify the combination.

The 2026-11-19 source audit checked two things for each component: whether its repository was readable anonymously and whether an unauthenticated client could retrieve the exact commit recorded by the platform. Nine repositories were provisioned under the public organization that day. Two held the Letters and Profiles readers. The seven new destinations for Finance, Intelligence, Knowledge, Projects, Travel, Calendar and Matrix Reader started empty; Reminder already had an empty public repository. Others had public default branches but lacked the intended application revision. Letters and Profiles were the first two published reader sources. The platform subsequently published and verified all fourteen built-in app pins from a fresh clone.

The platform records each source URL in [.gitmodules](../.gitmodules) and its revision as a Git tree entry with mode `160000`. A branch name in the table identifies the release source; the gitlink selects the exact build. Compare a submodule checkout’s HEAD with the parent gitlink before changing a pin. An independently maintained app can use `origin` and its tracking branch. A fork can also configure an `upstream` remote to track its source project.

The 2026-11-19 main-branch cutover moved the reviewed Memo, TingProof and Lattice release histories to `main`. Recoverable private bundles retain the preceding histories. The reviewed Polaris repository now uses the canonical `polaris` name, and its preceding source repository is frozen as `polaris-archive-20261119`. The currently published Polaris application remains a read-only observation viewer. [Polaris viewer](POLARIS-VIEWER.md)

## 简体中文

每个内置应用都在自己的公开仓库中，从 `main` 开发和发布。仓库默认分支及 `.gitmodules` 中登记的分支均为 `main`。管理员和 maintainer 可在负责范围直接推送已验证的改动；外部贡献遵循[贡献流程](../CONTRIBUTING.md#简体中文)。先发布应用提交，再在 Praxis 固定其具体 SHA 并验证组合。

2026-11-19 的源码核查分别验证仓库能否匿名读取，以及匿名客户端能否获取平台登记的具体提交。当天在公开组织下新建九个仓库，其中两个保存 Letters 和 Profiles 阅读器。Finance、Intelligence、Knowledge、Projects、Travel、Calendar 和 Matrix Reader 的七个新仓当时为空仓；Reminder 此前已有公开空仓。另一些仓库虽然默认分支公开，却缺少待分发的应用版本。Letters 和 Profiles 是最先发布的两个阅读器。之后平台完成了全部十四个内置应用的固定版本发布，并通过全新克隆验收。

[.gitmodules](../.gitmodules) 记录各源码地址，主仓 Git 树以模式 `160000` 记录相应提交。表中的分支表示当次发布来源，构建采用主仓的 gitlink。更新指针前，应将应用检出的 HEAD 与父仓记录比对。独立维护的仓库通常使用 `origin` 和跟踪分支；派生仓库还可用 `upstream` 跟踪来源项目。

2026-11-19 的主线切换将 Memo、TingProof、Lattice 已审核的发行历史移至 `main`，此前历史保存在可恢复的私有 bundle 中。已审核的 Polaris 仓库统一使用正式名称 `polaris`，此前源码仓冻结为 `polaris-archive-20261119`。当前发布的 Polaris 应用仍为只读观察查看器。[Polaris 查看器](POLARIS-VIEWER.md)

| App / 应用 | Public source / 公开仓库 | Publication branch / 发布分支 |
| --- | --- | --- |
| Reminder | [reminder](https://github.com/55aaseclab/reminder) | `main` |
| Knowledge | [knowledge](https://github.com/55aaseclab/knowledge) | `main` |
| Lattice Slides | [lattice](https://github.com/55aaseclab/lattice) | `main` |
| Travel | [travel](https://github.com/55aaseclab/travel) | `main` |
| TingProof | [tingproof](https://github.com/55aaseclab/tingproof) | `main` |
| Memo | [memo](https://github.com/55aaseclab/memo) | `main` |
| Finance | [finance](https://github.com/55aaseclab/finance) | `main` |
| Intelligence | [intelligence](https://github.com/55aaseclab/intelligence) | `main` |
| Polaris | [polaris](https://github.com/55aaseclab/polaris) | `main` |
| Letters | [letters](https://github.com/55aaseclab/letters) | `main` |
| Profiles | [profiles](https://github.com/55aaseclab/profiles) | `main` |
| Projects | [projects](https://github.com/55aaseclab/projects) | `main` |
| Calendar | [calendar](https://github.com/55aaseclab/calendar) | `main` |
| Matrix Reader | [matrix-reader](https://github.com/55aaseclab/matrix-reader) | `main` |

### Publishing a cloneable release

1. Select platform code, redistributable documentation and synthetic fixtures. Review the selected commit and its reachable history. Keep operator files, private documents, credentials, live records and non-distributable assets in private storage.
2. Check the distribution rights for each selected component, asset and fixture with its owner. The platform grants Apache 2.0 for its original software and documentation. Each app retains its own terms; some have no app-level license declaration. [Platform license](../LICENSE) · [App guide](BUILTINS.md)
3. Publish reviewed app commits to `main` before updating the parent gitlinks. Confirm that the repository default branch and configured release branch are both `main`. Check the URL and SHA from a clean environment without an operator’s Git credentials. Run the quick start, then test the workbench → app → Home path with synthetic data.
4. Check the reporting contact, issue tracker and private vulnerability reporting channel with the maintainers. Provide a public project overview and link it to the published platform source. [Contribution and reporting guidance](../CONTRIBUTING.md)
5. For a public website, the site owner verifies the domain with the chosen search provider, submits the sitemap and checks the English and Chinese overview pages. Record submission and indexing as separate observations.

### 发布可克隆的版本

1. 选择要发布的平台代码、可分发文档与合成样例，检查选定提交及其可达历史。运维文件、私人文档、凭据、真实业务记录及不能对外分发的素材保存在私有存储中。
2. 与权利人核实各组件、素材及样例的分发许可。平台原创软件和文档使用 Apache 2.0；各应用保留自己的条款，部分仓库没有声明应用级许可证。[平台许可证](../LICENSE) · [内置应用说明](BUILTINS.md)
3. 先将经审核的应用提交发布到 `main`，再更新父仓 gitlink；核对仓库默认分支及配置的发行分支均为 `main`。在没有运维 Git 凭据的干净环境中核对源码地址与 SHA，运行快速开始步骤，并用合成数据走通工作台 → 应用 → 首页。
4. 和维护者核对反馈联系人、议题入口及私密漏洞报告渠道。为项目提供公开介绍页，并指向已发布的平台源码。[贡献与反馈指南](../CONTRIBUTING.md)
5. 对于公开站点，由站点所有者在选用的搜索平台验证域名、提交站点地图，并检查中英文介绍页。分别记录提交和实际收录情况。

From a fresh recursive clone, compare the registered commits with the checked-out revisions. 以下命令可在全新递归检出中比对主仓记录和子仓实际提交。

```sh
git ls-tree -r HEAD third_party
git submodule status --recursive
npm ci
npm test
```
