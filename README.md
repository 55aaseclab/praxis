# <img src="public/praxis.svg" width="38" height="38" align="absmiddle" alt=""> Praxis

[简体中文](README.zh-CN.md) · [Quickstart](#quickstart) · [Run local Praxis](#run-local-praxis) · [Connect to Praxis](#connect-to-praxis) · [Contribute](#contribute)

**Praxis is a self-hosted platform where the AI agent you choose is your interface to your apps.** You ask for an outcome and decide which records and actions to authorize. Once intent, materials and access are in place, the design goal is zero mandatory clicks for routine work. That protects the attention of the people doing the work. Your agent handles routine steps and checks, leaving you time for verification that needs your judgment. Praxis also aims to capture the full business process and use Polaris as a general-purpose workflow tool to improve it. You can build custom apps to present the results. You can try the [hosted workbench](https://polaris.jianxiaoyitech.com/) before setting up your own instance.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/workbench-en.png?v=2">
  <img src="docs/images/workbench-en.gif?v=2" alt="Real Paseo conversation beside Praxis showing a synthetic Reminder card after the prompt is sent">
</picture>

## Quickstart

To try Praxis before setting up your own instance, paste this prompt into your agent to connect to our online service.

> Connect to Praxis at https://polaris.jianxiaoyitech.com/mcp using OAuth. Help me sign in and choose what you may access, then show my available apps and tools.

A Praxis account is required for the online service. Self-service account registration is planned.

### Run local Praxis

1. **Start Praxis.** Install Git, Docker Engine and Docker Compose v2, then run the following commands.

   ```sh
   git clone --recurse-submodules https://github.com/55aaseclab/praxis.git
   cd praxis
   docker compose up --build -d --wait
   ```

   Compose builds and starts all 14 built-in apps with the workbench, native app services, identity and authorized business endpoints. First startup generates the owner account, service keys and persistent application stores.

2. **Get your login details.** Retrieve the initial account from this installation.

   ```sh
   docker compose exec core node scripts/builtin-install.mjs credentials
   ```

3. **Open the workbench.** Open [Praxis](http://127.0.0.1:4321/) and sign in. App and resource permissions apply to both browser access and agent operations.

Keep the generated account details private. `docker compose down` stops the stack while preserving its data volumes. [Running Praxis](docs/RUNNING.md) · [Built-in apps](docs/BUILTINS.md) · [Managed deployment](docs/MANAGED-DEPLOYMENT.md)

### Connect to Praxis

1. **Connect your agent.** Copy this prompt into your agent.

   ```text
   Connect to my local Praxis at http://127.0.0.1:4321/mcp. Help me sign in and request permission to read and create reminders.
   ```

2. **Sign in and authorize access.** Open the sign-in link, use the account created when you started Praxis, and approve the requested Reminder access.

3. **Start your first task.** Ask your agent.

   ```text
   Remind me tomorrow to review the field notes.
   ```

   Open [the workbench](http://127.0.0.1:4321/), select **Reminder → All**, and check the saved reminder.

You can review or revoke your agent's access in **Settings → Agent delegations**.

## Contribute

Platform and app contributions are welcome. Submit app changes to the owning repository and update its pinned revision in Praxis. Run focused checks for small changes and `npm test` for integration changes.

[Contribution guide](CONTRIBUTING.md) · [App standard](docs/APP-STANDARD.md) · [Requirements](docs/PRD.en.md) · [Roadmap](docs/ROADMAP.en.md)

[Documentation index](docs/README.md) · [Product positioning](docs/COMPETITIVE-POSITIONING.md) · [How the logo grows](docs/LOGO.md) · [Apache 2.0 license](LICENSE)
