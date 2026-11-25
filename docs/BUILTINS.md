# Trying the built-in apps / 试用内置应用

## English

Use Node.js 22.16 or newer, npm, Git, Bash and tar. From the root of a recursive checkout, run a single native app. For example, this starts Memo with an empty record store on a loopback port.

```sh
git submodule update --init --recursive
npm ci
npm run app:demo -- memo 18432
```

Open the printed **Demo workbench** URL and select the app. Use your browser’s Back button to return to the workbench. The default port is 18432. Choose a different free port for each simultaneous demo. Press Ctrl-C to stop the app. Each invocation extracts the platform's pinned app revision into a fresh private temporary directory. It installs locked dependencies when needed and builds the application there. The server uses a temporary home and data directory. Stopping the command removes the server data. For apps with browser storage, use a private browser window and close it to discard that state as well.

| App ID | First run |
| --- | --- |
| `reminder` | Opens a task list initialized from the bundled empty checklist. |
| `knowledge` | Creates a library database. |
| `lattice-slides` | Opens the presentation workbench with an empty deck registry. |
| `travel` | Builds and displays an empty itinerary catalog. |
| `tingproof` | Builds the proofreading interface and opens a fresh project database. |
| `memo` | Opens the checklist and routines interface with a new record store. |
| `projects` | Creates a projects database. Managed writes require a service grant. |
| `intelligence` | Opens the app's fictional read-only preview catalog. |

Calendar and Matrix Reader open from the local workbench after installing their static files. Use the Home control to return. Letters and Profiles require the configured document owner's administrator session and private read-only mounts. Polaris requires a platform administrator. See the [observer image and single-file mount](POLARIS-VIEWER.md). The managed gateway checks the account's grants for service-backed apps. For persistent installations, see each app's README and the [workbench and gateway guide](RUNNING.md).

Each component retains its own licensing terms. Several source repositories have no app-level license declaration. The Praxis platform license covers the platform code.

## 简体中文

需要 Node.js 22.16 或更新版本、npm、Git、Bash 和 tar。在递归检出的仓库根目录运行单个原生应用。例如，以下命令在回环端口启动备忘应用，并创建新的记录库。

```sh
git submodule update --init --recursive
npm ci
npm run app:demo -- memo 18432
```

打开终端中 **Demo workbench** 对应的网址，在工作台选择该应用。浏览器的后退按钮可返回工作台。默认端口为 18432，同时试用多个应用时请分别指定空闲端口。按 Ctrl-C 停止。每次启动都会在一个新建的私有临时目录中解包平台固定的应用版本，按需安装锁定的依赖并构建应用。服务使用临时的用户目录和数据目录，命令退出时会移除服务数据。部分应用另有浏览器存储，可在隐私窗口中试用，关闭窗口即可清除该部分状态。

| 应用标识 | 首次启动 |
| --- | --- |
| `reminder` | 从内置的空清单初始化任务列表。 |
| `knowledge` | 创建资料库数据库。 |
| `lattice-slides` | 打开演示工作台，演示文稿列表为空。 |
| `travel` | 构建并展示空的行程目录。 |
| `tingproof` | 构建听校界面并创建项目数据库。 |
| `memo` | 打开清单和日常流程界面，创建记录库。 |
| `projects` | 创建项目数据库。受管写入需要相应的服务授权。 |
| `intelligence` | 打开只读的虚构情报示例。 |

安装静态文件后，可以从本机工作台打开日历和 Matrix 阅读器，并通过主页按钮返回。书信和个人资料需要配置的文档所有者以管理员身份登录，并通过只读挂载提供原件。Polaris 需要平台管理员权限，部署方法见[查看器镜像和单文件挂载说明](POLARIS-VIEWER.md)。受管网关会为依赖后端的应用核对账号授权。持久化安装请参阅各应用的 README 和[工作台与网关指南](RUNNING.md)。

各组件沿用自己的许可条款。部分应用仓库未声明应用级许可证。Praxis 平台许可证适用于平台代码。
