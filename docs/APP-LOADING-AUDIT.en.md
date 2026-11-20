# App integration loading audit

[简体中文](APP-LOADING-AUDIT.md)

## Audit baseline

At platform 0.1.119 the source index and app-owned manifests already supply names, icons, release versions, examples and PRD locations. The following behavior remains encoded by app identity in Praxis. These are the extraction boundaries for the implementation, not evidence that a module import alone has delivered the behavior.

| Area | Current examples | Owning contract and acceptance |
| --- | --- | --- |
| Web entry | `web-gateway.WEB_APPS`, native/static/private handlers, native path exceptions | App-owned slug, entry policy, assets, routing and scoped native requirements; preserve complete native views and Home. |
| Authorization | `auth.WEB_APP_IDS`, actions, targeted creation, OAuth scope tables and special native checks | Registry-supported capabilities; platform-owned account, grant, role, expiry and lease enforcement. Registration grants nothing. |
| Business invocation | 94 operations across seven adapter IDs, per-app validators, assertion flags, response/error/event handling | App-owned typed schemas and hooks; generic bridge owns authentication, current resource/action checks, signing, concurrency and traces. |
| MCP | 81 business tools, schema imports, instructions and seven app skill paths | Derive tool discovery, annotations, inputs and operation guidance from the same loaded definitions. Platform control/public guidance remain platform-owned. |
| Browser presentation | App name/route/navigation-marker maps and card exceptions | Bounded public registry facts; never derive authority from browser input or a tile. |
| Installation | Bootstrap app maps, build targets and service-specific wrappers | App-owned reviewed recipes consumed by generic installation primitives; actual targets, project names, paths and credentials remain private installation configuration. |
| Storage | App path/format/export and relocation branches | App-owned descriptors/validators; generic consistent snapshots, safe copying, writer handover, encryption and replicas. Keep existing records and backup coverage. |

## Reviewed module contract

The fixed app-root file `praxis-integration.mjs` exports `createIntegration({z})`. Its factory returns the app integration with `schemaVersion: 1` and its canonical `appId`. It may import reviewed helpers within that app source. The platform loads only selected, pinned local app sources; it accepts neither a caller-supplied module path nor a remote executable URL. Invalid or duplicate identity, slug, tool, scope, action and unsafe path declarations fail activation.

`web` declares `slug`, `policy` (`grant`, `platform-admin`, `document-owner`) and `kind` (`proxy`, `static`, `private-documents`), plus appropriate source-relative directory/assets and a default native port. Defaults describe a supported binding; they do not prove that a backend is running. Explicit installation overrides select actual targets, owner identities and private mounts. App-owned pure routing hooks see only parsed method/path/query and may request a declared binding, relative path or resource check; they cannot select an absolute upstream or forward credentials themselves.

`business` declares its adapter ID, supported actions/scopes, targeted creation, operations, typed tools, skill and instructions. Operations distinguish mutation from their authorization action. App hooks validate or normalize requests/results/errors, identify required authorizations, prepare authorized cross-app reads, supply bounded assertion extras and describe event collection. `prepareInvocation(request, ctx)` may return a normalized request and declared assertion fields. The current-app-bound context offers safe identity facts, business membership, `hasAction`, `canReadSubject` and declared authorized reads. It exposes no raw token, key, AuthStore, unrestricted fetch or SQL interface. Reserved signed claims always belong to the bridge. Additional authority is derived and rechecked by platform primitives, never accepted from request fields.

Installation and storage descriptors follow the same ownership rule. An app must not execute an arbitrary command supplied by a business caller. Descriptors use reviewed source/defaults and resolved private bindings. Routine discovery starts no service, creates no business record and changes no grant.

## Behavior and authority that must survive extraction

- Knowledge's legacy resource gate and native reading view.
- Lattice's native templates, authoring/render permissions, legacy-deck view, job authorization and bounded media/artifact contracts. Previously disabled video engines stay disabled.
- TingProof's assignment-only shell/assets, segment boundaries, separate whole-project privilege and server-authoritative submit permission.
- Polaris's filesystem observer, safe header forwarding and blocked internal trace route. No executor, attack pack or live execution adapter is introduced.
- Calendar's authorized agenda projection and complete static module dependencies.
- Letters/Profiles' owner-bound original-file reads, no-follow file handling and revocation fences.
- Existing schemas, idempotency, source/output revisions, consistent storage and native navigation across all apps.

One immutable registry supplies all consumers. Derived compatibility exports may expose its current views; a second hardcoded catalog or fallback app switch is not permitted. New policy writes reject unsupported capabilities. Reading a well-formed stored policy safely ignores inactive capabilities without deleting the record or invalidating unrelated active grants. Deactivation hides entries/tools and refuses access, retaining data/history and the ability to roll back. Diagnostic dimensions use known installed identifiers; arbitrary caller names remain safe unknown categories.

## Projects implementation decisions

