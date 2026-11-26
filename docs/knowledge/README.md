# Knowledge

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).
> 已于 2026-11-25 从 Praxis 发行版退役；文档存档说明见 [RETIRED.md](RETIRED.md)。

[简体中文](README.zh-CN.md)

Browse workspace libraries, read documents and notes, search indexed passages and inspect paper statistics. The runtime supports revisioned entries, an attachment inbox, document parsing and scoped business operations. New installations start empty.

```sh
npm ci
npm start -- --host 127.0.0.1 --port 4324
```

Open http://127.0.0.1:4324/. Set absolute `KNOWLEDGE_DATA_DIR` and `KNOWLEDGE_INBOX_ROOT` for private storage and ingestion. Parsers use Python 3, pdftotext for PDF, catdoc for DOC, and Python xlrd/openpyxl as needed. Signed operations require private service configuration. Run `npm test` for native fixtures.

## Praxis integration

The app-owned [provider contract](docs/PRAXIS-PROVIDER.md) supplies authorized source-backed cards and data-source metadata without exposing a new HTTP endpoint. Run `npm run test:provider` for the isolated provider checks.

## Praxis registration

App release: `0.1.25`. The app owns [`praxis-app.json`](praxis-app.json), its English and Simplified Chinese presentation, the icon at `public/praxis-icon.svg`, the declared PRD locations and any legacy icon aliases. `schemaVersion: 1` identifies the registration format; it is separate from this app release and from data, protocol and document revisions. Package and lockfile release metadata, where present, agree with the declaration.

[`apps.example.json`](apps.example.json) registers a local alias by referencing `./praxis-app.json` and `http://127.0.0.1:4324/`. Start the standalone service described above before using the example; registration does not start a backend or grant account, administrator or business-data access. Installation origins, data locations and access policy remain separately configured.

## App-owned container build

`Dockerfile.praxis` builds this application from its own repository, without a Praxis checkout or an external build context:

```sh
docker build -f Dockerfile.praxis -t praxis-knowledge:local .
```

Use the application configuration and persistent data locations documented above when running the image. The Praxis installation consumes the same app-owned build and deployment declaration.

## 应用自有容器构建

`Dockerfile.praxis` 可直接从本应用仓库构建，无需 Praxis 源码或额外构建上下文：

```sh
docker build -f Dockerfile.praxis -t praxis-knowledge:local .
```

运行镜像时沿用上文的应用配置与持久数据位置。Praxis 安装流程使用同一份应用自有构建文件与部署声明。
