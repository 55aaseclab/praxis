# Long-lived AI-native testing

English · [简体中文](README.zh-CN.md)

This is an opt-in external-client harness, not a Praxis-internal agent. [Platform PRD ANT01–ANT10](../../docs/PRD.en.md#long-lived-ai-native-testing) defines acceptance. `npm test` runs deterministic synthetic harness checks and never starts Paseo agents. No campaign, schedule, real transaction or deployment is created by installing, importing or initializing it.

## Layout and roles

`campaigns.mjs` contains three bilingual campaigns, nine stable personas, a finite coverage matrix and persisted seeded contextual variations. `controller.mjs` owns private durable SQLite state and dispatch/approval transitions; `adapters/paseo.mjs` uses the installed Paseo CLI without shell interpolation; `runner.mjs` reserves before external execution. `prompts.mjs` keeps business and maintenance inputs separate. The coordinator reads the [skill](../../skills/ai-native-testing/SKILL.md).

| Campaign | Actors | Apps and continuity |
| --- | --- | --- |
| Family travel | Planner, explorer, comfort-minded member | Travel, Reminder. Same three people and records across destinations; feedback, personal preparation and actionable shared reminders. Thirty initial destinations do not end the campaign. |
| AI-era vulnerability management | Mentor/student in Research; engineer in Productization; Marketing; Finance/support | Reminder, Knowledge, Lattice, Memo, Polaris, Calendar, Projects, Intelligence. Demand → research → engineering → market delivery/feedback → finance/support, with returns and revisions. Research belongs to a synthetic school entity, the other groups to a synthetic company. |
| Full-time simulated investor | One investor | Reminder, Memo, Finance, Intelligence, Polaris. CNY 1,000,000 starting capital, 10% target net return. Market/horizon/asOf are mandatory before a round can start; trading, fills, fees and funds are synthetic. |

Models are exact: coordinator `opencode/hexhive005-main/zai-org/GLM-5.3-Flash`; workers `opencode/hexhive005-work/zai-org/GLM-5.3-Flash`; maintenance `codex/gpt-6.1-sol`, thinking `ultra`, provider default context window (no override). Discovery rejects unavailable exact models instead of substituting. Main and Maintenance are separate from the global one-worker slot; while Maintenance is reserved/running, new business work is blocked to avoid testing a changing environment. Every invocation requires human approval. There is no worker token budget or fixed campaign expiry. Quota/provider failures retain progress; they do not permit blind retries.

Personality influences choices, not a fixed script. Context draws have stable seeds and are persisted per task, making the stimulus reproducible without promising deterministic model output. Each actor receives its own persona, goal and new contextual information, not another actor's private conversation. Workers retain normal shell, local files, browser/network and OAuth/MCP setup tools. Real public information may be researched. Business accounts, data and actions remain isolated synthetic fixtures under actual service-side authorization.

## Configure without launching

Use Node 22.16+ with SQLite and the installed Paseo CLI. One state file defines the **global slot for this campaign installation**; do not run separate copies to bypass it. Keep state, configs, approvals, evidence and client working files outside Git. The SQLite file is mode 0600; new parent directories use 0700. The state is not app storage and contains no signing private key. Protect its directory under the intended coordinator identity.

Create independent Paseo workspaces for the coordinator, all nine actors and Maintenance. Give actors their own business accounts and scoped OAuth/MCP connections to the designated test installation; never copy administrator or backup credentials to them. The coordinator gets harness access, not authority to repair code. Maintenance gets only its source workspace and synthetic fixture environment. Discover Paseo hosts/profiles first; there were no configured profiles at source verification, so exact discovered provider/model IDs are used. An optional `host` in each binding selects the CLI endpoint; paths/workspace IDs belong to that endpoint. Do not embed credentials in host strings.

**The human signing key must be inaccessible to every agent.** Store it under an independent operator OS identity/host, hardware-backed signer or equivalent separation. Different workspaces under the same unrestricted OS user do not provide that protection. A JSON claim or file owned by the same unrestricted agent is not human confirmation. The harness verifies Ed25519 signatures; it cannot isolate OS identities or identify semantic business content for you.

In the operator identity, generate an Ed25519 key using a suitable key-management tool. One OpenSSL example is `openssl genpkey -algorithm ED25519 -out private.pem`, then `openssl pkey -in private.pem -pubout -out public.pem`; set the private key to 0600 in a private directory. Supply **only the public PEM** in configuration. Do not run these commands in a business agent session.

```sh
npm run ai-native -- config-example
npm run ai-native -- help --lang zh
```

Use `config-example` as a template, replace workspace/path values and the public key. Remove `investment` until its actual market, horizon and ISO information cutoff are chosen. The nine actor keys are fixed and each role needs its own workspace. Configuration contains no OAuth tokens: set those up directly in each authorized client. Then:

```sh
node tests/ai-native/cli.mjs init --state /private/testing/campaign.sqlite --input /private/testing/config.json --lang en --seed campaign-1
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign family-travel
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign security-research
node tests/ai-native/cli.mjs report --state /private/testing/campaign.sqlite --lang zh
```

Initialization is paused. The investor round refuses to start without its parameters. Rounds are sequential within each campaign; another campaign may progress while one is blocked. After destination 30, explicitly supply another `--destination`; no reset or completion is implied. Subsequent investment rounds retain the same initial-capital reference, account and ledger; they never replenish capital or use information after the configured cutoff. After an accepted investor round, `advance-investment --as-of ISO` explicitly advances to a later, already elapsed cutoff, records the change and retains the same actor, capital and ledger. It refuses an unfinished round, backward time or future information. Changing the market/horizon requires a separately reviewed campaign configuration; do not silently rewrite an active experiment.

## Start and advance through Paseo

Only after the test installation, identities, credentials and approval key are ready:

```sh
node tests/ai-native/cli.mjs resume --state /private/testing/campaign.sqlite
node tests/ai-native/cli.mjs coordinator --state /private/testing/campaign.sqlite
```

This starts or resumes the main-model coordinator in its assigned workspace. It uses `status`, `next` and `dispatch --task ID`, then `collect --dispatch ID` when the actor has ended its turn. Original role sessions are retained in state and resumed. Actual provider/model/mode/cwd are checked before resuming and collecting. Workspace binding is explicit on creation. Paseo does not create permissions merely from a prompt: independently verify real OAuth discovery, grants and app outcomes under C01 and subsequent verification cases.

`collect` requires this dispatch to have been observed running before an idle/error state can release its slot; an idle queued recipient cannot release it. If a very short turn was never observed running, retain the slot as `awaiting_start_evidence` and obtain a signed operator resolution based on actual turn evidence. Collection is not business success. Use `verify --task ID --input /private/testing/evidence.json` with independent evidence:

```json
{
  "version": "actual-running-version",
  "reviewer": "independent-verifier",
  "assisted": false,
  "checks": [{"kind":"mcp-readback","reference":"private-evidence-reference","passed":true,"expected":"synthetic expected assertion","actual":"independently observed assertion"}]
}
```

Check kinds: `mcp-readback`, `native-view`, `service-assertion`, `denial-no-side-effects`. A failing check also requires `failureCategory`: `connection`, `permission`, `capability`, `handoff`, `recovery` or `unusable-result`. The reviewer cannot be the tested actor. Evidence references stay private and must correspond to actual independent observations; the schema is not itself a verifier. Do not auto-convert an actor's text or a successful process exit into a pass. If client evidence is unavailable, leave the task awaiting verification.

`pause` blocks new dispatch; it does not kill active agents. Inspect/collect those before an environment update. `resume` preserves all reservations. No schedule is installed. A future operator may invoke `coordinator` from an explicitly authorized external Paseo schedule; this delivery only supplies the opt-in entrypoint. End coordinator turns when waiting for a human or evidence, then explicitly wake them when the prerequisite is available.

## Human-approved Maintenance

Convert the failure into a minimal, semantically redacted synthetic technical reproduction before creating a repair. The human must inspect this exact packet; arbitrary text fields cannot be automatically proved free of business information. Packet schema:

```json
{
  "component": "technical component identifier",
  "repository": "/source/praxis",
  "baseRevision": "0123456789abcdef",
  "reproduction": "Minimal synthetic reproduction; no business content or external record links.",
  "expected": "Technical invariant",
  "actual": "Observed invariant violation",
  "files": ["src/example.mjs", "tests/example.test.mjs"],
  "verification": ["A targeted synthetic check and any authorized test-environment release check"]
}
```

The repository must equal a configured Maintenance cwd. Configure additional app source workspaces as an optional `maintenanceTargets` array of `{workspaceId, cwd, host?}` bindings; each repository path must be unique. A repair selects its binding by the approved `repository`, preserving the business sessions. Respect owning app repositories: publish the child revision before a platform pin. Do not fix app code in the parent. Technical docs/tests needed by the repository policy belong in the explicitly approved file scope; a newly discovered wider scope requires another approval. Never include the campaign topic, actor identities, research/investment/travel content, screenshots, raw business logs, credentials or private source documents.

```sh
node tests/ai-native/cli.mjs repair --state /private/testing/campaign.sqlite --tasks FAILED_TASK_ID --input /private/testing/technical.json
node tests/ai-native/cli.mjs approval-request --state /private/testing/campaign.sqlite --request REQUEST_ID --out /private/testing/review.json
```

Transfer only the review packet to the **human operator**, who inspects it and runs under the separate identity:

```sh
node tests/ai-native/cli.mjs sign --input /operator/review.json --key /operator/private.pem --out /operator/approval.json
```

Return only the signed approval, then dispatch:

```sh
node tests/ai-native/cli.mjs maintenance --state /private/testing/campaign.sqlite --request REQUEST_ID --input /private/testing/approval.json
```

Approval binds run ID, request ID, exact canonical packet SHA-256 and expiry (at most 24 hours from dispatch). It is consumed before the Paseo call, cannot be reused, and never authorizes another invocation. Every repair starts a fresh technical-only Maintenance session. A rejected or unsuccessful completed invocation can be `reject`ed with a reason, then a new `repair` and fresh approval prepared. Packet changes need a new request; old signatures cannot authorize it. The normal client shell remains available; the approval key separation, not prompt secrecy, protects this gate.

Collect the finished maintenance invocation. Submit `release --request ID --input RELEASE.json` containing `version`, source `commit`, synthetic `verification` reference and actual test-environment `deploymentEvidence`. No business body is accepted there. Then `retry --task ID --reason TEXT`; it resumes the original actor at the original breakpoint on the specified running version. Evidence must match that version. A failed retest cannot loop on the same repair version: prepare a new repair/approval. An unrelated transient connection failure permits an explicit reasoned retry without Maintenance; other failures remain blocked. Initial framework implementation is authorized by the user's implementation request; future campaign maintenance still requires each signed confirmation.

## Interrupted or uncertain dispatches

SQLite transactions serialize reservations across processes; the slot never expires automatically. The reservation is committed before any Paseo create/send. A lost CLI receipt leaves `uncertain` status. `reconcile --dispatch ID` finds a newly created session using the opaque dispatch label, validates identity/model and adopts a single exact match. Zero or multiple matches leave it blocked. A lost send acknowledgement requires operator evidence; idle status cannot prove that a queued message was delivered or never accepted.

For manual resolution, inspect actual Paseo queue/timeline evidence outside Maintenance. Prepare a private review file with `resolution` containing exactly `runId`, `dispatchId`, `agentId`, `decision`, `evidence`, `expiresAt`. Decision `delivered` identifies the original `agentId`; `not-dispatched` uses `agentId: null` and requires positive evidence that no request remains queued, running or committed. The human reviews/signs with `sign`, then `resolve --input SIGNED.json` verifies it. Delivered work still needs identity inspection, collection and business verification; non-dispatched work keeps its failed attempt. A consumed maintenance approval stays consumed: use a new request and approval. Do not cancel/release a slot merely because enough time passed.

## Metrics and limits

`report --lang en|zh` emits localized summaries and stable JSON field names. Coverage cells are campaign step IDs; the initial 27 cells include each of the nine actors onboarding/reconnecting and three explicit cross-scope denial cases, as well as the business workflows. The denominator has a version. `exclude --task ID --reason TEXT` records N/A and changes its version; retain a reason and do not hide product defects as N/A. Coverage is attempted applicable cells / applicable cells. Acceptance is latest passed cells / attempted applicable cells. Failed and pending cells remain distinct; unstarted cells remain `not_run`. History retains every attempt. Autonomous completion counts passed unassisted tasks / attempted tasks; repair recovery counts passed repair-linked tasks / repair-linked tasks. No observations yield `null`, not 100%.

This is the initial behavior matrix, not exhaustive UI/API coverage. Expand it from observed gaps with reviewed bilingual source changes. Deterministic controller tests do not prove real client onboarding, human usability, trading profitability, physical-phone acceptance, cross-user load or all-app capability completion. Record actual evidence for each. Missing Intelligence writes, Polaris business visibility or Calendar sharing are capability gaps, never a reason to elevate an actor or manufacture records. All source checks and the actual campaign execution ledger are separate.
