---
name: praxis-operator
description: Maintain Praxis platform and app code, product documents, schemas, configuration, and tests. Use for maintenance in this repository; real business-data operations belong to separately authorized external API/MCP clients.
---

# Praxis Operator

English · [简体中文](SKILL.zh-CN.md)

Praxis exposes business tools to external agent clients; it does not run an internal agent. This skill is for trusted platform maintenance. The current maintenance agent changes code, product documents, tests and necessary configuration, and **must not create, update or delete real business records**. Business users and their external agents use scoped business APIs/MCP and have no platform-code or host privileges.

Development and product use are separate platform roles. The same model may serve either role through separate sessions, identities, credentials, environments and audit trails. Do not automatically switch a privileged maintenance session into business use; even a platform administrator uses a separate business identity when operating the product.

An existing app interface is a starting point for improving the implementation. This does not authorize the maintenance agent to perform a live data operation or give a business agent code access.

## Find the owner

Resolve the workspace root relative to this skill (`../..`), then read the [current PRD](../../docs/PRD.en.md) and [roadmap](../../docs/ROADMAP.en.md). Their Chinese counterparts include the detailed historical records. Inspect the affected app's instructions, requirements, package scripts, CLI help, and relevant data contract. Discover paths and commands from the repository rather than assuming every app uses the same interface.

The platform owns discovery, launchers, and cross-app coordination. Each app owns its behavior and source of truth and must run independently of Praxis and the legacy Books frontend. A launcher link does not transfer data ownership. Keep project reference documents distinct from functioning applications. Letters and Profiles ship as independent reader apps. Their private documents belong to the configured owner and are mounted read-only.

Use an independent repository/submodule for an application, not for each business record. Projects owns multiple project records through one implementation and service, as Travel owns multiple itineraries. Keep record-specific content outside Git and reuse typed data, renderers and resource permissions; a new project never requires a cloned app repository or page system.

Model the product as three entities: external agents, data, and interfaces. MCP control, OAuth 2.0 delegation and connectors/capabilities govern the agent-to-data relationship; user experience design governs how data becomes understandable and usable in the interface. These relationship capabilities are not five independent product modules. Keep development and business identities separate even when both use a coding-agent harness. Normal account and authorization management belongs in the protected Praxis web interface; maintenance bootstrap tools are not the product's management workflow.

## Choose the workflow

### Business-data boundary

Real business-data operations belong to a separate, authorized user or external business agent through the owning app's controlled business API/MCP. The maintenance agent must not use direct files, an app CLI, SQL, curl, a privileged backend or an unrestricted helper agent to seed, modify or clean up real records. Do not use private stores as test fixtures.

Maintenance verification may use isolated synthetic fixtures and inspect redacted health, protocol traces, audit assertions, versions and service-generated integrity summaries. Future end-to-end test records must be created, changed and cleaned up by the designated business actor through MCP; the maintainer must not repair a failed demonstration by writing records itself. Preserve app-owned validation, concurrency, schema compatibility and data ownership in the implementation.

Private runtime records, exports, backups, credentials and their contents stay out of commits and fixtures. Changing schema or writing a migration implementation does not authorize running it on live business data under this maintenance role.

### Repository collaboration

Follow [Contributing](../../CONTRIBUTING.md) for administrator, maintainer, external contributor and agent responsibilities. Administrators and maintainers can implement, verify, commit and push directly within their assigned scope. External contributors use issues and PRs, reviewed by a maintainer or administrator. Agents follow the directing person's path and existing authorization. Before edits, identify the owning repository and release branch, relevant contract sections, acceptance criteria and check plan. Report actual evidence and explicit results. The administrator accepts sensitive contracts and controls production rollout.

Submit app implementation and tests to the app repository. Publish the app change before pinning its final public release SHA in the platform; external app PRs merge first. Validate the actual native interface and platform combination. Record source publication, release readiness and deployed verification in the task delivery or PR.

### Product and code changes

For each requested requirement:

1. Update the owning PRD, then its roadmap, before changing implementation. Update the platform documents too when a change crosses app boundaries. Keep documentation proportional to the change.
2. Implement the required app, platform, adapter, or schema changes. Reuse working interfaces; extend or replace them when necessary to achieve the task. Do not rewrite unrelated systems just because replacement is possible.
3. For a versioned platform change, synchronize the root package, lockfile, PRD and roadmap in both languages. Keep the historical release rows and use the same version for the implementation, tests and deployment. Independent apps follow their own version policy.
4. Select checks by the changed behavior. Open changed PRDs through the workbench reader. For navigation, run `node --test tests/system-navigation.test.mjs tests/app-launcher.test.mjs` and exercise the changed flow. Run `npm test` for integration changes. Finish source and browser checks before building affected images. A documentation-only correction does not need an application rebuild.
5. Commit the verified requirement, staging only its files. In a submodule, publish the child first, then the parent gitlink and associated integration changes. Preserve unrelated working changes. Administrators and maintainers can push directly within existing authorization. External contributions use the issue and PR process.
6. For a task targeting a local self-hosted installation, deploy verified runtime or behavior changes in the assigned environment and check the running entry point before reporting completion. For a SaaS service, deploy according to release needs and the target environment’s release policy. Rebuild only affected services. Documentation or source changes that leave running behavior intact can be delivered without a service rebuild. For source PRs, record local/staging evidence and a separately assigned production rollout where required. Report the commit, validation, review and deployment outcome.

Do not let optional advisory agents or unrelated checks block a small completed change. Once its acceptance checks pass, proceed to delivery; stop adding polish or reopening settled choices. Missing evidence must be stated precisely, not addressed by automatically launching every available suite.

For schema or migration work, verify behavior with synthetic migration fixtures and document recoverable live execution steps for the appropriate executor. Preserve existing records and compatibility promised by the owning app. Commit source and synthetic tests, not private migrated records; keep real business writes outside this maintenance role.

### MCP tool skills

Every exposed MCP tool must map to a real business skill with operation-specific guidance. A skill may cover one app's related tools; keep its permission boundaries, typed inputs, prerequisites, mutation/retry rules and read-back criteria explicit. Publish the authorized skill association alongside discovery and support controlled skill retrieval. Anonymous guidance exposes only its public skill. Add coverage checks when adding or renaming tools; do not substitute this privileged maintenance skill for business-client instructions or change an external harness to inject skills.

### External-client acceptance

Read [the verification plan](../../docs/VERIFICATION.en.md) for business API, authorization or MCP work. The required live proof uses a real, separate Paseo Codex business agent with effective isolation, plus an independent physical-phone third-party agent App. A documentation helper, a full-access coding subagent, direct CLI/curl calls, mocked MCP responses, model API requests or the agent's prose do not satisfy that proof.

Keep protocol and business-authorization checks outside the external agent's control. Ordinary business tools never expose shell, SQL, arbitrary file/code access, deployment or backup keys. Record actual provider/client identity and redacted committed outcomes. Mark unavailable or unexecuted checks honestly; documentation delivery alone does not implement the service or connect a phone.

### UI/UX design and changes

For the same business function, use one interface with different validated data. Reuse the existing renderer, components, styles and interaction state rather than cloning a page system per record, region, user or provider. Keep differences in typed data projections and narrow service adapters. Do not preserve obsolete controls by adding extra UI to an approved design. This is a platform-wide implementation rule; it does not require unrelated apps to share a runtime library. Verify multiple datasets against the same components, including missing fields and provider differences.

Respect the approved page inventory: login, workbench, management, PRD collection, apps and projects. Reuse existing pages and components; add an independent page or navigation entry only when the user explicitly requests it.

