# Verification plan and evidence

English procedure · [简体中文 and chronological results](VERIFICATION.md)

Use the published API/MCP contract for exact paths and fields. Record source tests, scoped business actions, cloud recovery and physical-device tests separately. The Chinese ledger retains dated results and version-specific evidence for these cases. The case IDs and historical test totals refer to the builds recorded there.

## Roles and test data

Maintenance may change authorized code, documentation, tests and configuration, run temporary synthetic fixtures and review redacted evidence. Live business records are operated on only by a separately authorized business client using the owning app's scoped API/MCP. Maintenance cannot use files, SQL, privileged scripts, owner credentials or an unrestricted subagent to change those records.

The isolated Paseo Codex business agent uses a separate service identity, credentials, workspace, environment and audit trail. It has no source checkout, host shell, arbitrary filesystem access, direct app CLI/SQL, management UI, Docker socket, backup keys or arbitrary network exit. A phone app has its own identity and consent. A trusted read-only verifier may check underlying versions, counts and keyed digests while excluding record bodies and credentials from maintenance output.

Use an explicitly designated test space and synthetic records tagged with `run_id`, or the particular records the user authorizes. Each appropriately scoped actor creates its own negative-control fixtures. Test at least two personal users, two family/company members, assigned versus unassigned tasks and read versus write scopes. Supply only the opaque identifiers required by each actor.

## Cases

| ID | Method and acceptance |
| --- | --- |
| C01 | Discover the actual Paseo host, provider, model and effective runtime profile. Start the independent business actor in the isolated environment. Record server, workspace and agent identifiers and verify actual provider/runtime metadata. Validate mount, tool and egress restrictions with harmless assertions before doing business work. A model name, worktree or prompt alone is insufficient. Configure secrets outside the model context. |
| C02 / I01 | Establish HTTPS, MCP version/transport and client authorization. Discover capabilities as the current identity, execute the actual published contract and verify the server also rejects unknown or unauthorized calls. Check browser/API/MCP semantics against the same source of truth and separate public metadata from protected business operations. |
| R01 | With a scoped agent, list, create a tagged synthetic Reminder item, read it back, update against its revision, complete it, verify persistence and delete only authorized test items. Correlate client read-back with an independent service assertion. |
| T01 | An authorized owner supplies a synthetic TingProof assignment. A guest reads the attached authorized material, submits a correction before expiry and reads it back. Check a second task and other project resources are denied, including search, attachments, audio and export where supported. Revoke access and verify accepted output remains in its owning space. |
| A01–A05 | Test personal separation, family/company membership versus personal records, specific guest/resource grants, allowed actions versus disallowed ones, and client/space isolation. For every denial verify both the response and unchanged versions/counts/digests. Membership alone must never reveal another person's data. |
| A06 | Exercise deadline, revocation, account disablement and actions already in flight. Test browser/API/MCP/subscription and worker behavior as applicable. Validate the promised linearization window, including denial after a successful revocation response. Previously delivered bytes may remain on the client. |
| S01 | Two authorized members see create/update/complete events only after commit. On the specified synthetic load and normal network, measure server acknowledgment to peer visibility against the two-second target. Record the environment and observed latency. |
| S02 | Two clients write from the same revision. A conflicting writer gets 409 or an explicit conflict and retains its draft. Separate records can be saved independently. Reread before resolving. |
| S03 | Drop the response after commit, retry with the same key, then change the input while reusing the key. Require exactly one effect and correct rejection of mismatched input. |
| S04 | Disconnect, reconnect, restart and test valid and expired cursors. Catch up or reread current authorized state. After withdrawal, existing subscriptions and replay queues must not disclose or mutate protected resources. |
| S05 | Interrupt or rate-limit the replica, then restore connectivity. Local commits and collaboration continue, pending work survives and is verified after catch-up. Test with a synthetic target. Real cloud restore belongs to B01. |
| M01–M03 | On a physical third-party agent app, verify support for the actual account/version and record provider, OS, network and connection route. Bind the user, grant specific space/task/actions/expiry, create/update/read a synthetic record, test a cross-scope denial, revoke and retry. Correlate phone evidence with the service trace and business outcome. The phone's browser, emulator, desktop agent and model API cannot stand in for this test. |
| X01 | The scoped business actor cleans up only the resources from its authorized test run. After a revocation test use a separately limited cleanup identity or a fresh formal grant. Record remaining resource pseudonyms if cleanup fails. |
| D01 | Verify an actual local Docker cutover, data preservation, service health and rollback eligibility. [Docker guide](DOCKER.en.md) |
| B01 | Copy to a real configured cloud target, check integrity and restore into a new empty directory. An available credential, healthy worker or local trial restore alone does not establish this result. [Storage guide](STORAGE.en.md) |

