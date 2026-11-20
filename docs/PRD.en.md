# Praxis product requirements

Version: 0.1.126 · [简体中文](PRD.md)

Praxis is a self-hosted platform for apps designed around work done by agents and results used by people. Users express what they want and authorize an agent to do the routine work. The app validates the actions, saves the result and presents it in a form people can read, watch or listen to. Each app owns its business objects, the operations that can change them and the interface that makes them understandable.

## Public product homepage

Design an anonymous, indexable product homepage for people discovering Praxis through search. Explain the self-hosted platform, the user's chosen external agent, app-owned results and user-controlled authorization. Lead with a real product example and offer both trying the hosted service and running the complete local Compose stack. Present all fourteen published components, distinguishing Polaris runtime observations from app cards, and describe custom app development without claiming planned workflow execution or account registration is available. Keep technical setup below the product explanation.

Provide complete English and Simplified Chinese HTML editions with ordinary navigation links. Production acceptance requires readable content without JavaScript, explicit canonical/language URLs, truthful search/share metadata, accessible desktop/phone layouts and no private records. Implemented on the existing canonical workbench origin: anonymous visitors opening the origin root or `/zh-cn/` receive the public homepage while signed-in sessions keep the workbench at `/`; the pages carry canonical/hreflang/OG metadata, JSON-LD and a sitemap with a robots policy that permits only these public pages. The former workbench About Praxis link and its `/about/` pages are removed; the homepage replaces that content. The component directory renders from the reviewed app registry, not a separate app table. [Design](design/public-home.en.md)

## External agent tools and authorization

External content agents retain their normal harness tools, including shell, local files, browser/network access and MCP/OAuth configuration. Separate business identity and grants from platform maintenance privileges; do not disable client tools to stand in for authorization. Praxis and each app enforce account, resource and action permissions at their service boundary, including when a client sends arbitrary HTTP requests. The client may use its own working files and credentials; platform administrator credentials, server data and recovery keys are not supplied as business access.

## App-owned structured databases

Use one app-owned SQLite database per application for authoritative server-managed structured records. Reminder, Finance, Intelligence, Travel and Lattice business state move from live JSON to their own databases; existing Knowledge, Projects, Memo, TingProof and platform databases retain ownership. Records keep stable space/resource IDs, revisions, ordering, receipts, events, timestamps, unknown historical fields and authorization. Reminder uses `reminder.db` with space-qualified records instead of a live `spaces/<id>/checklist.json` tree. Database namespaces do not grant access. JSON remains an explicit import/export or compatibility format, never an automatic fallback for a missing configured database.

Original documents, media, authored source files and exports retain their files and content hashes, with database references where the app needs them. Calendar device records move to browser IndexedDB without becoming a server account or server-backup claim; Matrix SDK encryption/device databases and external homeserver ownership remain unchanged. Letters/Profiles remain original-file readers; Polaris remains a read-only projection of separately owned runtime observations and gains no executor.

A cutover is a representational storage migration, not a business content edit. The user has authorized faithful conversion and deployment of the existing data: stop its writers, keep immutable originals and configuration/image rollback points, validate schema, convert into a new database, compare canonical content/IDs/revisions/receipt and event coverage, run integrity checks and an empty-directory restore, switch only verified bindings and restart one writer. Do not manufacture records, normalize business meaning, replace missing data with an empty store or delete the old source. Keep DB/WAL/SHM in the same mounted writable directory and use consistent SQLite online backups. Applications supply their storage, migration and inventory contracts; Praxis consumes them generically.

## Protect employees’ attention

**Zero mandatory UI clicks for routine execution** is how Praxis aims to protect the attention of the people doing the work. Once intent, materials and authorization are in place, agents should carry out routine work and checks that can be automated. People should be able to step away while work proceeds, return to results on their own schedule and spend their attention on verification that requires judgment, exceptions and consequential decisions.

Routine results should be available for review at a time the employee chooses. Interrupt someone immediately only when an agreed work rule calls for it, such as a blocker that threatens a delivery deadline. Send the result, the relevant source evidence and the question to the person authorized to act. People can also open results, inspect evidence or correct a record on their own initiative. Track shared progress through business records and keep a person's reading and response history for personal reminders in their own view. Source-linked readers and authorized attention cards provide a starting point. Cross-app delivery and employee-controlled review timing are design goals.

