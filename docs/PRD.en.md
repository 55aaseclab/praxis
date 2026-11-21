# Praxis product requirements

Version: 0.1.152 · [简体中文](PRD.md)

Praxis is a self-hosted platform for apps designed around work done by agents and results used by people. Users express what they want and authorize an agent to do the routine work. The app validates the actions, saves the result and presents it in a form people can read, watch or listen to. Each app owns its business objects, the operations that can change them and the interface that makes them understandable.

## Delegation management and reactive Spaces context

Agent delegations provides **Revoke delegation** for every unrevoked entry, including expired and restricted grants, using the existing centered confirmation modal. Revoked history remains labeled and read-only. Per-app Space management shows delegations scoped to the selected space and app alongside its resource permissions. A revocation affordance is available only when the signed-in actor can revoke through the existing administrator or own-account grant endpoint. Confirmation explains that revocation removes the entire delegation, including its other apps and spaces; immediate access removal and existing audit events remain unchanged.

Changing **Current user** in Spaces refreshes the panel's displayed app access, resource permissions and available actions for that account, retaining the complete installed-app catalog and showing explicit unavailable/empty states. The data agrees with that account's actual native session view. Discard responses from older selections. The signed-in administrator's own deletion and owner-management capabilities remain separate from this display projection; selecting another owner never lends their authority. Keep server authorization, API write contracts and existing confirmation flows unchanged.

| ID | Observable acceptance |
| --- | --- |
| DM01 | Isolated synthetic API and real Chromium at 1440/390 px exercise revocation from Agent delegations and the matching per-app Space page through the centered modal, including expired/restricted entries, cancellation and revoked history; confirmed revocation immediately removes access, preserves existing audit events and is reflected on both surfaces. |
| DM02 | Chromium switches between synthetic accounts with different app/resource/action permissions and compares the rendered panels to each account's actual native session view; returning, refresh and delayed older reads never restore stale content. Existing administrator capabilities and server authorization/CSRF denials remain intact. |
| DM03 | The full version-gated suite and both workbench PRD readers pass with one aligned PATCH release. Commit verified source before building and deploying only the affected web/core pair to the authorized managed test environment; report technical evidence, actual running version and public readback separately from independent business acceptance. |

## MCP connection space audit and Settings cleanup

MCP Settings renders protocol endpoints and capability schemas without the app configuration/seven-day call block, registry disclaimer or updated timestamp. OAuth space designation uses a directly available labeled native dropdown; changing it refreshes the available unchecked permissions without a separate selection button. Preserve inline creation for accounts without spaces and all existing authorization checks. Account deletion blocked by owned spaces uses the same persistent fixed error overlay as every other Settings error, retaining the complete space IDs and stable page geometry.

| ID | Observable acceptance |
| --- | --- |
| MCP01 | Synthetic Chromium at 1440/390 px verifies both languages of the cleaned MCP view, direct consent dropdown, retained no-space creation and owned-space refusal through the existing fixed error overlay without a bespoke popup. |
| MCP02 | Audit public connection guidance → consent designation → code/refresh `space_id` → real SDK `tools/call` with `arguments.spaceId`. If an SDK strips token extensions, authenticated initialization and `praxis_refresh_capabilities.spaces` expose only current authorized catalog spaces; no new authority is granted. Document actual results bilingually. |
| MCP03 | PKCE, Origin, CSRF, callback, legacy and cross-space refusals, the complete version-gated suite and both workbench PRD readers pass. Commit before building/deploying only the affected test web/core pair; report running version and public-only readback separately from business acceptance. |

## Long-lived AI-native testing

Deliver an opt-in external-agent test harness under `tests/ai-native/`, with English and Simplified Chinese instructions and reports. Paseo manages agent sessions; a separate GLM-5.3-Flash main coordinator advances durable campaigns. Business actors use GLM-5.3-Flash worker with one globally enforced worker inference slot. Maintenance uses GPT-6.1-Sol, ultra reasoning and the provider's default context window. Discover exact provider models at launch; never substitute free/fp8 models or disable normal client tools. No worker token budget or fixed end date applies. Concurrency/load acceptance remains pending.

The test configuration sets `fullAccess: true` for all roles. OpenCode coordinator/workers use their discovered `auto_accept: true` feature in build mode, applied before the first prompt; Codex Maintenance uses full-access mode. Ordinary file, shell and network tool permissions do not interrupt the human. Keep explicit human questions interactive, including per-invocation Maintenance approval; automatic tool permission acceptance must never answer those questions. Use supported Paseo SDK/MCP/CLI controls only, and verify the observed runtime setting. This grants harness tools, not additional business permissions or internal API access.