For an external phone app, first verify the user's actual app version, account access and supported integration route. If the first candidate cannot connect, record the reason and run the same cases on an actually supported alternative. At least one independent physical-phone app must pass for that acceptance claim. Keep offline views truthful about read-only state.

## Evidence and status

Every test needs `run_id`, case and requirement IDs, actual caller/provider, build and protocol version, pseudonymous principals and scope, trace and decision, versions and outcome digest, expected and actual outcomes, timing, cleanup and result. Use service-generated keyed digests for sensitive low-entropy values. Maintenance does not receive the digest key, raw request/response, reusable links, credentials, private attachments or identifiable screenshots.

Use **not run**, **prerequisite unavailable**, **running**, **passed** or **failed**. A denial also needs evidence of no side effects. Record separate failures for unauthorized access, secret disclosure, unproven isolation, unauthorized background writes, duplicates, silent overwrites or incomplete cleanup. Preserve failed results and rerun the affected scope after a fix.

The v0.1.17 ledger records a real scoped Paseo Codex Reminder round trip with cleanup and post-revocation 401, a local Docker cutover, and a real Jianguoyun round trip using a designated synthetic space. It records independent multi-member and physical third-party phone tests separately. Later entries cover unified login, Travel updates, Knowledge access/import/document versions, Slides and Finance. Read the dated evidence for the build and capability under review; historical test totals do not prove new behavior. [Chronological ledger](VERIFICATION.md)

### Historical case ledger

| Case | Result at v0.1.17 | Scope of the evidence |
| --- | --- | --- |
| C01, C02 | Actor isolation passed. Protocol discovery and denial passed. | The environment exposed the scoped tools and enforced mount and egress limits. Public ingress had a separate outstanding connectivity check. |
| I01, R01, A01 | Reminder slice passed. | Listing, creation, read-back, edit, completion, routine execution and cleanup were correlated with service assertions. The other personal space remained inaccessible. |
| A05, A06 | Partial. | The independent actor lacked host and direct-storage access. Revocation produced 401 on the existing MCP connection. Identity spoofing and in-flight behavior had additional isolated tests. |
| S02, S03 | Partial. | The service rejected a stale revision and a reused idempotency key with different input. Chromium fixtures covered conflict drafts and identical retries. |
| T01, A02–A04, S01, S04, S05, M01–M03 | No completed field test in this ledger. | Keep per-client scope, physical-device evidence, live multi-member delivery and replication interruption distinct from code tests. |
| X01 | Independent Reminder client cleanup passed. | The actor removed the three synthetic resources from its run. Read-back confirmed an empty test space. |
| D01 | Partial. | The Docker stack retained data across a service restart and survived closing the terminal. A complete rollback to native processes was still untested at this milestone. |
| B01 | Passed against synthetic data on a real replica. | After encrypted copy, the check read all data. A restore into an empty directory preserved JSON hashes and the committed WAL records. SQLite quick-check succeeded. |

### Subsequent integration checks