For teams, the goal is to deliver more accepted work with the same people while maintaining quality and timeliness. Measure human minutes per accepted delivery, separating routine handling from verification that requires judgment. Freed capacity can translate into more paid work when customers have demand for it.

## Make room for reflection and improvement

Each completed delivery should leave a business record that people can learn from. From the delivered version, an authorized team member should be able to follow the trace back to the source materials, MCP business actions, Polaris run and workflow version, human decisions, and acceptance or rework when recorded. Later work can start from that record when a customer returns or the team reviews how it worked.

**One-click workflow improvement** is a design goal. A team member starts a review of past runs and gets an evidence-backed proposal for where the workflow could improve. The proposal should show the affected cases, what might change and what remains uncertain. The team can add context, set the proposal aside or test a draft against authorized historical cases in isolation. An authorized workflow owner decides whether to publish a new version after reviewing the comparison. [Business trace boundary](OBSERVABILITY.en.md)

The requirements below describe the current platform contract.

| User need | Observable behavior |
| --- | --- |
| Delegate a bounded operation | A native account authorizes a client for specific actions and resources. Tool discovery and the server both check grants. Revocation takes effect on subsequent access. |
| Understand the result | The app opens its native reader or view. People can browse the underlying evidence and see empty, loading and error states. |
| Find an app and return home | The workbench renders available apps and projects. A managed app provides an accessible Home link on desktop and at phone widths. |
| Keep personal materials private | Readers validate the owner's session before returning document names or contents. Original files and generated data belong in private storage. |
| Add a local app | An operator can supply a bilingual manifest for a loopback service, then launch that app on their own machine. |
| Work in either language | Open **Settings → General → Language** on the workbench to choose English (default) or Simplified Chinese. The choice applies immediately and persists in this browser for the workbench and its PRD reader. Standalone users and signed-in members can change it without administrator privileges. User-authored material keeps its original language. |

The public checkout supplies the complete built-in Docker Compose stack. A fresh clone starts the native services for all fourteen apps, the authenticated workbench and scoped business interface. First-start initialization creates a private owner account, workspace, service keys and persistent stores. Existing identities, configuration and records survive restarts and retries. Verify every native entry, protected resource, write/read-back flow and restart from an isolated clean installation. Preserve the original stack-management and recovery workflows during migration.

Check these contracts with synthetic data. Third-party services are provisioned separately for managed operation.

## Stable hover and copy feedback

In Settings → Data, location values and the workspace alias are consistent preview/copy controls. Hovering shows a pointer cursor across the control and its text, then reveals the full value in an anchored overlay. Keyboard focus and touch also reveal it; Escape dismisses it. Keep long values inside the viewport and allow their text to be selected. Copy the exact original value, including the resolved full path behind `$WORKSPACE`.

Show copying/success/failure in an existing fixed icon slot, with a visually hidden live announcement. Never insert a “Copied” line below a value or change row, table or page geometry. Keep the full value readable during feedback; repeated copies, error/recovery and returning to idle must not flash or move the content. Clipboard failure must remain truthful and expose manual selection. Preserve focus and scroll in clipboard fallback. An unchanged inventory refresh updates its timestamp without replacing the controls, closing a preview or clearing copy feedback; changed/cleared data and identity changes remove stale previews. Verify both languages, mouse hover, keyboard and touch at desktop and phone widths using synthetic values.

## App cards, live data inventory and business traces

Implement the approved [card design](design/workbench-cards.en.md) and its prototype, including result/question previews, expandable source evidence, one native primary entry, a finite queue and list, private Later/Hide this version with Undo, and Home returning to the selected card and position. Keep both workbench views top-aligned, language in Settings and the existing bottom-bar icon switch. Browsing does not acknowledge, accept or complete a business item; personal presentation state never changes a source deadline or becomes a colleague-visible read receipt.