The test configuration sets `communication: "paseo-send-message"`. Agents use Paseo's public send-message operation for assignments, reports, questions and coordination, including worker→coordinator and coordinator→parent reports. Do not read another agent's working files or repeatedly pull logs/timelines as a message transport. Reading harness state and independently verifying app outcomes remains necessary; app records remain authoritative. New/resumed business tasks still reserve the global worker slot before sending; communication does not authorize extra parallel workers.

Three synthetic campaigns retain identities and accumulated records: a three-person travelling family; a research organization studying **A new paradigm for vulnerability management in the AI era**, with Research (mentor/student), Productization (engineer), Marketing and Finance/support; and a full-time simulated investor starting with CNY 1,000,000 and targeting 10% net return. The investor's market and horizon must be supplied before trading. Research uses Reminder, Knowledge, Lattice, Memo, Polaris, Calendar, Projects and Intelligence; investment uses Reminder, Memo, Finance, Intelligence and Polaris. Campaign application use follows actual discovered capabilities. Polaris remains a read-only authorized observer and Calendar retains its device-local boundary; missing capabilities are recorded rather than fabricated. Keep all teams and personal/shared scopes separate. Real public information may be researched; orders, money and organizational operations remain synthetic.

Stable personalities, persisted random scenario draws and actor autonomy produce variation. Provide goals and acceptance criteria rather than operation scripts. Preserve failures, supporting evidence and individual knowledge boundaries; local notes cannot replace authoritative app records. Resume original actors at their failure point after repair, with isolated full replay when needed. Thirty initial travel destinations are material, not a completion condition. A trading return is an objective, not a promised result or product pass criterion; retain costs, losses, drawdown and information timestamps.

Every Maintenance invocation requires a fresh, explicit human reply to a question in Paseo about the exact technical packet and scope. The coordinator asks through its normal user-question tool, or in the Paseo conversation when that tool is unavailable, then waits. Record the question ID, user-reply reference, decision, original answer and packet hash; an unanswered question, an agent's own reply or ambiguous text is not approval. Consume an accepted confirmation once, before dispatch. Changed scope requires a new question and confirmation. No signing key or approval-key setup is required to initialize or run tests. This is an auditable conversation workflow, not a cryptographic identity boundary against an arbitrary client.

The maintenance prompt contains only the approved minimal synthetic technical reproduction, code scope and verification plan: no campaign topic, business bodies, actor discussions, credentials or raw business output. Human packet review is required; structural validation cannot prove semantic redaction. Maintenance fixes code in the owning repository; the original business actor validates its own result on the actually running repair version.

Account creation, team setup, consent, authorization and all live business actions use only publicly supported UI, documented public APIs or public MCP capabilities. Do not call internal/undocumented endpoints, administrator bootstrap helpers, SQL or server files to fill a missing workflow, even for these synthetic actors. Report the missing public capability as a blocker. Normal client tools and documented local harness operations remain available.

| ID | Observable acceptance |
| --- | --- |
| ANT01 | Bilingual manifests/instructions define exactly three campaigns and nine persistent business actors, the selected models, normal tools, application boundaries and unresolved investment inputs. |
| ANT02 | Durable dispatch reservation permits one worker across campaigns and processes, survives coordinator restart, and never expires into automatic duplicate execution. Uncertain Paseo outcomes require reconciliation. |
| ANT03 | Dispatch binds the intended host/workspace/session. Existing actor sessions are resumed, with observed model and idle-state checks. Dispatch failures and ambiguous receipts remain recoverable without blind retry. |
| ANT04 | Maintenance cannot dispatch before the corresponding Paseo question has an explicit human approval for the unchanged packet. Missing/denied/stale confirmations reject; an accepted confirmation is consumed before dispatch and cannot authorize another invocation. |
| ANT05 | Maintenance requests contain an allowlisted synthetic technical packet only; approval and repair output remain separate from business evidence and worker prompts. |
| ANT06 | Attempts retain evidence, version, scenario draw and history. Failed cases block until explicit retry or repair; repair-linked retries require a deployed version, resume the original actor and take priority over new exploration. |
| ANT07 | Coverage distinguishes applicable, attempted, passed, failed, pending and N/A cells, with a versioned denominator and reasons. Report autonomous completion and repair recovery separately; agent claims alone cannot pass verification. |
| ANT08 | Pause stops new dispatch without forgetting active work; resume/reconciliation does not release a still-running or uncertain slot. No ordinary `npm test`, import, initialization or report operation starts an agent or schedule. |
| ANT09 | State, OAuth credentials, conversation-confirmation receipts and raw evidence stay outside Git. Operators configure independent business and maintenance workspaces/identities. Tests start without approval keys, and business setup uses public product interfaces only. |
| ANT10 | Synthetic controller/adapter checks and bilingual workbench PRD reads pass. Actual external-client business acceptance, periodic scheduling, production deployment and load claims are recorded separately and never inferred from those checks. |

