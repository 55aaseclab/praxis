# Deploying and recovering the Docker stack

English · [简体中文 and historical release checks](DOCKER.md)

Use the [managed deployment guide](MANAGED-DEPLOYMENT.md) for current commands. This guide retains the topology, data contracts and release checks from the earlier deployment. Machine-specific addresses, user records and private service definitions belong to the installation.

## Topology and sign-in

In a managed installation, a TLS endpoint forwards to the web gateway. The gateway checks website identity, app entry and Travel shares. The public profile defaults to loopback port 14321. The canonical web entry may redirect to HTTPS. Keep raw app and core listeners on loopback. [Unified login](UNIFIED-LOGIN.en.md)

| Service | Maintenance port(s) | Persistent source |
| --- | --- | --- |
| Praxis / public web | 4321 / 14321 | Built source image and read-only public URL map |
| Reminder / core | 4322 / 4326 | Explicit space-to-JSON mapping; identity and event stores |
| Projects | 4327 | Single app and SQLite source for all projects |
| Travel | 4323 | Registered private itinerary JSON and app content |
| Knowledge | 4324 / 14324 | Standalone books plus managed SQLite/runtime with `/apps/knowledge/` base |
| TingProof | 5173 / 15173 | Same SQLite parent directory, preserving committed WAL and SHM behavior |
| Lattice | 4666 / 14666 | Registered decks and full operational `.lattice` |
| Lattice business | 4328 | Revisioned decks, jobs and content-addressed assets; read-only signing configuration |
| Memo | 4325 | Registered server guides and records; older browser-only content requires explicit import/export |
| Intelligence | 4330 | Explicit working roots or declared preview fixtures |
| Polaris viewer | 18787 | Separate administrator-only viewer and read-only observations file |
| Matrix Reader / Calendar | Web slot | Static app distributions; each app documents its browser data |

For an existing installation, preserve the canonical sources registered in the private storage configuration and the business space mappings. Match the workspace ID and single writer. Restore and verify data before activating services on a new host. Use a default-deny Docker build context to exclude secrets, Git data, private databases, decks and local dependencies.

## Start, stop, observe

Use Docker Engine, Compose v2+ and Node 22.16+. Select services from the private managed descriptor and run commands from the control checkout. Match the non-root container UID/GID to the registered bind mounts.

```sh
node scripts/managed-compose.mjs check apps
node scripts/managed-compose.mjs status apps
node scripts/managed-compose.mjs status core
node scripts/managed-compose.mjs status storage
npm run deploy -- status
```

The platform backend is named `core`. Managed commands accept an existing descriptor’s `business` group as a compatibility alias; retain its original project name, configuration paths and data bindings.

Inventory the configured project names, source images, ports and dependencies. Keep an existing service active while staging its replacement. Verify writer ownership, directory permissions and nonempty registered data before making a service writable.

Use the corresponding managed group for singleton applications. The blue/green controller manages the routers and slot pairs. A service restart must retain its source identity, port, private configuration and schema compatibility. Keep bounded container logs and redact operational details before sharing.

The Compose descriptor is private and mode 0600. Supply explicit services, immutable images and absolute bind sources. Configuration files stay outside paths writable by containers. A read-only single-file mount can retain its old inode across atomic replacement. Recreate its consumer after rotation and verify the actual mounted file.

## App configuration

These contracts describe the service side of a managed installation. In earlier releases a unified stack generated bindings and translated `PRAXIS_*` settings into individual app settings. In the current checkout, operators declare those bindings and service environment variables in their private Compose definitions. Consult each pinned app for its supported options.