All thirteen non-runtime built-ins supply app-owned, authorized, versioned card projections and current data-inventory metadata. Polaris is the runtime and supplies no workbench cards. Its data inventory remains included. The platform discovers providers from the installed app catalog, merges their responses and updates Settings when apps or their data locations change. App content, source versions, record references and native entry paths come from each app; do not fabricate cards or silently omit an app integration. Browser-local and derived sources report their actual execution and ownership boundaries. Letters and Profiles use the same configured document-owner boundary for card discovery, native reads and personal card preferences; their absence from the general app-entry policy must not hide these sources from that owner. Empty, unavailable, partial and unauthorized responses remain distinguishable.

Add a Trace section to Settings → Overview for the business operation lifecycle: authorized invocation, app outcome/commit, source/output versions, recorded workflow or human-decision links when available, and readback or failure. Use bounded structured metadata and authorized references; credentials, raw request bodies and private browsing/deferral histories are excluded. Describe missing historical coverage honestly. Usage and experience clues are always expanded in Overview, with no details/summary collapse control.

### MCP calls are the primary trace

Overview → Trace defaults to actual MCP tool calls. Show the registered tool, time, safe caller/client references, outcome and duration, with aggregate call counts, failures and latency for the stated observation window. Follow a business call into its authorization, app dispatch, commit and readback where recorded. Rejections, schema failures, unknown tools, control calls and interrupted calls need truthful outcomes even when no app runs. Distinguish MCP transport from delegated HTTP and native web operations. A successful HTTP response alone does not mean a tool succeeded or that business data was committed.

Trace metadata must remain readable while a tool invocation is queued or running. Read-only administrative monitoring does not wait behind unrelated business-operation route gates; business execution still holds its policy lease and serialization gate.

Polaris contributes already-recorded workflow context as a supplementary trace source. Runtime history, historical authorization rows and app change events must not stand in for evidence of current MCP calls. Keep usage/experience clues expanded. Record allowlisted metadata without raw arguments, outputs, credentials, arbitrary tool names or private browsing history, and preserve current administrative and business-reference authorization.

## App-owned registration and release identity

Each app owns its `praxis-app.json`, icon, localized presentation, default entry, documentation locations and registration example in its own repository. The application release version is part of that declaration. Praxis discovers and validates installed declarations; it must not maintain a second hand-authored app catalog or central copy of all app examples. Replace `config/apps.json` and `config/apps.example.json` with a source-reference-only installation index. Deployment origins, mounts, installation selection and authorization remain installation/platform responsibilities. App metadata never grants access, installs a backend or expands business capabilities.

Use three numeric components, `MAJOR.MINOR.PATCH`, for app release versions. Apps keep independent version values and release cycles. A declared release matches the app's package and root lockfile where they exist; static apps declare it in their manifest. Runtime health/version responses and workbench/PRD release labels use that same release identity. Requirements revisions are labelled separately. The PRD reader recognizes explicit English and Chinese requirements-revision headings and does not mistake an app-release heading for the document revision. Preserve historical meaning when expanding an app release shorthand such as `0.1` to `0.1.0`; schema numbers, protocol versions, algorithm revisions and business-record revisions are separate contracts and are not renumbered.

Keep fourteen installed entries, thirteen non-runtime card providers, data inventory, bilingual PRDs, local examples and the existing protected native routes working from app-owned metadata. Fresh anonymous bootstrap must be able to fetch the source references before app manifests are present. Reject duplicate identities, missing or invalid declarations, unsafe paths and version mismatches rather than silently falling back to a stale built-in table. Preserve private deployment overrides and publish app-owned changes before pinning their reviewed public commits.

## Load app integrations instead of enumerating app behavior

The platform loads a reviewed `praxis-integration.mjs` from each installed pinned app source, alongside the app-owned presentation manifest and provider. The app owns its native routes/assets, typed business operations, tool schemas, operation guidance, request/result normalization, supported actions/scopes, deployment recipe and storage/export semantics. Use one validated registry for discovery, authentication policy, gateway routing, MCP, cards, Settings, observations, installation and recovery. A newly installed synthetic app must integrate through its own declaration/module and explicit installation configuration without adding an app-specific branch or name/port/tool table to Praxis. Preserve the complete native behavior of existing apps while extracting their integration code; a generic reduced reader or a successful import is not acceptance. [Audit and loading contract](APP-LOADING-AUDIT.en.md)

