# Storage and recovery

English · [简体中文](STORAGE.md)

Each app writes to its local working data. The storage coordinator takes consistent snapshots, encrypts them and maintains independent repositories. WebDAV is a replica transport. NAS can also host a replica. Before using NAS for live data, verify the app's locking and durability on that filesystem.

## Workspace identity and layout

Select the mode-600 private configuration using `~/.config/praxis/storage.json`, `PRAXIS_STORAGE_CONFIG` or `--config`. Keep configuration, passwords, snapshots, repositories and runtime state outside Git.

```text
~/.config/praxis/
  storage.json
  secrets/
    local-repository-password
    jianguoyun.json
    jianguoyun-repository-password
<dataRoot>/
  workspaces/<workspaceId>/apps/<appId>/
  workspaces/<workspaceId>/.praxis-storage/
  repositories/<workspaceId>/local/
Cloud or NAS: praxis/<workspaceId>/
```

The workspace UUID survives host and provider changes. `deviceId` identifies a machine and `activeWriterDeviceId` the sole machine authorized to publish a new snapshot. `primaryRepositoryId` is local. `preferredRepositoryId` sets the default verification and restore source. Switching a replica does not change the app's live paths. Existing deployments may register their actual live paths in `appSources` before relocating anything. Stop writers, export consistently, verify and perform an explicit handover before moving live data.

## Snapshot coverage

| App | Server data and separately handled material |
| --- | --- |
| Reminder | Schema-v2 JSON and entries. The server and CLI use one source. Exclude lock and temporary files. |
| TingProof | SQLite backup includes committed WAL data. Original audio can be registered as a media directory; users must reconnect browser file handles. |
| Lattice / Slides | Preserve decks, assets and operational `.lattice` state. Exclude dependencies and explicitly rebuildable outputs. The separately registered `apps/slides-business/` includes atomic JSON decks, revisions, jobs and content-addressed objects. |
| Travel / Knowledge | Separate content directories, photos and structured data. Register Knowledge revisions and managed itineraries in their respective formats. Keep signing and provider credentials outside business content. |
| Memo | `memo.db` holds guides, records, photos and history. Previously unimported browser records require device import or a complete JSON export. |
| Finance | JSON in an explicitly mounted work directory. The former named volume remains a frozen recovery source. |

Validate copies of JSON. Use the SQLite Online Backup API. Check directory stability before and after copying; if data changes, reject that snapshot. A Git bundle preserves local unpublished source commits. Include working changes and untracked files only from approved source paths. Record what's included and omitted.

Each snapshot contains `manifest.json`, `apps/` and `source/`. The manifest identifies the workspace, writer, snapshot and parent, and records file sizes and SHA-256. Run `restic backup .` from the export directory to preserve relative paths. Delete temporary plaintext exports after the encrypted backup succeeds. A failed export remains in private staging for inspection.

## Initialization and routine commands

Use Node 22.16+, restic and rclone. The Chinese runbook records restic 0.19.1 and rclone 1.76.0 as verified versions. Check official binaries against their SHA256SUMS. Configure absolute `resticBinary` and `rcloneBinary` paths as needed. Container overrides `PRAXIS_RESTIC_BINARY` and `PRAXIS_RCLONE_BINARY` are process-local. Unit tests run without restic; actual repository integration tests report their prerequisite.

```sh
node scripts/storage.mjs init
node scripts/storage.mjs status
node scripts/storage.mjs snapshot
node scripts/storage.mjs sync
node scripts/storage.mjs check --repository local
node scripts/storage.mjs restore --repository local --target /path/to/new-empty-staging
node scripts/storage.mjs watch
```

Initialization creates a random local repository password and an encrypted repository. It scans no business data. Register a nonempty `appSources` before taking a snapshot. The configuration has `schemaVersion: 1`, workspace/device/writer UUIDs, `dataRoot`, primary and preferred repository IDs, `intervalSeconds`, `repositories`, `appSources`, `sourceRepos` and `coverage.omitted`. The Chinese counterpart includes a complete placeholder JSON example.