- **Travel:** an optional mode-600 Amap file under a 700 parent can be selected with `PRAXIS_TRAVEL_AMAP_CONFIG` or placed at `~/.config/praxis/secrets/travel-amap.json`. Mount it read-only at `/run/secrets/travel-amap.json`. Fields are `key`, `securityJsCode` and optional server-only `webServiceKey`. Standalone Travel uses `TRAVEL_AMAP_CONFIG`. A missing provider key still permits itinerary reading. Preserve the distinction between a service probe and provider availability.
- **Travel business and Fliggy:** configure `apps.travel` with the fixed `http://127.0.0.1:4323/api/business`, `keyFile`, `dataDir`, `businessConfigFile` and allowed space. The space map contains version 1, `webSpace`, and `spaces`. The 700 itinerary directory must match registration. Mount it writable at `/data/itineraries` and mount key/config separately read-only. For Fliggy set `PRAXIS_TRAVEL_FLIGGY_CONFIG` or `~/.config/praxis/secrets/travel-fliggy.json` with `apiKey`; mount only this file at `/run/secrets/travel-fliggy.json` and set `TRAVEL_FLIGGY_CONFIG`. The restricted business interface supports specific typed lookup/update operations. It offers no reservations or payment. Recreate the affected service after replacing a bound credential file.
- **Lattice:** the app and engine live in `third_party/lattice`. Runtime templates and production tools live in `packages/runtime` and `packages/cli`. Use registered canonical paths for native `decks` and `.lattice` and separate business JSON/blob data. Old source history and recovery bundles are separate from live business data. The generic image includes Chromium, FFmpeg, fonts and dependencies; private decks are mounted at runtime. Configure optional `apps.slides.modelCaches` with individual trusted `piper`, `tts` and `asr` directories. Bind them read-only at `/opt/lattice-model-cache/<kind>` and set `LATTICE_PIPER_DIR`, `LATTICE_TTS_CACHE` and `LATTICE_ASR_CACHE`. Verify owner, canonical path and permissions. Do not mount a user's whole home, agent configuration or provider credentials. The CPU image skips unnecessary CUDA package downloads.
- **Lattice publishing:** the asset build writes viewer/workbench bundles below the mounted `.lattice/runtime/`. Use the owning app’s build process after a deck edit. Schedule replacement of live assets to avoid partial reads. Check the media toolchain and render a synthetic deck when export behavior changes.
- **Projects:** configure `apps.projects` with `managed:true`, `http://127.0.0.1:4327/api/business`, `dataDir`, `keyFile` and `businessConfigFile`. The version-1 map lists allowed `spaces`. Only the registered 700 directory is writable. The key and mapping are 600 and read-only. All projects use the same service, with resource checks in the managed interface and MCP.
- **Knowledge:** `knowledge-public` on 14324 serves app routes including `/k/<spaceId>/<libraryId>/<entryId>/`, legacy books and `/library/`. Configure `apps.knowledge` with fixed `http://127.0.0.1:14324/api/business`, `dataDir`, `keyFile`, `businessConfigFile` and `spaces`. The managed runtime initializes its empty database schema. App access, library grants and `legacy-library` permissions are distinct. Start the runtime, then the corresponding core build, then update the worker's exact online-backup mounts. The app also runs independently.
- **Knowledge attachments:** set `apps.knowledge.attachmentInbox` to a 700 directory. Deliver authorized files at `<spaceId>/<resourceId>/<sha256>` and mount it read-only. Alternatively register specific `apps.knowledge.attachments` entries with `spaceId`, `resourceId`, `sha256` and absolute `file`. The authorized content agent submits hash, original filename and title through MCP and reads back the parse result. Retain the mount until the job completes. Standalone deployments can mount the same hierarchy at `KNOWLEDGE_INBOX_ROOT`.
- **Intelligence:** Intelligence serves `/apps/intelligence/`. `intelligencePreview` defaults to true and can be overridden by `PRAXIS_INTELLIGENCE_PREVIEW=0/1`. Preview reads synthetic fixtures. Live mode uses the configured root's `data.json` and fails closed when missing. Management distinguishes the two modes.
- **Memo:** `apps.memo` uses fixed `http://127.0.0.1:4325/api/business`, `dataDir`, `keyFile` and explicit `spaces`; set `MEMO_DATA_DIR`, `MEMO_BUSINESS_KEY_FILE` and `MEMO_SPACE_IDS`. Device content that has not been imported still requires export or import from the device.
- **Polaris:** the platform administrator entry forwards to the dedicated loopback viewer. Mount only an authorized workspace projection if data is required. The viewer serves observation metadata read-only. [Viewer build and deployment](POLARIS-VIEWER.md)

## First infrastructure cutover and recovery

Keep the previous entry running while testing candidate images on synthetic data. Compare the proposed mounts to the registered app roots and verify that only one writer can reach each store. Check TingProof schema metadata against a consistent read-only copy in an isolated non-root process. An unfamiliar schema requires a separately reviewed migration.

Stop conflicting listeners and writers before activation. Verify the paths selected by the Reminder space mapping. Check each app page, authorization, media export and backup status separately. To roll back to an older native service, stop the container and confirm the previous code can read the current schema. Keep the newest data and retain the old source for recovery.

## Storage worker and public transport

`compose.storage.yaml` and `Dockerfile.storage` define the storage worker and pin its tools. Configure the activated writer with explicit read-only source, repository-checkout, configuration and credential mounts. Give write access only to coordinator state and the local backup target. After changing a path or replacing a credential file, recreate the worker from its private managed group and verify the effective mounts. Its configuration fingerprint and heartbeat have a different meaning from a successful remote replica receipt.

Public transport terminates TLS at an operator-controlled endpoint. Keep the origin and raw app listeners private. Verify the certificate, the selected upstream and proxy configuration independently before a reload. The public checkout does not contain an installation’s network topology or transport credentials.

Management reads a separate projection of backup status, worker heartbeats and data locations. Publish only the fields needed by the control plane and mount the projection read-only. The web process does not need access to container control, source data or credentials for this view.

## Blue/green release and rollback

The stable web listener runs at 14321, and the core backend's API/MCP listener at 4326. Blue uses 24321/24326 and green uses 34321/34326. Login, workbench, management, PRDs and MCP switch together. Stateful app processes, rendering jobs and storage workers retain one writer and their existing sources.

