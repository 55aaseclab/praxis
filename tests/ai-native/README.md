# Long-lived AI-native testing

English · [简体中文](README.zh-CN.md)

This is an opt-in external-client harness, not a Praxis-internal agent. [Platform PRD ANT01–ANT10](../../docs/PRD.en.md#long-lived-ai-native-testing) defines acceptance. `npm test` runs deterministic synthetic harness checks and never starts Paseo agents. No campaign, schedule, real transaction or deployment is created by installing, importing or initializing it.

## Layout and roles

`campaigns.mjs` contains three bilingual campaigns, nine stable personas, a finite coverage matrix and persisted seeded contextual variations. `controller.mjs` owns private durable SQLite state and dispatch/approval transitions; `adapters/paseo.mjs` uses the public Paseo SDK for creation, metadata and send-message communication, plus CLI discovery/reconciliation without shell interpolation; `runner.mjs` reserves before external execution. `prompts.mjs` keeps business and maintenance inputs separate. The coordinator reads the [skill](../../skills/ai-native-testing/SKILL.md).

| Campaign | Actors | Apps and continuity |
| --- | --- | --- |
| Family travel | Planner, explorer, comfort-minded member | Travel, Reminder. Same three people and records across destinations; feedback, personal preparation and actionable shared reminders. Thirty initial destinations do not end the campaign. |
| AI-era vulnerability management | Mentor/student in Research; engineer in Productization; Marketing; Finance/support | Reminder, Knowledge, Lattice, Memo, Polaris, Projects, Intelligence. Demand → research → engineering → market delivery/feedback → finance/support, with returns and revisions. Research belongs to a synthetic school entity, the other groups to a synthetic company. |
| Full-time simulated investor | One investor | Reminder, Memo, Intelligence, Polaris. CNY 1,000,000 starting capital, 10% target net return. Market/horizon/asOf are mandatory before a round can start; trading, fills, fees and funds are synthetic. |

Models are exact: coordinator `opencode/hexhive005-main/zai-org/GLM-5.3-Flash`; workers `opencode/hexhive005-work/zai-org/GLM-5.3-Flash`; maintenance `codex/gpt-6.1-sol`, thinking `ultra`, provider default context window (no override). Discovery rejects unavailable exact models instead of substituting. Main and Maintenance are separate from the global one-worker slot; while Maintenance is reserved/running, new business work is blocked to avoid testing a changing environment. Every invocation requires human approval. There is no worker token budget or fixed campaign expiry. Quota/provider failures retain progress; they do not permit blind retries.

Test configuration includes `fullAccess: true` and `communication: "paseo-send-message"`. OpenCode sessions receive the discovered `auto_accept: true` feature in build mode before the first task; Codex uses full-access. Ordinary tool permissions do not interrupt the human. Real questions and per-invocation Maintenance approval remain interactive. Creation configures an idle session first, then sends the task using the public SDK `agent.send`; follow-ups also use send message. Use the public SDK/MCP send operation or `paseo send` for agent reports, questions and coordination, not another agent's files or polling logs. App readback/state checks remain verification, not a message transport. Never wake extra idle workers outside the reserved slot. For remote bindings, `host` must be a reachable ws/wss/tcp URL or host:port endpoint (for SSH, supply an already forwarded endpoint); do not embed credentials. Existing installs can run `configure-runtime --state /private/testing/campaign.sqlite` to persist these defaults without resetting actors or attempts; already running OpenCode sessions need the public Paseo Auto Accept setting enabled once.

Personality influences choices, not a fixed script. Context draws have stable seeds and are persisted per task, making the stimulus reproducible without promising deterministic model output. Each actor receives its own persona, goal and new contextual information, not another actor's private conversation. Workers retain normal shell, local files, browser/network and OAuth/MCP setup tools. Real public information may be researched. Business accounts, data and actions remain isolated synthetic fixtures under actual service-side authorization.

## Configure without launching

Use Node 22.16+ with SQLite and the installed Paseo CLI. One state file defines the **global slot for this campaign installation**; do not run separate copies to bypass it. Keep state, configs, approvals, evidence and client working files outside Git. The SQLite file is mode 0600; new parent directories use 0700. The state is not app storage and requires no approval key. Protect its directory under the intended coordinator identity.

Create independent Paseo workspaces for the coordinator, all nine actors and Maintenance. Give actors their own business accounts and scoped OAuth/MCP connections to the designated test installation; never copy administrator or backup credentials to them. The coordinator gets harness access, not authority to repair code. Maintenance gets only its source workspace and synthetic fixture environment. Discover Paseo hosts/profiles first; there were no configured profiles at source verification, so exact discovered provider/model IDs are used. An optional `host` in each binding selects the CLI endpoint; paths/workspace IDs belong to that endpoint. Do not embed credentials in host strings.

Account creation, team setup, consent and business operations use **publicly supported UI, documented public APIs or public MCP only**. Do not use internal/undocumented endpoints, administrator bootstrap, SQL, privileged helpers or server files to fill gaps. Normal client tools and documented local harness commands remain available. Missing public setup is a test result, not a reason to pre-create accounts behind the client.

Human approval happens in Paseo. No key generation, signing service or operator key setup is required to start testing.

```sh
npm run ai-native -- config-example
npm run ai-native -- help --lang zh
```

Use `config-example` as a template, replace workspace/path values and set the canonical public HTTPS `origin`. Remove `investment` until its actual market, horizon and ISO information cutoff are chosen. The nine actor keys are fixed and each role needs its own workspace. Configuration contains no OAuth tokens: set those up directly in each authorized client. Then:

```sh
node tests/ai-native/cli.mjs init --state /private/testing/campaign.sqlite --input /private/testing/config.json --lang en --seed campaign-1
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign family-travel
node tests/ai-native/cli.mjs round --state /private/testing/campaign.sqlite --campaign security-research
node tests/ai-native/cli.mjs report --state /private/testing/campaign.sqlite --lang zh
```

Initialization is paused. The investor round refuses to start without its parameters. Rounds are sequential within each campaign; another campaign may progress while one is blocked. After destination 30, explicitly supply another `--destination`; no reset or completion is implied. Subsequent investment rounds retain the same initial-capital reference, account and ledger; they never replenish capital or use information after the configured cutoff. After an accepted investor round, `advance-investment --as-of ISO` explicitly advances to a later, already elapsed cutoff, records the change and retains the same actor, capital and ledger. It refuses an unfinished round, backward time or future information. Changing the market/horizon requires a separately reviewed campaign configuration; do not silently rewrite an active experiment.

## Start and advance through Paseo

Only after the test installation, identities, credentials are ready:

```sh
node tests/ai-native/cli.mjs resume --state /private/testing/campaign.sqlite
node tests/ai-native/cli.mjs coordinator --state /private/testing/campaign.sqlite
```

This starts or resumes the main-model coordinator in its assigned workspace. It uses `status`, `next` and `dispatch --task ID`, then `collect --dispatch ID` when the actor has ended its turn. Original role sessions are retained in state and resumed. Actual provider/model/mode/cwd are checked before resuming and collecting. Workspace binding is explicit on creation. Paseo does not create permissions merely from a prompt: independently verify real OAuth discovery, grants and app outcomes under C01 and subsequent verification cases.

`collect` requires this dispatch to have been observed running before an idle/error state can release its slot; an idle queued recipient cannot release it. If a very short turn was never observed running, retain the slot as `awaiting_start_evidence` and obtain an explicit human resolution in Paseo based on actual turn evidence. Collection is not business success. Use `verify --task ID --input /private/testing/evidence.json` with independent evidence:

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

The coordinator presents the exact technical packet and scope through its normal user-question tool in Paseo, or in the Paseo conversation when the tool is unavailable. The human approves or rejects there. While unanswered, Maintenance stays blocked; a question asking what something means is not approval. The user does not sign files or configure keys.

Only after the actual explicit human reply, the coordinator records its question ID, original answer, reply reference and decision in a private JSON file:

```json
{"questionId":"ID returned by approval-request","replyReference":"paseo:user-message-or-permission-reply-id","answer":"Approve this Maintenance invocation","decision":"approve"}
```

```sh
node tests/ai-native/cli.mjs approve --state /private/testing/campaign.sqlite --request REQUEST_ID --input /private/testing/paseo-reply.json
node tests/ai-native/cli.mjs maintenance --state /private/testing/campaign.sqlite --request REQUEST_ID
```

Use `decision: "reject"` for a refusal; never invent or self-approve a human answer. This is an auditable workflow record, not an adversarial identity boundary against a client that can alter the harness/state. Confirmation binds the question and exact packet hash, is consumed before the Paseo call and cannot authorize another invocation. Every invocation starts a fresh technical-only Maintenance session. Rejected or unsuccessful completed work can be `reject`ed with a reason, then a new repair/question prepared. Changed scope needs a new question and human answer. The initial source correction is authorized by the user's explicit instruction to use Paseo questions; future maintenance still requires per-invocation confirmation.

Collect the finished maintenance invocation. Submit `release --request ID --input RELEASE.json` containing `version`, source `commit`, synthetic `verification` reference and actual test-environment `deploymentEvidence`. No business body is accepted there. Then `retry --task ID --reason TEXT`; it resumes the original actor at the original breakpoint on the specified running version. Evidence must match that version. A failed retest cannot loop on the same repair version: prepare a new repair/approval. An unrelated transient connection failure permits an explicit reasoned retry without Maintenance; other failures remain blocked. Future campaign maintenance still requires each explicit human confirmation in Paseo.

## Interrupted or uncertain dispatches

SQLite transactions serialize reservations across processes; the slot never expires automatically. The reservation is committed before any Paseo create/send. A lost CLI receipt leaves `uncertain` status. `reconcile --dispatch ID` finds a newly created session using the opaque dispatch label, validates identity/model and adopts a single exact match. Zero or multiple matches leave it blocked. A lost send acknowledgement requires operator evidence; idle status cannot prove that a queued message was delivered or never accepted.

For manual resolution, inspect actual Paseo queue/timeline evidence outside Maintenance and ask the human in Paseo. A private file has `resolution` containing exactly `runId`, `dispatchId`, `agentId`, `decision`, `evidence`, `questionId`, `replyReference`, `answer`. Decision `delivered` identifies the original agent; `not-dispatched` uses `agentId: null` and requires positive evidence of no queued/running/committed request. Record the actual human answer, then `resolve --input RESOLUTION.json`. Delivered work still needs identity inspection, collection and business verification; non-dispatched work keeps its failed attempt. A consumed maintenance confirmation stays consumed. Do not infer nonexecution from time or idle status.

## Metrics and limits

`report --lang en|zh` emits localized summaries and stable JSON field names. Coverage cells are campaign step IDs; the initial 27 cells include each of the nine actors onboarding/reconnecting and three explicit cross-scope denial cases, as well as the business workflows. The denominator has a version. `exclude --task ID --reason TEXT` records N/A and changes its version; retain a reason and do not hide product defects as N/A. Coverage is attempted applicable cells / applicable cells. Acceptance is latest passed cells / attempted applicable cells. Failed and pending cells remain distinct; unstarted cells remain `not_run`. History retains every attempt. Autonomous completion counts passed unassisted tasks / attempted tasks; repair recovery counts passed repair-linked tasks / repair-linked tasks. No observations yield `null`, not 100%.

This is the initial behavior matrix, not exhaustive UI/API coverage. Expand it from observed gaps with reviewed bilingual source changes. Deterministic controller tests do not prove real client onboarding, human usability, trading profitability, physical-phone acceptance, cross-user load or all-app capability completion. Record actual evidence for each. Missing Intelligence writes or Polaris business visibility are capability gaps, never a reason to elevate an actor or manufacture records. All source checks and the actual campaign execution ledger are separate.
