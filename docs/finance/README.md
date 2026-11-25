# Finance

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

[简体中文](README.zh-CN.md)

A local CNY ledger for income, expenses, budgets, assets and savings projections. Set your target, record movements and compare actual and planned monthly savings. The initial ledger uses zero balances and a configurable target.

```sh
npm start -- --host 127.0.0.1 --port 4329
```

Open http://127.0.0.1:4329/. Use an external `FINANCE_DATA` file for your own ledger. The HTTP service and `npm run cli` operate on the same store. Run `npm test` on synthetic data.

## Praxis integration

The app-owned [provider contract](PRAXIS-PROVIDER.md) supplies authorized source-backed cards and data-source metadata without exposing a new HTTP endpoint. Run `npm run test:provider` for the isolated provider checks.

## Praxis registration

App release: `0.1.3`. The app owns [`praxis-app.json`](praxis-app.json), its English and Simplified Chinese presentation, the icon at `public/praxis-icon.svg`, the declared PRD locations and any legacy icon aliases. `schemaVersion: 1` identifies the registration format; it is separate from this app release and from data, protocol and document revisions. Package and lockfile release metadata, where present, agree with the declaration.

[`apps.example.json`](apps.example.json) registers a local alias by referencing `./praxis-app.json` and `http://127.0.0.1:4329/`. Start the standalone service described above before using the example; registration does not start a backend or grant account, administrator or business-data access. Installation origins, data locations and access policy remain separately configured.

## App-owned container build

`Dockerfile.praxis` builds this application from its own repository, without a Praxis checkout or an external build context:

```sh
docker build -f Dockerfile.praxis -t praxis-finance:local .
```

Use the application configuration and persistent data locations documented above when running the image. The Praxis installation consumes the same app-owned build and deployment declaration.

## 应用自有容器构建

`Dockerfile.praxis` 可直接从本应用仓库构建，无需 Praxis 源码或额外构建上下文：

```sh
docker build -f Dockerfile.praxis -t praxis-finance:local .
```

运行镜像时沿用上文的应用配置与持久数据位置。Praxis 安装流程使用同一份应用自有构建文件与部署声明。

## SQLite storage and conversion

Structured runtime records use the app database. The explicit operator command is `npm run storage:migrate -- --spec /absolute/private/sources.json --database /absolute/private/app.db --receipt /absolute/private/receipt.json --writers-stopped`. The private spec is an array of `{file, spaceId, documentId}` source references. Stop every writer, keep original files, and verify the receipt before activating the new binding. Existing JSON inputs remain explicit compatibility/import sources; a configured database never silently falls back to them. `--export --database /absolute/private/app.db --space SPACE --document state --output /absolute/private/new-export.json` exports an exact logical namespace for recovery. Files/assets keep their existing ownership.
