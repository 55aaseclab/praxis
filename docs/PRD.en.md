# Praxis product requirements

Version: 0.1.111 · [简体中文](PRD.md)

Praxis is a self-hosted platform for apps designed around work done by agents and results used by people. Users express what they want and authorize an agent to do the routine work. The app validates the actions, saves the result and presents it in a form people can read, watch or listen to. Each app owns its business objects, the operations that can change them and the interface that makes them understandable.

**Zero mandatory UI clicks for routine execution** is the design goal once the user’s intent, source material and authorization are in place. People can grant consent, resolve important ambiguities and make consequential decisions. They can also open the result, play media, inspect evidence or correct a record by choice. Source-linked readers and authorized attention cards provide a starting point for delivery. Automatically bringing the result to the right surface across apps and agent clients remains a goal.

The requirements below describe the current platform contract.

| User need | Observable behavior |
| --- | --- |
| Delegate a bounded operation | A native account authorizes a client for specific actions and resources. Tool discovery and the server both check grants. Revocation takes effect on subsequent access. |
| Understand the result | The app opens its native reader or view. People can browse the underlying evidence and see empty, loading and error states. |
| Find an app and return home | The workbench renders available apps and projects. A managed app provides an accessible Home link on desktop and at phone widths. |
| Keep personal materials private | Readers validate the owner's session before returning document names or contents. Original files and generated data belong in private storage. |
| Add a local app | An operator can supply a bilingual manifest for a loopback service, then launch that app on their own machine. |
| Work in either language | Open **Settings → General → Language** on the workbench to choose English (default) or Simplified Chinese. The choice applies immediately and persists in this browser for the workbench and its PRD reader. Standalone users and signed-in members can change it without administrator privileges. User-authored material keeps its original language. |

The public checkout supplies a default Docker Compose entry. A fresh clone starts the local workbench with Calendar and the built Matrix Reader, with an optional anonymous connection guide. Native development remains available. Managed identity, app data and services use the installation’s explicit configuration. Verify the published commands from a clean checkout using separate loopback ports and an isolated Compose project.

Check these contracts with synthetic data. Third-party services are provisioned separately for managed operation.

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
| F26–F31 | The UI, API and MCP share typed business rules. Scope access by space, resource and action. External agents discover and invoke authorized tools. Local family updates, revision conflicts and asynchronous replicas have separate outcomes. Verify a separate restricted Paseo Codex business actor and an independent physical phone client as distinct tests. |
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

### Letters and Profiles

Letters provides an authorized reader for academic correspondence and recommendation materials. Profiles organizes CVs, cover letters, research and teaching documents. Public application repositories contain only the reusable interface, control code and synthetic fixtures. The owner opens their private collection through the authenticated workbench. The running service mounts explicitly configured data directories read-only, outside the image and public source. No original document or document inventory is published to a public repository.