Implementation and operations: [English](../tests/ai-native/README.md) · [简体中文](../tests/ai-native/README.zh-CN.md).

## Language on first paint

Platform pages render the persisted `praxis_locale=en|zh` preference on the server before any script runs: workbench, standalone Settings, managed administration, authentication and the public homepage. Without a valid cookie, keep English. Authentication's explicit `lang` choice takes precedence; sign-in and registration language links persist the preference. Preserve public English `/` and Chinese `/zh-cn/` SEO editions; a Chinese preference at the anonymous root redirects to the Chinese edition, and explicit homepage language links persist that edition's preference.

Translate only marked platform strings and accessible labels, preserve English source metadata for switching back, and initialize client language from the rendered locale. Client translation remains a fallback for new strings and explicit language changes. User content and authorization remain unchanged. Verify script-blocked initial Chinese/English DOM, refresh and navigation, no locale text swap or locale-induced layout shift at 1440/390 px, both PRD reader languages, existing authorization tests and the full version-gated suite. Report synthetic technical evidence and the managed deployed version separately from business acceptance.

## Public product homepage

Design an anonymous, indexable product homepage for people discovering Praxis through search. Explain the self-hosted platform, the user's chosen external agent, app-owned results and user-controlled authorization. Lead with a real product example and offer both trying the hosted service and running the complete local Compose stack. Present all fourteen published components, distinguishing Polaris runtime observations from app cards, and describe custom app development without claiming planned workflow execution is available. Keep technical setup below the product explanation.

Provide complete English and Simplified Chinese HTML editions with ordinary navigation links. Production acceptance requires readable content without JavaScript, explicit canonical/language URLs, truthful search/share metadata, accessible desktop/phone layouts and no private records. Implemented on the existing canonical workbench origin: anonymous visitors opening the origin root or `/zh-cn/` receive the public homepage while signed-in sessions keep the workbench at `/`; the pages carry canonical/hreflang/OG metadata, JSON-LD and a sitemap with a robots policy that permits only these public pages. The former workbench About Praxis link and its `/about/` pages are removed; the homepage replaces that content. The component directory renders from the reviewed app registry, not a separate app table. [Design](design/public-home.en.md)

Keep the public page’s sticky navigation, title-only hero with two actions, full-width autoplaying example below it, Authorize → Ask → Review order and result-card design preview after the app directory. Preserve reduced-motion/no-JavaScript fallback and public SEO metadata while improving visual hierarchy. Homepage HTML must revalidate on navigation; CSS/JavaScript URLs include their content hash so deployments cannot combine new markup with an old cached asset.

The public homepage describes cards as attention management: choose what to focus on, defer or hide, without treating reading as acceptance. Remove the two demo caption lines, keep only necessary motion controls, stack the app-directory title and description, and present the ownership heading on the left and two concise data/access and trace entries stacked on the right, collapsing to one column on phones. Include Documentation and Contribute in the sticky header in both languages. Replace the repeated footer tagline with a copyright notice linking 55AA Security Lab to https://www.55aaseclab.com/.

## Public self-service accounts

An anonymous visitor can follow **Create an account** from the public homepage or sign-in page to `GET /auth/register`. The English/Simplified Chinese form and `POST /auth/register` (JSON or form encoding) accept only `username`, `password` and an optional validated local `return_to`. Usernames contain 3–64 ASCII letters, numbers, dots, underscores or hyphens, starting with a letter or number; passwords contain 12–1024 characters. Reject invalid/unknown fields, duplicate usernames and cross-origin requests without creating an identity. Return only the new identity and sign-in path for JSON, or redirect the form to sign-in; never return a password, session or OAuth credential from registration.

Persist a basic abuse limit of five registration attempts per transport peer and 100 globally per hour, including invalid attempts. Do not trust caller-supplied forwarding headers; proxied visitors share the peer limit. Return HTTP 429 with `Retry-After` on exhaustion. Registration atomically creates exactly one personal space owned by the new user, marked at creation as the automatically provisioned personal space and protected from standalone space deletion by every caller; administrator account deletion removes it with its owner under the account-deletion rules below. Provisioning is idempotent: an operator-provisioned user keeps their existing personal space without duplication. Registration creates no app-entry policy, resource permission, client delegation or administrator role; the personal space starts with no enrolled apps. After a separate sign-in, preserve the validated OAuth return path. An authorized account may consent to the existing authorization-code + S256 PKCE flow for the protected MCP resource; an account with no matching permissions sees no available actions. Verification uses isolated synthetic identities, including restart persistence, rejected elevation/origin/redirect attempts, rate-limit expiry, bounded consent and MCP token use. Live business-client acceptance remains separate.