The platform retains account and delegation management, current authorization, source trust, token/key custody, signed assertions, policy leases, serialization, resource checks, safe HTTP/file primitives, trace recording and consistent encrypted storage coordination. App capability declarations never assign roles, grant access, start an unconfigured backend or load code from a caller-provided path/URL. Trusted app hooks receive bounded, app-scoped callbacks and safe identity facts, not tokens, signing keys or an AuthStore. Validate duplicate identities, slugs, tool/scope/action names, unsafe source paths and incompatible hooks before activation. Deactivation removes entries/tools while retaining grants, data and history; inactive stored grants cannot authorize access and do not invalidate unrelated active capabilities.

Implement the complete Projects planning contract from requirements revision 2 (preserved commit `54701f5`), with the resolved role bootstrap in its next owning revision: one project main, four team mains and actual identity-owned personal drafts; structured PRD/Roadmap, target-scoped personal→team→project proposals, comparison, conflicts, immutable decisions/history, recovery and restore-as-new-draft after the P0 loop. No read creates plans, members or agreement. Business space owners/admins with project-scoped role-management authority may explicitly assign planning roles to eligible accounts; acceptance requires the assigned target role and separate current update/accept authorization. Platform-admin status and a free-text owner label confer no business decision authority. New Projects operations are supplied by its loaded app integration and owning service rather than new central schemas or switch branches.

## Backup configuration and credential custody

The storage coordinator loads business configuration as metadata: validate app identities, paths, mappings and declared formats, while excluding signing-key reads. It must work with its existing data/configuration mounts and must not gain application signing keys merely to register backup sources. Core runtime configuration continues to validate signing keys before accepting business traffic. Test startup with an intentionally unmounted key, keep malformed configuration fail-closed, and preserve queue generations, leases, workspace/writer identity and graceful restart behavior.

## Application publication

Each maintained app publishes verified changes from `main` in its own public repository. Praxis records that branch and an exact app commit, then verifies the combined distribution. Anonymous clones can retrieve every pinned commit from the app’s public `main` history.

## Platform core naming

Name the platform backend Compose service **core**. Local setup, credentials and management commands use that name. The service owns identity, authorization, external-agent access and app coordination. Existing installation metadata, data volumes and legacy entry points remain readable during the rename.

## Video-engine availability

The current installation keeps the Lattice video implementation and dependency declarations, while Remotion and HyperFrames are uninstalled from its runtime environment. Check backend installation before video work and skip missing engines. Keep existing video records and artifacts. Authoring, normal PNG/PDF/HTML exports and audio retain their native implementations.

## Home-screen identity · v0.1.111

Installing Praxis from the workbench, sign-in page or Settings uses the current pine mark. Sign-in and Settings expose the same manifest and Apple touch icon as the workbench. Installation metadata and PNG icons are readable before sign-in. Icon URLs carry an artwork version so an existing browser can discover a changed icon. Keep the manifest ID, start URL and scope stable when updating the artwork.

## External agent clients · v0.1.110

The workbench provides app and project navigation, Settings and product documentation. It contains no Paseo web portal, embedded client, external Paseo shortcut or pairing panel. Users connect their chosen external agent client through its own interface and the app's authorized MCP connection.

## Workbench views · v0.1.109

The existing bottom navigation bar contains a single icon button that toggles **Apps / For you**. It has no visible text labels; its icon, tooltip and accessible name describe the destination view. It works with keyboard and touch, and stays available as the main area scrolls. Both views start at the top of the main area with consistent padding, including sparse and empty states. Apps shows app and project launchers. Due dates, reminder previews, task counts and attention cards appear only in For you. Changing views keeps the selector focused and preserves the selected attention card. When the account loses the required access, clear its attention content and return to Apps. Check both languages on desktop and at phone width.

## Built-in apps

A standard Praxis distribution includes the maintained apps as independently versioned components. The catalog covers Reminder, Knowledge, Lattice Slides, Travel, TingProof, Memo, Finance, Intelligence, Polaris, Calendar, Matrix Reader, Projects, Letters and Profiles. The built-in apps are products in their own right. Their reading, viewing and listening experiences demonstrate the product direction, and their app-owned data, operations and interfaces provide reference implementations for new apps. Each app documents its supported operations and setup. Access follows the installation and the user’s grants. Private data, accounts and working files remain outside the public repository.