```sh
npm run deploy -- init
npm run deploy -- deploy
npm run deploy -- status
npm run deploy -- rollback
```

`init` is a first-time operation on an existing working stack and briefly hands the original listeners to the stable proxies. `deploy` builds from the checkout, or accepts a checked image via `--image IMAGE`. The manifest pins its immutable image ID. Candidate readiness precedes pausing new requests, draining accepted calls, closing the previous core database and collector, handing over the writer lease and reopening the two entries. Queued requests have a 30-second bound; overflow returns 503 and Retry-After. In-flight mutations drain; the router never replays POST. Streams and WebSockets reconnect. A failed candidate leaves the current slot serving. A failed handoff attempts to restore it.

Rollback switches code and routing. Keep the schema compatible across both slots. Private deployment control defaults to `~/.config/praxis/deployment/` with directory 700 and files 600. `manifest.json` records current/previous images, `state/state.json` coordinates atomic routing, Unix sockets control draining, and `lease/` protects the single writer. A standby core does not open writable identity/events databases or start collectors. A deployment lock excludes concurrent releases. The controller can reclaim a provably dead owner's lock. For an interrupted route/manifest commit, `needsRecovery` prevents unsafe cleanup; use `npm run deploy -- up` to recover the recorded version before another release.

`npm run deploy -- down` and `npm run deploy -- up` operate the slot pairs. An already healthy `up` is idempotent. Set `--state-dir PATH` for a different private control directory. The independent app and storage groups retain their own lifecycle. [Managed deployment](MANAGED-DEPLOYMENT.md)

## New app release record

Update the app PRD and roadmap, then fill out this record **before building or deploying**. Record empty/first-run behavior. Use synthetic data and accounts for source checks; production users complete their own authorization.

| Item | Release details |
| --- | --- |
| App, source and version | |
| Candidate image target and deployment URL | |
| Workbench entry, access scope, and launch/return checks | |
| First-use empty state | |
| Working data, mounts and backups | |
| Candidate and live health/asset checks | |
| Expected rollback behavior on the previous slot | |

1. Record the active slot, version, health and rollback availability. Verify the candidate's real HTML, assets, first use and entry permissions.
2. Release the checked image through the deployment controller.
3. From a fresh signed-in browser open the app via the workbench. Confirm the first screen and the lower-left Home control at desktop and phone widths. Activate Home and check it returns to the workbench in the same tab. Check the stable production route and unaffected entries. Follow the recorded rollback procedure on failure.

**Calendar 0.1.0.** The web slot serves `/apps/calendar/` after checking Calendar entry access. Opening it from a new account shows the current month and selected day. Dated reminders require separate Reminder resource access. A new event downloads as an .ics file to the user's calendar. The app has no separate server-side calendar store. Validate Home and same-tab return at desktop and phone widths. Rolling back to v0.1.103 removes the Calendar entry.

**Matrix Reader example.** The static bundle runs in the web slot at `/apps/matrix-reader/`. It requires a website entry grant. First use connects a Matrix account, verifies a device and selects rooms. The browser stores Matrix session and cryptographic device data under app-specific keys on the workbench origin. It has no server-side business volume. Verify JavaScript, CSS, WASM MIME and the authenticated route from a fresh browser session. The older dotted hostname could fail cold TLS handshakes; use the canonical workbench URL. After a browser origin change the person must authorize their Matrix device again. The Chinese guide retains the dated first-release record.

Historical deployments verified encrypted snapshot trial restore, healthy application services, image cache behavior, 3-second synthetic slide exports and blue/green handoff under load. See the dated Chinese records for exact test counts and limits. A successful local deployment does not prove a cloud restore or a physical phone client. [Storage guide](STORAGE.en.md) · [Verification guide](VERIFICATION.en.md)

### Letters and Profiles

The web slot serves the public, data-free readers at `/apps/letters/` and `/apps/profiles/`. Their files, names and group listings are private. Both require the configured owner's native Praxis session and an active platform-admin role. Another administrator or an app grant alone cannot read the collection.

Create `private-documents.json` in the private deployment control directory (owner-only mode 0600) with `ownerId` equal to the owner's immutable Praxis user ID and absolute `letters` and `profiles` directory paths. Example paths are `/srv/private/letters` and `/srv/private/profiles`. Use separate directories without symlinks. The blue/green controller binds only these sources, read-only, to the web slot. An absent configuration disables access; missing bindings cannot fall back to the public source tree. Use synthetic documents for release tests and keep credentials, source material, document lists and backups out of public Git. Previous private Git history remains private and is unsuitable as a source for publishing a new repository.

The first-release check starts with an empty mounted collection, then opens a synthetic document from each workbench tile and returns using Home on desktop and at a 390 px viewport. Before the first release, the previous slot has neither tile and returns 404 for these app routes. Rolling back restores that behavior and leaves the host documents in place.