### OAuth consent selection and callback redirects

The consent page explicitly designates one of the signed-in user’s accessible spaces for this authorization. Default to their personal space when present, retain the user’s selection through retries, and show only currently permitted app/action choices for the selected space. When no space exists, offer inline space creation before continuing the same authorization request. Creation uses the current native identity and existing space-creation rules; it grants no app or resource access. Bind the selected space to consent and the resulting authorization code/grant. Code exchange and refresh responses add `space_id` for a designated authorization while preserving all existing token fields. Existing clients, grants and legacy flows remain compatible; permissions remain per space × app × action and PKCE, Origin, CSRF, callback and expiration checks remain unchanged.

Keep external-agent permission checkboxes unchecked until the user selects them. Submitting a valid consent form with no permissions selected returns HTTP 400 with an explicit, localized instruction to select at least one permission, on the same consent page with its selectable actions and retry button. Issue no authorization code or delegation and do not redirect. Preserve session, Origin, CSRF, signed-consent and requested-scope checks. Selecting a permission and retrying continues the existing authorization-code/S256 PKCE flow. On the verified, authenticated consent document and its empty-selection retry, allow only the exact registered callback origin alongside `'self'` in CSP `form-action`, so a real browser can follow the POST’s 303 cross-origin callback and complete PKCE. Serialize the callback as a safe HTTP(S) CSP origin; never interpolate its path/query or permit policy injection or wildcard sources. All other pages retain their existing CSP restrictions. Verify the actual browser callback hit and token exchange, not only a server-side HTTP redirect.

| ID | Observable acceptance |
| --- | --- |
| BSA01 | Synthetic public registration creates exactly one owned, marked personal space atomically; retries and operator provisioning do not duplicate it, and restart preserves the origin marker. |
| BSA02 | User and platform administrator cannot delete the automatic personal space through standalone space deletion; creators/admins can delete every other space, including user-created personal spaces, with exact-ID confirmation and the existing atomic cascade. |
| BSA03 | Consent selects one accessible space, defaults to the user’s personal space and offers inline creation for a user without spaces; only the selected space’s currently allowed app/actions can be granted. |
| BSA04 | Actual browser consent and code/S256 PKCE exchange at 1440/390 px produce the designated `space_id` with existing token fields unchanged; refresh retains designation, legacy flows remain usable and Origin/CSRF/scope rejection still passes. |

## Administrator user management and deletion

Settings → Users is administrator-only and follows the Spaces section pattern. Place a **New user** section above the user list; do not put creation in the pane heading. Selecting a listed user opens a dedicated per-user detail page with account details and the existing enable/disable, password-reset and platform-administrator controls. Keep the list free of inline editors. Use `/admin/?view=users&user=<user-id>` for detail, title it with the selected username, and provide **Back to users**, browser history and reloadable user selection; ordinary users cannot view or call user-management controls.

A platform administrator can delete another user, including another administrator, but no caller may delete their own account. Use the existing centered confirmation modal, explain the cascade and require the exact typed username before enabling confirmation. Cancel, Escape or backdrop dismissal makes no request and restores focus without shifting the page. Refuse deletion if the target owns any space other than their marked automatically provisioned personal space; clearly list the owned space IDs that must be resolved through the existing space-management flow first. Do not implicitly delete those spaces.

Within the existing policy serialization boundary, account deletion atomically removes the user, native sessions, agent delegations and credentials, pending authorization codes/consent scopes, space memberships, resource permissions and administrator entry policy. Remove the marked automatically provisioned personal space with its platform authorization references and app enrollments as part of that same transaction. This is the sole exception to its protection against standalone space deletion; its app-adapter data files remain for separately authorized operator cleanup. Other users, spaces and independent authorizations remain unchanged. Old credentials and signed consent forms cannot restore access. Refresh all user pickers/selectors, clear deleted selections and return to the list without stale references.

| ID | Observable acceptance |
| --- | --- |
| USR01 | At 1440/390 px, New user section creation succeeds; the pane heading has no creation button, and choosing a user opens a dedicated account-detail page with list return, history and reload support. |
| USR02 | Existing enable/disable, password and administrator controls work on the detail page; Spaces and Agent delegations retain their existing context-switcher behavior. Ordinary users have no user-management views or API access. |
| USR03 | A native administrator deletes another user only after exact typed confirmation in the existing modal. Wrong/missing confirmation and Cancel/Escape/backdrop dismissal do not mutate; admin and ordinary self-deletion attempts are refused. |
| USR04 | An owned nonautomatic space blocks account deletion with a clear list of space IDs and no changes; the automatic personal space alone does not block deletion and is removed atomically with the account while adapter data files remain. |
| USR05 | Synthetic checks prove atomic rollback and removal of sessions, delegations/credentials/codes/consent scopes, memberships, permissions, entry policy and automatic-space references; subsequent access fails and unrelated users/spaces/authorization remain intact. |
| USR06 | Chromium at 1440/390 px verifies confirmation, detail navigation, refreshed lists and every user selector without stale deleted selections or horizontal overflow; full platform/version checks and both workbench PRD languages pass. Report deployed revision and technical evidence separately from independent business acceptance. |