Individuals, families and organizations should be able to quickly build and deploy apps that fit the way they work. AI-assisted development and reusable deployment steps are intended to make this practical even for narrowly scoped needs. An app can be built directly around its own business objects and workflows, with external sources and services used where useful. Today, the manifest registers a running app on the local workbench. Managed entry and scoped agent operations require explicit integration and deployment. [App standard](APP-STANDARD.md)

## Platform responsibilities

App owners control their code, persistence, validation and result interfaces. The shared platform provides identity, OAuth delegation, resource and action authorization, connectors, MCP and workbench navigation. Users choose an external agent client for reasoning and orchestration.

The intended users include individuals with private records, families and teams sharing selected resources, external collaborators assigned specific tasks and operators maintaining the installation. Development and business use have distinct sessions, credentials, environments and audit trails even if both use the same model. Platform administration and business access are separately granted.

## User flows

- **Delegate work.** The user gives a task to their chosen agent. The external client discovers the issuer, resource and supported tools, binds a real user through OAuth and asks for specific resources, actions and expiry. Each invocation intersects the current user permissions, client delegation and deployment and app capabilities. A user can review and revoke grants. The website uses native browser identity.
- **Save and verify.** Use typed, allowlisted operations, resource IDs, expected revisions and idempotency. Results remain in the owning app. After an uncertain response, read or retry with the same key. Emit events after commit, recheck authorization for subsequent deliveries and make conflicts visible. Backup completion is distinct from a successful save.
- **Use and check the result.** The app presents the saved work in its native view, such as a source passage, a rendered deck or a review segment. People can inspect evidence in context. Knowledge distinguishes notes, books, papers and source packages. Its controlled import, parsing and indexing tools provide retrievable passages and references, with unresolved coverage or parsing failures visible.
- **Review work.** Projects is the authoritative source for project entries. Present related work to the current user within the effective scope. Any task or activity view must derive its contents from authorized records and link back to their owning app. Never infer a public company-wide feed from a user's membership.
- **Open and return.** An authenticated account receives a personalized workbench. Offer visible apps and project entries according to current permissions, including an honest empty state. Open the selected object in the same tab. A managed app exposes the fixed lower-left Home control and supports keyboard, desktop and narrow-screen use. After sign-in restore a validated destination. Handle loading, stale data, revocation, conflicts and uncertain writes with explicit recovery.
- **Develop an app.** Maintain a documented interface/ownership boundary, locale support, first-run behavior, entry and return navigation, permissions, storage and checks. Local development should not publish an app or grant it production access. [App standard](APP-STANDARD.md)

## Operating requirements

English is the primary product and documentation language. Update English first and Simplified Chinese in the same change. Support an explicit language choice where the app offers localization. Preserve the language of user-authored content, quotes and proper names.

Keep production data outside Git and images. Use one active writer, consistent exports, restorable encrypted repositories and verifiable handover. Validate the blank/first-use state of a new app before release. Test canonical HTTPS, assets, access and workbench round-trip navigation from a fresh signed-in browser. Switch compatible web/core images through blue/green deployment and retain the preceding version. Protect credentials, media, private screens and logs across all equivalent entry paths.

Public product information may be crawled in English and Chinese. Publish only reviewed public content. Protect app bodies, identities, business data and sessions. Original platform software and documentation use Apache 2.0; independently owned content keeps its own terms.

## Acceptance and references

For each requirement, record the user task, observable outcome, owning app or platform component, positive and negative permission cases and the smallest checks that cover the actual change. Use synthetic fixtures for maintenance validation. Live business-agent and physical-phone acceptance have distinct operators and evidence. Record unsupported or untested behavior explicitly. [Roadmap](ROADMAP.en.md) · [Platform manual](PLATFORM.en.md) · [Acceptance plan](VERIFICATION.en.md) · [Full requirement archive](PRD.md)

## Feature register