The accepted starting requirements are Projects revision 2 at preserved commit `54701f5`, incorporated with the current public metadata release. The owning implementation revision resolves D1 and keeps the complete AC01–AC16 acceptance matrix.

- `manage_planning_roles` requires a current business-space owner/admin and effective project-scoped authorization. It assigns/revokes explicit team membership and project/team decision roles. Recipients must be enabled accounts with current read access to that project. No global administrator or free-text owner fallback exists.
- `accept_plan` additionally requires current update permission and the designated role for that exact target. Delegated clients need explicit acceptance delegation. The app checks the signed actor and current app role again at commit.
- Compact body-bound assertion facts convey checked role management, eligible subjects and actual effective actions. The application cannot set these facts in a proposal. Core keeps the signature key and policy lease.
- Existing project reads expose virtual unadopted project/four-team slots without saving them. Drafts use authenticated `(project, team, user)` identity. No real members, roles, plans, proposals or decisions are seeded by maintenance.
- Complete the personal→team→project proposal loop before restore-as-new-draft. Preserve target-scoped changes, team-qualified IDs, three-way evidence, current source/target checks, immutable decisions and execution facts.
- Measure the PRD's synthetic 20-member/200-milestone workload in the recorded environment and actual concurrency; do not assert a service guarantee or invent a measured baseline.

## Required release evidence

1. A synthetic extra app is installed by source index, manifest, integration and provider only. Without an app-specific parent edit, verify native entry/Home, explicit web grant, typed MCP discovery and skill, signed read/write, versions/idempotency, revocation, cards, inventory, storage metadata and traces.
2. Invalid modules/paths, duplicate declarations, unsupported grants, cross-app callback escape and credential exposure fail closed. Uninstall/reinstall preserves stored history and unrelated authorization.
3. Regress current native interfaces and operations with identical synthetic content. Record legacy route/security exceptions as tests rather than removing them.
4. Projects records actual results for AC01–AC16, native and MCP parity, restart/retry, immutable decisions, privacy cleanup, both languages, desktop/phone widths and the agreed load. External business-client and physical-phone evidence remain separate.
5. Publish owning app revisions, pin publicly fetchable main commits, verify a fresh anonymous installation and the built images, then deploy with private data and a single writer preserved. Code/fixture evidence is not a claim that real business records were written.

## Implementation boundaries

`src/app-integrations.mjs` validates and freezes installed definitions. Authentication, bridge, MCP/skills, HTTP gateway, card/inventory readers, observations and frontend registry facts consume that same registry. Runtime imports never accept a browser or MCP argument as a module path. `PRAXIS_APP_SOURCE_ROOT` is an explicit operator/test source-root override, not a public service setting.

App-owned `praxis/` helpers retain native route exceptions, typed schemas, skills, legacy UI/assets and runtime trace normalization. Deployment helpers own native `Dockerfile.praxis`, local Compose recipes and optional source-build steps. `node scripts/generate-compose.mjs` regenerates the checked-in installation snapshot and Docker source-context allowlist; `--check` detects drift in either artifact. Static assets, artwork and optional build inputs come from the installed app declarations. The platform base describes initialization, Core and the workbench. Each installed app contributes its own service and volume definitions. Volume identities and installation-specific project names remain stable. These recipes do not start a service during discovery.

Operator-only storage/deployment hooks receive necessary private path metadata and checked file/mount primitives. They run only from explicit installation/recovery commands, separately from bounded business invocation hooks. App declarations select their formats, working-data paths, relocation inputs, validators and inventory projections; the platform retains canonical/no-follow path checks, consistent SQLite snapshots, writer fences and reversible installation changes. Named legacy CLI aliases and an existing installation's Compose snapshots remain compatibility entry points. They do not supply a second runtime capability registry, and the Polaris compatibility entry supports only the safe read-only viewer.

The bundled app set is an explicit installation choice in `config/installed-apps.json`, with reviewed public source pins. Product examples, synthetic fixtures, historical release ledgers and explicit private installation overrides may refer to app names; they do not dispatch app behavior. A new native app supplies its module, Dockerfile and installation recipe, then the generic installation snapshot is regenerated without changing platform code.

### Activation and retained configuration

The reviewed registry is activated when services start; restart the affected platform services after changing installed sources. For removal, stop the app's writers and keep its backup, data and private settings. Remove its installed source and list its retained adapter ID in private Core `inactiveApps`. Core excludes only those explicitly inactive, uninstalled adapters from dispatch without rewriting their configuration; an unknown active adapter still fails validation. Existing grants/history remain stored and cannot authorize the inactive app. Reinstallation removes that inactive marker and activates the reviewed source and original settings together. Metadata/provider responses remain refreshable; executable code is not hot-loaded from an edited file during a user request.

The source-demo command also loads the app-owned `deployment.demo` recipe. The platform manages the pinned source archive, private temporary HOME/data, an allowlisted environment and cleanup; app-specific dependency, seed, build and start steps stay with the app. Unsupported demo recipes remain explicitly unavailable instead of pretending a backend exists.