## Consistent Settings control rows

All management views align controls to the main content’s left edge and actions to its right edge, including new-space, member, permission, user and password forms; forms must not introduce narrower competing right edges. Use one control-row pattern: related fields and their primary action share a horizontal row with a 12 px gap, stacking only at viewport widths of 390 px or less. Section notes have uniform 12 px spacing above and 20 px below, outside the control/action row. Use consistent field and section spacing, preserve native selects, visible focus, accessible names and touch targets, and retain static bottom clearance for controls. Focusing, opening and closing any native select must preserve the page scroll offset and surrounding layout at desktop and phone widths, including fully visible controls near the viewport bottom; never scroll the page to reserve menu space. Keep the browser-owned popup adjacent to its control and verify its actual open appearance. Do not change management operations, API payloads or authorization. Verify General, Spaces, App access, Agent delegations, Users, Data, MCP and Overview at 1440 px and 390 px with isolated synthetic fixtures, including space creation, enrollment, member and resource-permission forms, native select interaction and absence of horizontal overflow. Browser viewport checks and independent business acceptance remain separate.

## Management confirmations and delegation clarity

In Agent delegations, align status text, including **Unexpired**, to the right edge of its row at desktop and phone widths. Every delegation entry shows its full delegation ID and space ID alongside its name, using labeled monospace values that wrap safely without clipping or horizontal overflow. Identical client names must remain distinguishable by these IDs; keep expiry, scopes and existing controls intact. Add only read-only `grant.spaceIds` metadata to the existing account and administrator grant-list projections, derived as sorted unique IDs from the original grant rules, independently of effective operation scopes, so restricted and historical entries retain their space identities. This additive display field changes no route, write operation, authorization or meaning of existing fields.

All destructive-action confirmations in the management console use one centered modal dialog with a backdrop, outside document flow. Opening and closing it must leave the surrounding content geometry and scroll position unchanged. Trap keyboard focus inside the open dialog; Cancel, Escape and a backdrop click dismiss it without sending a mutation, then return focus to the invoking control. Retain exact-space-ID confirmation for space deletion and all existing action payloads and authorization checks. Keep existing acknowledged success alerts separate.

| ID | Observable acceptance |
| --- | --- |
| ADM01 | Chromium at 1440/390 px shows right-aligned delegation status and full, labeled monospace delegation and space IDs on every entry, including identical names and long IDs, without clipping or horizontal overflow. |
| ADM02 | Every management destructive confirmation opens in a centered backdrop modal; pixel assertions show zero surrounding layout shift on open/close. Tab/Shift+Tab stay inside, and Cancel/Escape/backdrop cancellation sends no mutation and restores focus. |
| ADM03 | Spaces and Agent delegations Current user are plain native user dropdowns without a search input or search interaction; pagination and selection/refresh preserve the same display context and signed-in identity. |
| ADM04 | Synthetic checks retain existing management flows, exact-ID space deletion, write payloads, authorization and all existing grant-list field semantics; `grant.spaceIds` is additive read-only metadata. All management views remain consistent at 1440/390 px; technical deployment evidence and independent business acceptance remain separate. |

## Spaces overview and per-app management

Settings → Spaces uses one screen for one job. Keep the New space form at the top of the space controls, below the administrator-only user-context row. The space overview shows the current space, its members and every installed reviewed app (fourteen in the built-in installation), including a clear indication of whether each app supports agent business actions. Every app row offers **Manage**, opening a dedicated management page for that app in that space. The page shows its current enrollment and the existing enable/disable confirmation behavior, members' permissions for this app and a grant form scoped to this app with member, resources and supported actions. It contains no other app's controls; returning to the overview preserves the space selection. Preserve existing labels and space IDs.

For installed apps without agent business actions and with grant-based web entry, enrollment grants web entry to current space members and the page explains this. It grants no business resource permission, agent action or external delegation. Protected apps remain visible with Manage and an explanation of why enrollment is unavailable: Polaris retains its platform-administrator boundary; Letters and Profiles retain their document-owner boundary. Business-capable apps retain their existing explicit resource/action authorization and require a configured business adapter to enroll. The installed catalog is complete even when only a subset has business adapters; additive capability metadata must not remove or change existing API fields or payloads.

