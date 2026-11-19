# Praxis

[简体中文](README.zh-CN.md)

Praxis is a workbench for people and the apps behind the Model Context Protocol (MCP). A person can open an app and read its results. An external agent can use the same app through tools authorized for a specific workspace and resource. The app owns its data and the way people experience it.

## Try the workbench

Use Node.js 22.16 or later on Linux and npm.

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
npm ci
npm start
```

Open [the workbench](http://127.0.0.1:4321/). A fresh checkout starts with an empty personal desktop. [About Praxis](http://127.0.0.1:4321/about/) explains the product, and the [product catalog](http://127.0.0.1:4321/prds/) opens the specifications. Press Ctrl+C to stop the server. Run `npm test` to exercise the platform with synthetic records.

## Connect an app

Start an app on your machine and list it in a local manifest. The app standard includes a complete bilingual example. The local launcher can open a loopback app without a production account. Managed use adds native sign-in, a gateway and separately provisioned app services. The two bundled readers, Letters and Profiles, only expose their sources to the configured owner. [App standard](docs/APP-STANDARD.md) · [Running Praxis](docs/RUNNING.md)

## Project

[Product requirements](docs/PRD.en.md) · [Roadmap](docs/ROADMAP.en.md) · [Product positioning](docs/COMPETITIVE-POSITIONING.md) · [Contributing](CONTRIBUTING.md) · [Apache 2.0 license](LICENSE)
