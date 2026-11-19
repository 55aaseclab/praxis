# Praxis 工作台

[English](README.md)

Praxis 为人提供工作台，为外部 agent 提供应用的 MCP 接口。人可以打开应用阅读结果，外部 agent 可以在指定工作空间和资源的授权范围内调用工具。数据和呈现方式由各应用负责。

## 在本机运行

使用 Linux、Node.js 22.16 或更高版本以及 npm。

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
npm ci
npm start
```

打开[工作台](http://127.0.0.1:4321/)。新检出的个人桌面为空。打开[产品介绍](http://127.0.0.1:4321/about/zh-cn/)了解使用方式，进入[产品目录](http://127.0.0.1:4321/prds/)阅读需求文档。按 Ctrl+C 停止服务，运行 `npm test` 可用合成资料执行平台测试。

## 接入应用

先启动本机应用，再在本地清单中登记。应用标准提供了完整的双语示例。本地工作台可以直接打开回环地址的应用。受管运行还需配置原生登录、网关与独立应用服务。随仓提供的 Letters 和 Profiles 阅读器只向配置的所有者提供原件。[应用标准](docs/APP-STANDARD.md) · [运行说明](docs/RUNNING.md)

## 项目文档

[产品需求](docs/PRD.md) · [路线图](docs/ROADMAP.md) · [竞品分析](docs/COMPETITIVE-POSITIONING.md) · [参与贡献](CONTRIBUTING.md) · [Apache 2.0 许可证](LICENSE)