Across every management view, adjacent sections have one separator, with nested editor sections and the first section adding no competing borders. Show success feedback in a separate browser `window.alert` dialog that closes only after user acknowledgment; add no page notice or text row and no auto-dismiss timer. The page layout and copy remain unchanged by this feedback. Display remaining error/loading notices as a fixed bottom-right overlay, above Home on phones, outside document flow: showing or clearing a notice must never insert a row or change content geometry. Error notices persist across view changes until addressed, retried or explicitly refreshed. If an operation succeeds but its follow-up read fails, keep the read error visible and do not show a success alert. During a same-view save and refresh, retain the existing controls until the refreshed result is ready; do not replace the content with an intermediate loading state that collapses its height or shifts scroll/focus. Verify actual geometry, scroll and focus stability during saves and when errors appear/clear, plus overview → app management → overview, enrollment, member add/remove and app-scoped grant/revoke with isolated synthetic fixtures in Chromium at 1440 px and 390 px, preserving accessible focus, native controls and zero horizontal overflow.

## Administrator display context in Settings

Settings → Spaces starts with a **Current user** row for platform administrators, reusing Agent delegations’ first-row native select pattern. Default to the signed-in administrator’s own account. Offer all registered users in a plain native dropdown, with pagination as needed and no search input or search interaction, retaining the signed-in administrator and selected account across pages. Selecting an account renders that user’s space read-model: enabled apps and resource permissions. This selection is display context only: it never changes the signed-in identity, session, grants or action authorization. Management affordances use the signed-in administrator’s capabilities, independently of the selected user’s projection. Delete remains available for every otherwise deletable space under any display context; owner-only enrollment, member and resource-permission controls remain available only when the signed-in administrator owns the space. Selecting another owner never lends that user’s authority. Every action continues to use the administrator’s own existing authorization checks. Keep existing APIs and management flows compatible.

Both Spaces and Agent delegations use plain native user dropdowns without search, retaining pagination as needed. Agent delegations’ **Current user** must name the actual user whose delegations are rendered, including after selection, pagination and refresh; its initial selection is the signed-in administrator. Ordinary users receive no switcher and see only their own context in both views. Ignore obsolete responses after a context change so the label and displayed data remain aligned.

| ID | Observable acceptance |
| --- | --- |
| BUC01 | An administrator sees the first-row Spaces switcher, initially selects their own account, and can select any registered user through a plain native dropdown with pagination as needed and no search interaction to render that user’s enabled apps and resource permissions, including a nonmember’s empty permission state; management controls retain the signed-in administrator’s capabilities. |
| BUC02 | Switching display context leaves native session identity and server-side authorization unchanged; synthetic permitted and denied action requests retain the administrator’s own grants. |
| BUC03 | Agent delegations initially shows the signed-in administrator and keeps Current user aligned with the actual displayed delegations across user changes, refresh and pagination. |
| BUC04 | Ordinary users have no user-context switcher and cannot select another user’s read-model. Synthetic API and Chromium checks at 1440/390 px cover these boundaries, existing flows, keyboard/native-select operation and zero horizontal overflow. |
| BUC05 | At 1440/390 px, selecting a non-creator member or nonmember preserves the administrator’s Delete action and existing exact-ID confirmed cascade in their own session. Their own owner controls also survive the switch; selecting a foreign owner exposes no owner-only controls and grants no authority. Automatic personal-space protection, ordinary-user capabilities, APIs and confirmation flows remain unchanged. |

## Self-service business spaces and app enrollment

Public registration first provisions one owned, protected personal space. After signing in, any registered user can create additional personal, family or team spaces through the public workbench and Settings flow. The creator becomes its owner; creation grants no app, resource permission, client delegation or platform role. A personal space cannot contain another member. Existing company spaces retain their team meaning and existing administrator-managed spaces keep their configured access unless an owner explicitly changes enrollment.

A space owner can enable or disable apps for that space, selecting only from the deployment's already-installed, reviewed app catalog. Persist the selection as runtime policy in the identity store. An explicit enrollment policy replaces the installation's static space list for that space, while the installed catalog and implemented operation limits remain configuration ceilings. Enrollment cannot install an app, widen its supported operations or authorize an unavailable backend. Enrolled spaces do not also require an administrator-created per-user app-entry policy: business-capable app access still requires current space membership or explicit bounded sharing and the relevant resource/action grant; apps without agent business actions provide member web entry as described above. Self-service space creation never auto-grants app data access to owners or new members; existing administrator-managed space role behavior remains compatible. The owner can manage their space even before enabling any app.