- **Unified sign-in (F34).** At the November 13 milestone, 326 platform checks passed. Browser checks exercised the login form, account-specific app visibility, denied access to another app’s documents and 401 after logout.
- **Travel (F52).** The initial whole-itinerary replacement was rolled back after review. The next contract allowed updates to selected fields on an authorized place. The 441 platform and 108 Travel checks covered conflicting versions, repeated requests, resource and action boundaries, revocation, and consistent rendering by the HTML and map views. Read-back after restart confirmed persistence.
- **Knowledge and Projects (F62/M63).** A scoped client could read the authorized project and submit a snapshot to one library. The test also exercised resource discovery, rejection outside the grant, the event outbox and history. At the November 15 milestone 497 platform checks, 23 Knowledge checks and 22 Projects checks passed, alongside native and standalone browser tests.
- **Slides (v0.1.62–64).** Independent permissions covered authoring, notes, rendering and export. Preview image sizes and hashes, PDF and editable presentations were separate assertions. Producing a PNG attachment did not establish that a model saw or reviewed the image. The native integration checks covered template protection, resource isolation, chunked assets, authenticated range requests, CAS, idempotency, job revocation and template reset.
- **Finance and Knowledge (v0.1.65–70).** Finance used a synthetic ledger for its three native views. Knowledge proceeded from document-level isolation to targeted edits, generated contents, per-operation discovery and chapter navigation. The acceptance steps compared saved versions and earlier hashes, exercised both root and prefixed builds, and checked reader layouts at 320–1440 px and larger text sizes. The detailed per-version test counts are in the Chinese ledger.

## v0.1.114 source checkpoint · 2026-11-19

This checkpoint records source and synthetic checks. Production rollout and read-back remain a separate release record.

- All fourteen application worktrees were clean. Each selected revision contains its app-owned `praxis-provider.mjs`; the documentation index links to those revisions. Platform packaging includes all fourteen modules, with native image copies and video-engine removal covered by the packaging checks.
- The final integration run passed **372 platform checks**, including **13 collector checks**. Explicit `io.praxis.app` and `io.praxis.role` labels select an installed app before inspection; conventional service aliases remain supported. Unknown labels and unrelated services are excluded.
- Synthetic provider and HTTP checks cover source-backed cards, resource/owner isolation, preference persistence and conflicts, existing-installation provider upgrades, native TingProof assignment access and runtime observation metadata. Runtime coverage is distinct from an application commit or MCP read-back. Browser checks use fictional data. These results do not establish a new physical-phone, live business-client or cloud-restore acceptance result.

Anonymous checks of the final parent commit and production entry-point verification belong to the publication and deployment checkpoints.

## v0.1.115 deployed checkpoint · 2026-11-19

- The final source run passed **376 platform checks**, with no failures or skipped checks. Both current PRDs opened through the workbench reader. Synthetic desktop and phone-width browser checks covered the approved thirteen-source card design, private Later/Hide/Undo, revision changes, source evidence and Home returning to the same card and scroll position. Polaris supplies runtime observations rather than cards.
- Private-reader HTTP regression checks distinguish the configured document owner, a different administrator and an ordinary member. Only the configured owner discovers Letters/Profiles card modules and saves their personal presentation preferences. A missing collector binding does not erase a static reader's declared read-only directory mapping.
- The managed local workbench and Core run **0.1.115**. Blue is the single active writer; green is healthy and available for rollback. TingProof's compiled native interface and the permission-limited Polaris observer were rebuilt and deployed. All **39** containers run: **30** are healthy and **9** have no healthcheck. The **31** unrelated containers were not replaced. Existing data binds and network modes were preserved. Consistent platform and TingProof database checkpoints were retained privately.
- Production administrative read-back confirmed the existing account's fourteen native entry HEAD responses against the prior baseline, four permitted browser-provider modules, and fourteen current data-inventory sources with no unavailable source. Six protected routes reject anonymous access. Runtime Trace enumerated **90/90** observations with exact native references; the read-only observation source digest is unchanged. The internal observer metadata route remains blocked through the public app gateway. The host metadata watcher publishes current declared paths and mount metadata without Docker access inside Core.

These checks read deployment and authorized platform metadata, not business document bodies. They do not establish a new live business-client write/read-back, physical-phone third-party client or cloud-restore result. Browser-owned cards still require their native browser account and current app context; a source with no authorized records is genuinely empty.
