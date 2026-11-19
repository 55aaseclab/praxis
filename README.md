# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis

[简体中文](README.zh-CN.md) · [Quickstart](#quickstart) · [Connect to Praxis](#connect-to-praxis) · [Contribute](#contribute)

**Praxis is a self-hosted platform where the AI agent you choose is your interface to your apps.** You ask for an outcome and decide which records and actions to authorize. Once intent, materials and access are in place, the design goal is zero mandatory clicks for routine work. That protects the attention of the people doing the work. Your agent handles routine steps and checks, leaving you time for verification that needs your judgment. In Lattice, for example, your agent can update a deck from approved project material and check how it renders. You open a presentation ready to review and show.

For teams, the goal is to deliver more work with the same people while maintaining quality and meeting deadlines. People can spend more of their time on the decisions and checks that make a result fit to deliver. [Product requirements](docs/PRD.en.md)

Praxis builds and polishes its built-in apps so people can read, watch or listen to results and make informed decisions. These apps also show how to build new ones around your own records, operations and workflows. Making it quick for individuals, families and organizations to build and deploy their own apps is part of the product direction. You can start with a new app and its own data, with integrations where they help. Today you can run your app independently and register it in a local workbench. [App standard](docs/APP-STANDARD.md)

You can try the [hosted workbench](https://polaris.jianxiaoyitech.com/) before setting up your own instance.

![Real Codex session in Paseo beside the Praxis workbench with synthetic demo records](docs/images/workbench-en.png)


## Quickstart

Install Git, Docker Engine and Docker Compose v2.

```sh
git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
cd praxis
docker compose up --build -d --wait
```

Open [the workbench](http://127.0.0.1:4321/). Calendar and Matrix Reader are included in the image. Use the Home button to return to the workbench. Configure identity and the app services for an installation with accounts and authorized business operations. [Running Praxis](docs/RUNNING.md) · [Built-in apps](docs/BUILTINS.md) · [Managed deployment](docs/MANAGED-DEPLOYMENT.md)

Run `docker compose down` to stop this local workbench.

## Connect to Praxis

Add Praxis as a remote server in an agent client that supports Streamable HTTP MCP and OAuth.

```text
https://polaris.jianxiaoyitech.com/mcp
```

Sign in through your browser and choose the records and actions your agent may access. Review or revoke its access in **Settings → Agent delegations**. For a self-hosted installation with identity and app services configured, use your own Praxis HTTPS address followed by `/mcp`.

With Knowledge available to your account, you can ask **“Which sampling sites do the field notes say we should revisit?”** Your agent can search the permitted library, read the relevant passages and cite their locations. Open the source in Knowledge to check the answer. [Knowledge tools](skills/knowledge-mcp/SKILL.md)

<details>
<summary>Explore the public connection guide locally</summary>

Start the optional guide service alongside the local workbench.

```sh
docker compose --profile guide up -d --wait
```

Connect your client to `http://127.0.0.1:4181/mcp/guide`, or list its two public tools with curl.

```sh
curl -fsS http://127.0.0.1:4181/mcp/guide \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`praxis_about` and `praxis_use_guide` return public guidance. Business actions require the configured installation and user authorization described above. Stop both services with `docker compose --profile guide down`.

</details>

## Contribute

Platform and app contributions are welcome. Submit app changes to the owning repository and update its pinned revision in Praxis. Run focused checks for small changes and `npm test` for integration changes.

[Contribution guide](CONTRIBUTING.md) · [App standard](docs/APP-STANDARD.md) · [Requirements](docs/PRD.en.md) · [Roadmap](docs/ROADMAP.en.md)

[Documentation index](docs/README.md) · [Product positioning](docs/COMPETITIVE-POSITIONING.md) · [How the logo grows](docs/LOGO.md) · [Apache 2.0 license](LICENSE)