Owners add existing accounts through the product member flow and explicitly grant app resources/actions. Members can then consent to only their current implemented permissions through authorization-code + S256 PKCE and discover only the corresponding MCP tools. The same current enrollment boundary governs web authorization, bridge execution and discovery, app HTTP and background jobs. Disabling enrollment deletes that app’s resource grants and stored delegation rules for this space, so re-enabling does not revive old access. Removing a member likewise withdraws membership-dependent permissions and delegation rules. Both changes remove subsequent consent and access, including existing credentials, without affecting other spaces.

| ID | Observable acceptance |
| --- | --- |
| BSP01 | Public registration creates exactly one owned personal space without duplicate provisioning; the signed-in user can create additional spaces through the public UI. Personal spaces reject other members and all spaces start without implicit app/resource grants. |
| BSP02 | Only the owner changes durable app enrollment; unknown, uninstalled or unsupported apps/operations and cross-space or platform elevation are rejected. Existing static spaces remain compatible. |
| BSP03 | An explicitly granted synthetic member completes code/PKCE authorization and MCP discovery exposes exactly the granted app tools without a separate administrator entry policy. |
| BSP04 | Enrollment and membership revocation remove subsequent consent and tool access consistently across web, execution, discovery, app HTTP and jobs; restart retains policy and revocation. |
| BSP05 | The space overview lists all installed apps with correct agent-business capability marks; Manage opens only that app's enrollment, permissions and scoped grant controls, and return preserves the selected space. |
| BSP06 | Grant-policy non-business app enrollment provides web entry only to current space members; disabling/removing membership withdraws that entry without granting business actions. Platform-administrator/document-owner apps remain visible but cannot be enrolled by a space owner. |
| BSP07 | All management views use a single separator between sections. Success uses a browser alert acknowledged by the user, with no page row, copy change or auto-dismiss timer. Fixed error/loading notices add no layout row or geometry shift; errors persist until addressed, retried or explicitly refreshed, including failed follow-up reads. Same-view saves retain controls until refresh completes, preserving height, scroll and focus. |
| BSP08 | Synthetic API and real Chromium checks at 1440/390 px cover enrollment, member add/remove, grant/revoke, unchanged authorization and labels, zero horizontal overflow and both workbench PRD languages. |

## Creator-initiated space deletion

The signed-in user who created a space can delete it from Settings → Spaces and the documented account API; deletion follows creation and requires no additional owner/admin role. Platform administrators can delete any otherwise deletable space; the action remains visible when they select another user as display context. A member who only joined cannot delete it. Deletion protection follows the automatically provisioned personal-space origin marker, not the `personal` type. Through standalone space deletion, the automatic personal space cannot be deleted by its user or any platform administrator; every other space, including an additional user-created personal space, remains deletable by its creator or a platform administrator. Before sending a deletion, show an explicit warning and require the exact space ID to be typed and confirmed. The warning lists memberships, resource permissions, agent delegation rules and consent scopes referencing the space, per-space app enrollments and their granted web entries.

Commit the platform cascade atomically under the current policy serialization boundary: remove the space and all listed references, withdraw its access immediately, and preserve all other spaces, users and independent authorizations. Refresh lists and pickers, clear a deleted selection and show the remaining spaces or the existing empty state without stale references. App-adapter provisioned data files are outside this platform deletion operation; retain them for separately authorized operator cleanup and document that boundary.

| ID | Observable acceptance |
| --- | --- |
| BSD01 | A creator sees Delete, types the exact space ID and explicitly confirms; missing/wrong confirmation and a joined member's deletion attempt are refused without changes. No extra role gate is required. |
| BSD02 | A platform administrator deletes an otherwise deletable space; the marked automatic personal space remains protected against standalone space deletion for every caller. An additional user-created personal space is deletable by its creator or a platform administrator with the same confirmed cascade. |
| BSD03 | Synthetic deletion removes memberships, permissions, delegation rules/consent scopes, enrollments and enrollment-derived web entries atomically; immediate re-access is refused and other spaces/users/authorizations remain unchanged. App-owned files are retained. |
| BSD04 | Real Chromium flows at 1440/390 px verify warning/confirmation, cancellation, success, refreshed pickers/lists and no stale selection or horizontal overflow; both workbench PRD languages render. Source checks and test deployment evidence remain separate from independent business acceptance. |

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

Size the card deck from the page’s available viewport, not the tallest record. Keep the card frame and previous/next controls at stable positions while changing cards; overflow scrolls inside the card. Reflow with viewport changes, preserve selection and retain the inner reading position during refresh/menu actions and native-app → Home return.



Selecting card text with a mouse or pen and releasing it must preserve the selection and current card. Only a primary touch gesture may swipe between cards; ignore selection, interactive controls, cancelled gestures and modified selection keys. Keep explicit previous/next buttons and unmodified arrow-key navigation.



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

