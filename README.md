# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis

[简体中文](README.zh-CN.md) · [Quickstart](#quickstart) · [Try MCP](#try-mcp)

**Praxis is a self-hosted platform where the AI agent you choose is your interface to your apps.** With any MCP-compatible agent harness, you can ask your agent to find a passage in your notes or update a task. You decide which records it can access and what it can do. Whether you run Praxis for yourself, your family, a team, or an organization, you can use its 14 built-in apps for knowledge, projects, travel, finance, and more. You can also build your own apps and host them yourself. To try Praxis before setting up your own instance, visit our [hosted workbench](https://polaris.jianxiaoyitech.com/).

![An agent conversation in Paseo on the left and the Praxis workbench on the right](docs/images/workbench-en.png)

*A real Codex session in Paseo alongside the running Praxis workbench. Demo files and project records use synthetic data.*

## Quickstart

The local workbench runs on Linux with Node.js 22.16 or later and npm.

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
npm ci
npm start
```

Open [the workbench](http://127.0.0.1:4321/) and select **Calendar**. Use the Home button to return. To try a service-backed app with temporary data, run `npm run app:demo -- finance` in a second terminal and open the demo workbench URL it prints. Managed installations show the entries your account can access. [Built-in app guide](docs/BUILTINS.md) · [Add a local app](docs/APP-STANDARD.md#run-your-own-app-locally)

## Try MCP

You can try tool discovery before setting up an account. Leave the workbench running and start the gateway in a second terminal from the same directory.

```sh
PORT=4181 PRAXIS_WEB_GATEWAY=true PRAXIS_CANONICAL_URL=http://127.0.0.1:4181 npm run gateway
```

Connect a Streamable HTTP MCP client to `http://127.0.0.1:4181/mcp/guide` and ask **“What tools does Praxis offer on this connection?”** The public guide offers `praxis_about` and `praxis_use_guide`. Both return guidance without accessing business records.

<details>
<summary>List the tools with curl</summary>

```sh
curl -fsS http://127.0.0.1:4181/mcp/guide \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

</details>

With **Knowledge** connected to a managed workbench, you can ask **“Which sampling sites do the field notes say we should revisit?”** An authorized agent can search the project’s library, read the relevant passages and cite their locations. You can open the source and check the answer yourself. [Knowledge tools](skills/knowledge-mcp/SKILL.md) · [Managed setup](docs/RUNNING.md)

## Build with Praxis

- **Bring an app.** Give it a standalone entry point, bilingual labels and a manifest. Use the local launcher while developing. [App standard](docs/APP-STANDARD.md)
- **Run the platform.** Build the Docker image, configure sign-in and supply private files to [Letters](https://github.com/55aaseclab/letters) and [Profiles](https://github.com/55aaseclab/profiles) through read-only mounts. [Running Praxis](docs/RUNNING.md)
- **Contribute.** Run `npm test` for the synthetic test suite. The product requirements and roadmap describe the work the platform owns. [Requirements](docs/PRD.en.md) · [Roadmap](docs/ROADMAP.en.md) · [Contributing](CONTRIBUTING.md)

[Documentation index](docs/README.md) · [Product positioning](docs/COMPETITIVE-POSITIONING.md) · [How the logo grows](docs/LOGO.md) · [Apache 2.0 license](LICENSE)