The register and release history describe v0.1.0 through v0.1.107 at the time of each decision. Test counts and rollout results refer to those releases. For today’s entry points, service setup and read-only Polaris viewer, use the [running guide](RUNNING.md), [built-in app guide](BUILTINS.md) and [viewer guide](POLARIS-VIEWER.md). The Chinese ledger retains the detailed sequence of decisions and dated acceptance results.

Read these requirements in release order when migrating an older installation. Later requirements may change an earlier UI or move ownership while preserving the underlying data and permissions. The historical ledger records acceptance criteria and release checks.

| ID | Required behavior |
| --- | --- |
| F01–F03 | Maintain the root requirements before the roadmap; the workbench PRD collection reads the checked-out source by fixed document ID. Show missing/unavailable sources truthfully. Constrain paths, size, Markdown links and rendering. |
| F06–F10 | Keep the launcher uncluttered; list Slides. The operator maintains code, while independent business actors use scoped interfaces. Travel owns itinerary records, Knowledge owns the book/document reader, and the thin Node launcher owns discovery. |
| F11–F15 | Protect remote access over the approved HTTPS endpoint. Increment one patch for a product requirement or fix, remove duplicate maintenance sources, and allow the actual expected hostnames. Travel may share one trip through a bounded, revocable link (seven days by default); recheck permission for pages and assets. |
| F16–F21 | Multiple distinct itinerary records share the Travel implementation. A restricted TingProof collaborator can use the granted app. Use Reminder as the visual reference for collection layouts. Travel's route list, itinerary cards, budgets and place metadata preserve source identity; show unknown prices or opening times explicitly. |
| F22–F25 | Cache images with validators and check authorization before conditional responses. Travel links to place search and Memo preparation scenes. Docker owns service lifecycle. Register canonical working sources, backups and explicit migration rather than treating sync folders as concurrent writers. |
| F26–F31 | The UI, API and MCP share typed business rules. Scope access by space, resource and action. External agents discover and invoke authorized tools. Local family updates, revision conflicts and asynchronous replicas have separate outcomes. Verify an independently authorized business client and an independent physical phone client as distinct tests; scope business access on the server while retaining normal client tools. |
| F32–F36 | Aggregate bounded, sanitized observations. Distinguish permissions, connections and storage status. One origin gateway handles browser sign-in, OAuth and app access. Administrators manage accounts and grants through the website; administrator entry access and permission to change business data remain separate. |
| F37–F45 | Preserve the native Reminder rendering in managed mode. Open workbench links in the same tab and return using the shared platform control. Publish a platform manual. Put operational status and charts under Management. Apply a shared design language across launcher, collection, reader and editor layouts. Remove the superseded generic business-space UI. |
| F46–F51 | Store references in their owning Knowledge/Projects repositories. Paseo launches the Docker stack as one operator action. Management separates account controls from agent delegation. Travel uses itinerary-scoped maps, an authorized AMap service adapter and a browsable expanded map with accurate unavailable states. |
| F52–F56 | Travel planning tools authorize the specific itinerary; separate unverified search results from saved itinerary facts. Existing itineraries use the shared Travel UI. Management lists registered MCP tools, app configuration and observed use as different facts. The anonymous public MCP explains setup and never reads business data. Real itinerary updates belong to separately delegated actors. |
| F57–F61 | Keep the home-screen directory responsive, with distinct app and project groups. Projects owns multiple project records, work domains, status, dependencies, owners and source references. The fixed reverse SSH path can replace VPN transport without changing origin authorization. Project links preserve space and project identity; source material lives in References. |
| F62–F68 | A business knowledge library records traceable sources and versioned entries. Static book and business reading layouts share navigation conventions. Stable internal references resolve to the intended page or passage. Project reference packages live with Projects. Use one Docker startup entry, direct Knowledge content links and a common PRD reader. |
| F69–F72 | Reuse the native Slides visual language and Lattice engine for decks and controlled edits. Lattice owns its native MCP and document/media contracts. Template changes and versioned edits require explicit operations. Finance first shipped with synthetic financial views; identify preview data as such. |
| F73–F77 | A Knowledge entry opens in its own reading view. MCP may read or change exactly the authorized document, with revision checks. Separate the directory hierarchy from document content and versions. Publish an operation-specific skill for every exposed tool. Sections belong to chapters and chapters to books; synthesize navigation consistently across those scopes. |
| F78–F83 | Switch web/core through a stable blue/green router and a single writer lease. Rollback moves code and routing, preserving data. External content actors may create within explicit bounded targets and verify readback. Keep relationship diagrams readable, Home anchored at the bottom left (44 CSS px; 12 px plus safe area), and static reference titles and edits stable at their original URLs. |
| F84–F89 | Install Praxis on the home screen via its manifest. Knowledge expands the current section directory and can create peer sections through the owning store. Memo owns scenario guidance and rights-protection material. Reminder's native and managed browsing UI removes inline editing and accidental completion controls; existing authorized agent operations retain their business contract. |
| F90–F95 | Polaris runs as an independent pinned app managed by Docker, with identity and workspace storage delegated to Praxis. Management shows real app data locations and shortens only registered workspace paths to `$WORKSPACE`. Intelligence separates sources, entities and changes, and preserves provenance and comparison semantics. Keep conference-paper counts and cache coverage separate. Polaris opens from its administrator-only workbench entry. |