The existing bottom navigation bar contains a single icon button that toggles **Apps / For you**. It has no visible text labels; its icon, tooltip and accessible name describe the destination view. It works with keyboard and touch, and stays available as the main area scrolls. The For you card view is the workbench home: it renders first, including its loading and empty states, without switching from another view; the empty state links to Apps, the switch keeps working both ways, and restoring a saved card return still lands on that card. Both views start at the top of the main area with consistent padding, including sparse and empty states. Apps shows app and project launchers. Due dates, reminder previews, task counts and attention cards appear only in For you. Changing views keeps the selector focused and preserves the selected attention card. When the account loses the required access, clear its attention content and return to Apps. Check both languages on desktop and at phone width.

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
- **Open and return.** An authenticated account receives a personalized workbench. Offer visible apps and project entries according to current permissions, including an honest empty state. Open the selected object in the same tab. A managed app exposes the fixed lower-left Home control and supports keyboard, desktop and narrow-screen use. After sign-in restore a validated destination. Signing out returns the browser to the public product homepage. Handle loading, stale data, revocation, conflicts and uncertain writes with explicit recovery.
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
| v0.1.127 | 2026-11-20 | Default the workbench to the card view and return to the public homepage after sign-out |
| v0.1.128 | 2026-11-20 | Make the For you card deck the workbench home without a view switch |
| v0.1.129 | 2026-11-20 | Refine the public homepage: sticky header, autoplaying hero demo, authorize-ask-review order and a card design preview |
| v0.1.130 | 2026-11-20 | Restore the full-width homepage demo and refine navigation, spacing and result-card hierarchy |
| v0.1.131 | 2026-11-20 | Version homepage assets by content to prevent mixed cached layouts after deployment |
| v0.1.132 | 2026-11-20 | Refocus homepage cards on attention and simplify content with documentation and contribution navigation |
| v0.1.133 | 2026-11-20 | Restore the homepage ownership section to a left-heading and right-copy layout |
| v0.1.134 | 2026-11-20 | Replace the repeated homepage footer tagline with 55AA Security Lab copyright attribution |
| v0.1.135 | 2026-11-20 | Preserve card text selection and restrict swipe navigation to primary touch gestures |
| v0.1.136 | 2026-11-20 | Fit the card deck to the page viewport and keep paging controls stationary |
| v0.1.137 | 2026-11-20 | Merge persistent AI-native campaigns and document version updates for cross-branch integration |
| v0.1.138 | 2026-11-21 | Add public self-service account registration with bounded abuse protection |
| v0.1.139 | 2026-11-21 | Enable self-service spaces with owner-controlled app enrollment and consistent authorization |
| v0.1.140 | 2026-11-21 | Allow verified OAuth callback redirects in consent CSP and show actionable empty-selection retries |
| v0.1.141 | 2026-11-21 | Unify Settings control rows, note spacing and native select clearance across management views |
| v0.1.142 | 2026-11-21 | Keep native Settings selects stationary on focus, opening and dismissal |
| v0.1.143 | 2026-11-21 | Separate Spaces overview and per-app management with complete app catalog, bounded web enrollment, single separators and browser success alerts |
| v0.1.144 | 2026-11-21 | Add creator-confirmed atomic space deletion with personal-space protection and immediate scoped revocation |
| v0.1.145 | 2026-11-21 | Add administrator display-context switching in Spaces and correct Agent delegations current-user semantics |
| v0.1.146 | 2026-11-21 | Provision protected personal spaces, designate OAuth space and offer all-user administrator display context. |
| v0.1.147 | 2026-11-21 | Clarify delegation IDs and status, use modal confirmations and plain user dropdowns in Settings. |
| v0.1.148 | 2026-11-21 | Keep Spaces management capabilities tied to the signed-in session across display contexts |
| v0.1.149 | 2026-11-21 | Separate Users creation and detail pages and add confirmed atomic administrator account deletion |
| v0.1.150 | 2026-11-21 | Render persisted platform language before first paint |
| v0.1.151 | 2026-11-21 | Audit MCP space discovery and simplify consent and Settings error surfaces. |
| v0.1.152 | 2026-11-21 | Manage delegations across Settings surfaces and refresh Spaces user-context permissions. |

### Letters and Profiles

Letters provides an authorized reader for academic correspondence and recommendation materials. Profiles organizes CVs, cover letters, research and teaching documents. Public application repositories contain only the reusable interface, control code and synthetic fixtures. The owner opens their private collection through the authenticated workbench. The running service mounts explicitly configured data directories read-only, outside the image and public source. No original document or document inventory is published to a public repository.