Local repositories have `id`, `type: "local"`, `path` and `passwordFile`. A source has `id`, `kind` (`json`, `sqlite` or `directory`), `source` and `target`. For schema-v2 Reminder JSON add `schema: "reminder-v2"`. One app may have multiple nonoverlapping targets. A source repository has an ID, checkout path and approved relative paths. List unexported browser data and unregistered audio as omissions.

By default `watch` snapshots locally once an hour and then synchronizes targets independently. If content, schema, source version and coverage are unchanged, verify and reuse the snapshot and update `lastVerifiedAt`. Data or writer changes create a new historical version. `status` reads local state with per-target `unconfigured/pending/success/failed`, last successful snapshot, pending snapshot and error code. `sync` exits 2 for failed or unconfigured targets and 1 for an operation error. Logs omit raw subprocess errors, arguments, passwords and provider response bodies.

## Adding a replica

Each target uses an independent encrypted repository and password. Create mode-600 password and target files outside Git, then register the target and perform a trial restore:

```sh
node scripts/storage.mjs add-target --file /absolute/private/target.json
node scripts/storage.mjs sync --to cloud
node scripts/storage.mjs check --repository cloud
node scripts/storage.mjs restore --repository cloud --target /path/to/cloud-trial-restore
```

For Jianguoyun, set `id`, `type: "jianguoyun"`, `remotePath: "praxis/<workspaceId>"`, `passwordFile` for the restic repository and `credentialsFile` for the provider. Its credentials file contains `username` and a third-party `applicationPassword`. Missing values produce an unconfigured state without a cloud call. The coordinator passes the password to `rclone obscure` on stdin and the temporary remote settings through the subprocess environment. restic supplies encryption.

On first use, issue WebDAV MKCOL only under the configured workspace namespace. Accept 201 or 405 for an existing directory. Reject redirects. An explicit `AncestorsNotFound` can mean an uninitialized repository; an ordinary 409 still fails. Native requests are rate limited and cancelable.

The documented adapter settings use one concurrent operation, 0.1 requests/second per rclone process and target 8 MiB packs. Cross-repository copy can involve two transfer processes. Other clients share the provider quota. The integration was designed around a 500 MB default file limit, 600/1,500 requests per half hour on free/paid accounts, and up to 750 entries per listing. Check the provider's current limits before deployment. A directory listing of 749 items fails closed, allowing space for the directory itself. Retry transient failures up to three times. Distinguish authentication, repository-password and listing-limit errors from transient ones. [Provider limits](https://help.jianguoyun.com/?p=2064)

For NAS use a separate mounted `path` and `passwordFile` with `type: "local"`. For another rclone-backed target use `type: "rclone"`, its configured `remote`, `remotePath`, `rcloneConfigFile` and `passwordFile`. Keep rclone configuration in an external mode-600 file. Two generic rclone remotes used in one direct copy must share a configuration file. Verify separate hardware and provider quota; two directories on the same disk share a failure mode.

## Conflicts, history and handover

Copy snapshots between encrypted repositories with restic `copy`. Initialize a new target with `init --copy-chunker-params` to reuse chunking parameters with an independent key. Repeated runs reuse uploaded content. The coordinator does not run destructive synchronization, bidirectional merging, pruning, forgetting or forced unlock.

Check reachable repositories' workspace, writer and parent chain before publishing or copying. Refuse divergent children of one parent, the same snapshot ID with different trees, a missing parent, an unauthorized writer or a source behind a known replica. Preserve the branches for review. A disconnected target cannot be checked for a concurrent branch until it reconnects. Keep prior snapshots even after an app deletion. A future retention policy must establish complete enumeration and retain a verified copy.

To change providers, add the target first:

```sh
node scripts/storage.mjs migrate --from local --to other-cloud
```

Persist progress through copying, checking, verified and completed. Switch `preferredRepositoryId` only after all history copies, `check --read-data`, an empty-directory restore and SHA-256/schema/SQLite validation. Keep the old repository and local primary intact.

To change machines:

1. Stop old app writers, scheduled agents and other write entry points. Make and copy a final consistent snapshot.
2. Transfer configuration and decryption keys separately and securely. Restore into an empty directory on the new machine and verify app data and source versions.
3. Assign a new device UUID. From the old coordinator run `writer-handover --to-device UUID --source-stopped` when all configured replicas are reachable and contain the latest snapshot.
4. The old configuration retains its old `deviceId`, so it cannot continue publishing. Transfer the handover state to the new host and set its new device ID and local paths. Preserve `workspaceId`, `activeWriterDeviceId` and all `writerHistory`.
5. Connect the new services to verified data. Check the actual pages and CLI before changing the entry. Preserve the old data for recovery.

The handover fences the writer at the named snapshot. The next child must come from the new device. `--source-stopped` is an operator assertion, not remote proof. Do not take over automatically when the old machine is unreachable.

Restore only into a new empty directory outside active apps, repositories and coordinator state. Resolve symlink parents before checking overlap. A successful restore starts no services and changes no active source. Keep a failed staging directory for investigation, then retry in a new one. Protect recovery keys independently and offline. Losing the sole key prevents decryption. Keep plaintext recovery kits outside app sources, repositories, checkouts and staging areas so that later snapshots cannot include their own keys. Update machine-specific source and binary paths when restoring a template. [Restic repository preparation](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)

## Coverage, registration and verification

```sh
node --test tests/storage-registry.test.mjs tests/storage-snapshot.test.mjs tests/storage-status.test.mjs
```