### Recent cross-app requirements

Knowledge's dashboard counts papers, books, document packs and notes. Its sidebar remains a navigable directory. Document ingestion, parsing, indexing, search and readback carry source identity; unsupported or partially parsed files remain visible. Handle a directory update after import without requiring a new browsing session.

Every real project entry comes from Projects. Display all authorized project links together and preserve existing Knowledge reference links. The UI/UX guide requires predictable states, source navigation, access checks and recovery. The platform owns the Home control for managed pages. A first release includes the authorized workbench tile, an explicit initial blank state, a candidate health check, a same-tab round trip and a rollback expectation.

Matrix Reader's production entry is the canonical protected workbench path. New users authenticate and verify a Matrix device before choosing rooms. Room selection supports select all and clear all before saving. Record the difference between device verification, recovery of historical keys and successful decryption of a particular message.

The workbench now provides a separate For you program. Surface overdue, flagged and near-term readable reminders, and unfinished project work explicitly assigned to the signed-in identity. Identify why a card appeared. Swiping, keyboard arrows and buttons move between cards; the action opens the originating item. Calendar uses the same authorized reminder source. Published documentation and personal local app discovery have separate access and release boundaries.

## Release history

| Version | Date | Change |
| --- | --- | --- |
| v0.1.104 | 2026-11-19 | Publish the English current requirements and bilingual app standard. |
| v0.1.105 | 2026-11-19 | Localize public MCP discovery and operational skills; use bilingual app manifests |
| v0.1.106 | 2026-11-19 | Document how agent-native apps compare with harnesses and existing app connectors |
| v0.1.107 | 2026-11-19 | Add owner-only Letters and Profiles readers with public code and private runtime sources |
| v0.1.113 | 2026-11-19 | Rename the platform backend service and commands to core with installation compatibility |
| v0.1.114 | 2026-11-19 | Deliver app-owned cards, live data inventory, private card preferences and Overview business traces with expanded experience clues |
| v0.1.115 | 2026-11-19 | Honor private reader ownership in card discovery and preferences |
| v0.1.116 | 2026-11-19 | Prioritize actual MCP calls, outcomes and latency in Overview Trace |
| v0.1.117 | 2026-11-20 | Keep MCP Trace monitoring responsive during in-flight business calls |
| v0.1.118 | 2026-11-20 | Move app registration ownership to app manifests and standardize release versions |
| v0.1.119 | 2026-11-20 | Read explicit app-owned requirements revisions separately from app releases |
| v0.1.120 | 2026-11-20 | Load app-owned integration contracts and deliver Projects planning |
| v0.1.125 | 2026-11-20 | Remove per-app language toggles; apps follow the workbench language preference |
| v0.1.126 | 2026-11-20 | Serve the public product homepage at the canonical origin and retire the About Praxis pages |

### Letters and Profiles

Letters provides an authorized reader for academic correspondence and recommendation materials. Profiles organizes CVs, cover letters, research and teaching documents. Public application repositories contain only the reusable interface, control code and synthetic fixtures. The owner opens their private collection through the authenticated workbench. The running service mounts explicitly configured data directories read-only, outside the image and public source. No original document or document inventory is published to a public repository.