For interface or interaction work, use the [Praxis UI/UX design guide](references/ui-style-guide.en.md). Identify the user’s task, entry point, visible outcome, and return or recovery path before selecting a launcher, collection, reading or editor template. Check the changed interaction with one representative flow. Share the native visual language without forcing every surface into two columns. Reminder is the golden reference for breathing room and the collection sidebar pattern; when using that pattern, preserve its local font/line-height and compare the rendered brand block and first entry position. A workbench launcher may instead use a centered icon grid and compact identity row. Respect explicit user choices and the owning app's behavior, language and access boundaries. Keep styles and components app-owned; this guidance does not authorize redesigning other apps or adding a shared runtime dependency.

Identity, API and MCP integration must preserve an app's established presentation and interactions. Do not substitute a reduced generic business screen for the app's accepted interface. When adapting transport, compare the original and managed interfaces with identical synthetic content, including the main pane, view semantics and existing controls; navigation labels alone do not establish parity.

Define the UI-backed data contract in code before exposing business writes. Quantities, units, time intervals and states use validated numbers or enums; code owns labels, formatting and missing values. Titles and notes may be text only in explicitly designated fields. Keep source observations, verification status and audit explanations separate from short display facts. Expose object-scoped, field-allowlisted mutations and reject unknown fields, invalid types and prose in structured fields on the server. Do not offer whole-record JSON replacement as a shortcut around this boundary. Preserve the approved interface while business agents fill the allowed values; prompt instructions are not a substitute for enforcement.

### Image performance

Images are a global caching requirement. For image-serving or deployment work, read [the image caching contract](references/image-caching.md). Apply the policy to actual image responses at their owning server and preserve validators through gateways. Check whether images are already inline or stored locally before adding network machinery. Keep independent apps self-contained; shared guidance is not a shared runtime dependency.

### Services and recoverable storage

Use `core` for the platform backend and the preferred `npm run core`, `npm run core:admin` and `npm run core:stack` commands. The older `business` command and managed-group names remain compatibility aliases. Preserve installation-specific project names, source/configuration paths, app business APIs and private data bindings.

For deployment or machine/storage migration, read the root [Docker runbook](../../docs/DOCKER.en.md) and [storage contract](../../docs/STORAGE.en.md). Use the [managed deployment guide](../../docs/MANAGED-DEPLOYMENT.md) for the current Compose and blue/green commands. An unavailable Docker engine is a deployment prerequisite; keep working native services until the replacement is verified.

For a new app, fill in the [first-release record](../../docs/DOCKER.en.md#new-app-release-record) before building or deploying. Capture its initial empty or first-run state, its data owner, an actual app → Home return check on desktop and mobile, and what the previous slot returns after rollback. Follow the [app standard](../../docs/APP-STANDARD.md) and update the English product copy and documentation before the Chinese edition.

Applications own local working data; the storage coordinator owns consistent snapshots and encrypted replicas. Read the private storage configuration to locate the active source; do not silently use an old checkout default after cutover. Use an isolated Reminder instance for CLI tests. Use SQLite online backup, preserve Slides authoring state, and report browser-only exports/original audio separately from server data. Never treat cloud/NAS folder synchronization as a safe merge of live databases.

Use one active writer, verified empty-directory restores and explicit handover. Keep source commits, private exports, provider passwords and recovery keys distinct; private runtime material stays outside Git and images. A provider migration completes only after copy, integrity check and trial restore; retain the old target. Report real remote verification separately from synthetic tests or unconfigured credentials.

## Authorization and delivery

Continue authorized reads, edits, tests, and necessary local service operations without asking for the same permission again. Ask only for information or a decision that materially blocks the task and cannot be inferred from the repository or conversation. Full access does not expand the requested scope: external messages, publishing, pushing, and creating remote resources require authorization for those actions.

Keep code comments, internal errors, and CLI output in English; preserve the app's UI language and user-authored content. Exclude implementation/debug details from user-facing UI unless they help users make a decision.

Finish with the observable outcome, relevant validation, and local commit for code requirements. Business-data actions are performed by their designated external actor; the maintenance agent reports only permitted redacted verification evidence. State any unverified part precisely. Do not perform later roadmap work merely because this skill describes how to operate it.