The historical integration suite exercised independent keys, repeated synchronization, Chinese content, exact restore paths, history, wrong keys, integrity, trial restore and divergence. Carry these cases into an installation acceptance run with temporary fixtures. Additional cases include missing credentials, provider limits, retry, redaction, locks, WAL and path traversal. Recovery point and time depend on the latest successful snapshot and restore. [SQLite Online Backup](https://www.sqlite.org/backup.html) · [Restic copy](https://restic.readthedocs.io/en/stable/045_working_with_repos.html) · [rclone WebDAV](https://rclone.org/webdav/)

Register the known app sources and source repositories in the private configuration. Preserve custom sources and omissions when updating the list. For a device-local Memo export, validate the complete JSON with the app’s own validator and record its export time. A later browser edit requires a new export. Source audio can be registered as a separate directory. Users still need to reconnect browser file handles.

`node scripts/storage-recovery.mjs /absolute/private/new-recovery-kit` exports a configuration template and decryption material to a new private directory. Secure an independent copy on another device or in a suitable password manager. If retiring a verified replica, save its key and location and remove only its configuration. Keep the active local primary and preferred restore target.

On 2026-11-12, 137 root checks, 34 Memo data checks and six browser checks passed. The storage coordinator created an encrypted snapshot of registered server and source data, checked full reads and restored it into an empty directory. Cloud acceptance remained a separate check. Isolated Docker tests covered cold read-only SQLite files and cancellation with subprocess cleanup. A nonempty journal that cannot safely be read fails the backup.

Space authorization `spaceId` and storage `workspaceId` have different meanings. Family collaboration uses a single server source and authorized event delivery. Hourly snapshots do not establish real-time delivery, event-triggered replication or a cloud recovery guarantee.

## App working roots

Default to `<dataRoot>/workspaces/<workspaceId>/apps/<appId>`. A private storage config can specify `workingData: { "version": 1, "roots": { "memo": "/absolute/private/storage/memo" } }`. Roots must be disjoint from one another, code, credentials, coordinator state and repositories, including via symlinks. A NAS override keeps the single-writer requirement. Browser-only data has separate recovery requirements.

| App | Live data below its root |
| --- | --- |
| Reminder | `reminder.db`, with space-qualified records shared by authorized interfaces |
| TingProof | `tingproof.db`; source audio is a separate input |
| Knowledge | `knowledge.db`, `content/catalog`, published content for the app entry points |
| Travel | `itineraries/travel.db`, original `content/catalog` and derived `content/published` |
| Lattice | `native/decks`, `native/.lattice`, `business/lattice.db` and separate assets |
| Memo | `memo.db` with guides, records, photos and history; old device-local content needs import |
| Finance | Explicitly mounted `finance.db` |
| Projects | `projects.db` shared by project records |
| Intelligence | `intelligence.db` for configured snapshots; explicit source demos keep their fixture |
| Polaris | Read-only observation file in the private workspace. The viewer image and source carry no records. |
| Praxis | `business` for authorization/events and `observations` |

Projects and Knowledge register separate SQLite sources. A missing previously registered database fails closed; the backup worker never manufactures substitute records. Knowledge also keeps immutable sources, revisions, idempotency and outbox events. Keep credentials and older book/photo sources separate. Start the app before the worker reading a newly configured database.

After the Lattice merge, the registered source is `third_party/lattice`. Preserve historical source bundles and control configuration in private recovery storage. A stopped-writer cutover verified size, ownership, permissions and hashes for deck sources and operational state, then rebuilt the viewer cache. The existing business blobs, signing key and resource IDs stayed in place. Register the independent read-only Polaris viewer source and authorized observation file separately. [Viewer storage](POLARIS-VIEWER.md)

Before moving a working root, inventory the sources and stop their writers. Record the current immutable image IDs, deployment state, bindings, working-directory hashes and ownership. Verify a consistent snapshot before switching configuration.

Preserve source files and private configuration after the move. For a same-filesystem rename, check the full inode and size inventory. For a cross-filesystem copy, verify the SHA-256 of each file. Trial restores go into a new empty directory. Missing configured content must fail closed.

For a Finance named-volume migration, inspect the original file after stopping its writer. Keep the original volume as a recovery source. Restore device-only Memo records through the owning app’s import/export workflow. A successful server snapshot cannot establish that every offline device was exported.

Validate relocated mounts from inside each service. For slot pairs follow the paused rebind and startup sequence in the [managed deployment guide](MANAGED-DEPLOYMENT.md). Keep the migration receipt private. [Docker guide](DOCKER.en.md) · [Verification](VERIFICATION.en.md)

## Application-owned integration

Installed apps declare storage aliases, source formats, read-only schema validators, backup coverage and relocation inputs through their reviewed `praxis-integration.mjs` storage contract. Deployment recipes own runtime defaults and initial empty files. The platform supplies canonical-path, single-writer, inode/hash, SQLite WAL/Online Backup and rollback checks; it does not maintain a second application storage table. Keep explicitly registered private paths and configuration overrides when filling missing defaults.

Recovery source discovery reads declared configuration metadata and the coordinator's used-space cursors/events, not business bodies. A used or independently known source that disappears fails the backup. An unused mapped source can remain an explicit opaque omission; the worker mounts its declared parent without claiming that the missing file was backed up. Browser originals, exports and credentials retain their separate coverage boundaries.

`app-data.mjs plan` reports unavailable relocation paths. Migration stops before moving files or writing its journal when a legacy execution tree needs an unsupported application-owned export. It never imports or runs an archived execution engine. Preserve the original tree and rollback material; the supported physical relocation path copies or renames verified bytes without interpreting business content.

## App-owned structured databases

Use one app-owned SQLite database per application for authoritative server-managed structured records. Reminder, Finance, Intelligence, Travel and Lattice business state move from live JSON to their own databases; existing Knowledge, Projects, Memo, TingProof and platform databases retain ownership. Records keep stable space/resource IDs, revisions, ordering, receipts, events, timestamps, unknown historical fields and authorization. Reminder uses `reminder.db` with space-qualified records instead of a live `spaces/<id>/checklist.json` tree. Database namespaces do not grant access. JSON remains an explicit import/export or compatibility format, never an automatic fallback for a missing configured database.

Original documents, media, authored source files and exports retain their files and content hashes, with database references where the app needs them. Calendar device records move to browser IndexedDB without becoming a server account or server-backup claim; Matrix SDK encryption/device databases and external homeserver ownership remain unchanged. Letters/Profiles remain original-file readers; Polaris remains a read-only projection of separately owned runtime observations and gains no executor.

A cutover is a representational storage migration, not a business content edit. The user has authorized faithful conversion and deployment of the existing data: stop its writers, keep immutable originals and configuration/image rollback points, validate schema, convert into a new database, compare canonical content/IDs/revisions/receipt and event coverage, run integrity checks and an empty-directory restore, switch only verified bindings and restart one writer. Do not manufacture records, normalize business meaning, replace missing data with an empty store or delete the old source. Keep DB/WAL/SHM in the same mounted writable directory and use consistent SQLite online backups. Applications supply their storage, migration and inventory contracts; Praxis consumes them generically.
