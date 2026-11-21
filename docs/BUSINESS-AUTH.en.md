# Business identity, authorization and OAuth

English · [简体中文](BUSINESS-AUTH.md)

Platform maintenance and business use have separate identities. The business identity module supplies authorization, without giving business users host administration, arbitrary file access or deployment tools. Synthetic tests and independent live client verification have separate records.

## 1. Identity store

`src/business/auth.mjs` exports `AuthStore` and `createAuthHandler`. It uses Node's built-in SQLite. Keep the mode-600 database outside Git. It holds derived passwords, authorization rules, credential digests and redacted audit records. Construct the store with `{ file, issuer, clock? }`; the optional clock supports isolated testing. Production uses a configured HTTPS issuer, with HTTP allowed only on loopback for development. Host, proxy headers and model input cannot select a different issuer, audience or browser origin.

Public `POST /auth/register` atomically provisions exactly one personal space owned by the new identity and records its automatic origin at creation. Provisioning is idempotent and retains an operator-provisioned personal space without duplication. The automatic space starts with no enrolled apps or resource grants and cannot be deleted by its user or platform administrators. Additional user-created personal spaces have no automatic-origin protection. Registration validation, abuse limits, response fields and separate sign-in remain unchanged.

The MCP resource identifier is `${issuer}/mcp`. The proxy routes sign-in and protocol endpoints to the same authorization service. Public metadata describes the protocol. Each MCP client uses its own user-approved delegation.

## 2. Effective authority

Each request takes the intersection of current user permissions, the client's current delegation, and the requested space, resource, action and expiration. In gateway mode also intersect with the installed reviewed catalog, implemented adapter operations and current space app enrollment. Spaces without an explicit runtime enrollment policy retain the administrator-approved per-user entries and static app/space coverage. An explicit owner-controlled enrollment policy replaces that space's static coverage and does not require a separate per-user entry policy; resource/action authorization remains mandatory. App withdrawal, expiry or a narrower adapter limit applies to existing grants, authorization codes and refresh operations. An app entry alone gives no business-resource grant.

- Personal, family and company (team) spaces are separate. Family membership has no implied access to a member's personal records.
- Owners and admins can delegate permitted operations inside their space. Platform-code and host permissions are separate.
- Members need resource permission. A guest can be granted particular resources without membership. Its scope cannot be a space-wide wildcard.
- A personal space admits no other members. It may explicitly share selected resources with bounded guest grants; group membership does not share it wholesale.
- Removing a member removes membership-dependent permissions and that space's rules from existing delegations. Rejoining does not revive them. Other spaces in the same grant retain their rules.
- On later requests, event deliveries and background operations, recheck withdrawal, account disablement and expiration.
- General creation requires a matching create rule. Possession of a grant to an existing item does not imply permission to create unrelated items. Where a separately implemented bounded create operation exists, its contract limits the new resource explicitly.

Early app actions include Reminder `read/create/update/complete/delete`, TingProof `read/submit/assign`, and separate space management actions `manage_members`, `manage_sharing` and `manage_delegation`. The latter require current owner/admin status and an appropriate client delegation. A `resources` field contains `['*']` or opaque resource IDs. Filter every list by the effective result. Discover the current tool set at runtime.

## 3. Trusted configuration interfaces

| Interface | Purpose |
| --- | --- |
| `createUser({id?, username, password})` | Create an identity with a randomly salted scrypt password derivation. Minimum password length is 12. |
| `createSpace({id?, type, ownerId})` | Create a personal, family or company space and owner relationship. |
| `deleteSpace({spaceId, actorId, confirmSpaceId})` | Atomically delete a space without automatic-personal origin protection created by this actor, or by any actor when the caller is a platform administrator; require exact-ID confirmation and preserve unrelated access. |
| `setMembership({spaceId, userId, role})` | Set admin/member or remove with null. Preserve the owner. |
| `grantResource({userId, spaceId, appId, resources, actions, expiresAt?})` | Grant explicit resource authority. Guest grants default to seven days and require concrete resources. |
| `revokeResource(id)` | Revoke a resource permission. |
| `createClient({id?, name, redirectUris})` | Register exact redirects using HTTPS or loopback HTTP. |
| `createGrant({userId, clientId, rules, expiresAt?})` | Create an explicit delegation within current user authority, up to 30 days. |
| `issueToken({grantId, ttlSeconds?})` | Issue a short-lived credential for the grant, up to one hour. |
| `revokeGrant(id)` | Revoke the grant and its access and refresh credentials. |
| `setUserEnabled(userId, enabled)` | Disabling revokes sessions and delegations. Re-enabling does not revive them. Preserve the last active platform administrator. |
| `setPlatformAdmin({userId, enabled})` | Change the platform role independently of website entry, space and business grants. Preserve the last active administrator. |

Return raw tokens only at issuance. Store SHA-256 digests, and keep passwords and tokens out of audit logs. Rotate refresh tokens. Reuse of an old refresh token revokes its whole delegation. Restarting the service does not restore revoked access.

## 4. Service interfaces

`credentialFromRequest(request)` uses Bearer when supplied. Only the absence of Authorization permits the HttpOnly session cookie. Reject malformed Authorization and duplicate same-name cookies.

| Interface | Result or behavior |
| --- | --- |
| `authenticate(credential)` | Trusted `{userId, clientId, grantId, expiresAt}`. |
| `authorize(credential, {appId, spaceId, action, resourceId?})` | Identity plus allowed `{appId, spaceId, resources, actions}`. A refusal provides `AuthError.status/code`. |
| `listSpaces(credential)` | Currently accessible spaces and relationships. |
| `requireRequestCsrf(request)` | Cookie writes require both Origin and `X-CSRF-Token`. A Bearer request must still pass business authorization. |
| `onChange(listener)`, `policyVersion` | In-process policy notifications and durable version. Across processes, poll the version or reauthorize every delivery. |
| `audit(metadata)` | Action, outcome, reason category and keyed pseudonyms. Omit raw IDs, headers, credentials and business content. |
| `withPolicyLease(async callback)` | SQLite `BEGIN IMMEDIATE` holds a cross-connection policy lock until asynchronous work finishes. A timeout returns HTTP 503 `POLICY_BUSY`. |

The owning app transaction or reliable log owns commits, record revision and idempotent outcomes. Accepted operations finish, or the signed commit window ends, before revocation commits. Once revocation succeeds, the old grant cannot commit later work. Business execution and policy changes share the serialization gate. Recheck the signed deadline at the app commit. HTTP cancellation and token expiry alone cannot prove that a remote operation stopped.

### Scoped management by space administrators

All paths below begin with `/api/business/management/spaces/:spaceId`.

| Request | Scope |
| --- | --- |
| `GET /members` | Member relationships for the selected space. |
| `PUT /members/:userId` | Add or update a member/admin by explicit user ID. Reject owner/platform elevation or cross-space changes. |
| `DELETE /members/:userId` | Remove the member and that space's delegation slice. Preserve the owner and other spaces. |
| `GET /permissions`, `POST /permissions` | List or establish resource sharing in this space. A guest requires a bounded resource set. |
| `DELETE /permissions/:permissionId` | Revoke the specified permission in this space. |
| `GET /delegations` | Only the grant rules for this space. |
| `DELETE /delegations/:grantId` | Remove this space's slice, preserving rules for other spaces in the same grant. |

Membership management, sharing and delegated management are individually authorized. Each requires both the role and its delegation. These interfaces cannot create platform administrators or issue tokens for other users. The user establishes external delegation via their own sign-in and explicit consent. Cookie writes keep same-origin and CSRF checks. Audit management changes with redacted metadata.

### Public self-service space lifecycle

Settings → Spaces and the workbench space entry are available to every signed-in native user. Creation assigns ownership from the session, accepts a personal/family/team type (`company` is the stored team type), and establishes no resource permission or delegation. The owner alone edits enrollment, other members and permissions through these account endpoints; a member can leave their own non-personal space through the dedicated endpoint below. The creator can delete any of their spaces without automatic-personal origin protection and without an additional role gate; platform administrators can delete any such space through the same endpoint, including a user-created personal space. Members can read their own space details without receiving unrelated accounts or permissions; platform administrators can list and inspect all spaces for deletion without receiving owner-only mutation rights. No endpoint grants platform administration or issues credentials for another user.

Paths below are relative to `/api/business/account/spaces`:

| Request | Body or result |
| --- | --- |
| `GET /` | Own spaces (all spaces for a platform administrator) and the deployment's reviewed installed app catalog: `{spaces,catalog}`. Each space includes `canDelete` and the origin-based `deletionProtected` flag; a nonmember administrator has `role:null`. |
| `POST /` | `{type}`; create a space owned by the current native session. |
| `GET /:spaceId` | Scoped `{space,apps,members,permissions}` with `space.canDelete` and `space.deletionProtected`; members receive only their permitted details. Platform administrators may inspect spaces for deletion. |
| `DELETE /:spaceId` | `{confirmSpaceId}` equal to the exact path ID; the creator or a platform administrator deletes a space without automatic-personal origin protection. Missing/wrong confirmation, unknown fields and joined-member attempts are refused. |
| `POST /:spaceId/leave` | No body fields (an empty object is allowed); remove only the current native session's own non-personal membership. Owner departure returns HTTP 409 `OWNER_REQUIRED`; personal spaces and nonmembers cannot leave. |
| `PUT /:spaceId/apps/:appId` | `{enabled}`; owner enables/disables a catalog app for this space. |
| `POST /:spaceId/members` | `{username,role:'member'}`; owner adds an existing account. Personal spaces reject other members. |
| `DELETE /:spaceId/members/:userId` | Owner removes membership and its dependent permissions/delegation slice, preserving the owner. |
| `POST /:spaceId/permissions` | `{userId,appId,resources,actions,expiresAt?}`; explicit grant within this space and the installed operation ceiling. |
| `DELETE /:spaceId/permissions/:permissionId` | Owner revokes a permission belonging to this space. |

For administrator display only, `GET /:spaceId?contextUserId=<registered-user-id>` adds that user’s `userContext` projection. It grants no write authority, rejects non-administrator selection and preserves the existing response when omitted.

These first-party endpoints require the native browser cookie, reject Authorization headers and require same-origin CSRF on writes. Unknown fields, foreign-space targets and elevation attempts are refused. Existing delegated space-management endpoints above retain their separate role/delegation contract.

Member departure reuses the existing `setMembership({spaceId,userId,role:null})` transaction under the policy serialization boundary: delete that member's membership and `membership_required=1` resource permissions, prune their unrevoked delegation rules referencing this space, and revoke a delegation when no rules remain. Existing access requiring membership stops immediately, including derived enrolled-app web entry; other spaces, other members and independent permissions keep their existing semantics. A failure rolls back the cleanup. Joining again does not revive removed permissions or delegation slices. The current owner remains protected by `OWNER_REQUIRED` and uses the existing confirmed delete-space flow instead. Personal spaces, including automatically provisioned personal spaces, remain single-member and have no leave concept. Existing owner and platform-administrator member-removal powers are unchanged; leave neither accepts a target user nor derives authority from a displayed-user context.

Settings shows **Leave space** only for the acting account's eligible non-personal membership. The shared centered confirmation modal warns that membership, membership-required resource permissions and space-scoped delegation rules will be removed; Cancel, Escape and backdrop dismissal do not mutate. After confirmation, refresh lists/pickers, clear the departed space/app selection, and select another currently available space or the existing empty state. Show the normal acknowledged success alert only after follow-up reads succeed. LSP01–LSP03 use isolated synthetic API checks and actual bilingual Chromium at 1440/390 px for cleanup/rollback, refusals, immediate access loss, unchanged removal flows, cancellation/focus, stable modal geometry and absence of stale references. Technical checks do not establish independent business acceptance.

Protection is determined by the automatic-personal origin marker recorded at creation, rather than the `personal` type. The automatically provisioned personal space cannot be deleted through the standalone space endpoint by any caller, including platform administrators; deleting its owner account under the administrator account-deletion contract below removes it in the same transaction. Every other space, including an additional user-created personal space, remains deletable under the creator/platform-administrator rule. Space deletion follows creation (`ownerId` records the creator); membership or a space administrator role alone gives no deletion authority. Before deletion, Settings displays a warning listing memberships, resource permissions, agent delegation rules and consent scopes referring to the space, per-space app enrollments and their derived web entries. It requires the exact opaque space ID to be typed and explicitly confirmed; cancel makes no request.

Deletion commits atomically under `controlTransaction` and the existing policy serialization boundary. It removes the space, its memberships, resource permissions, self-service marker and app-enrollment rows; removes that space's stored delegation rules and therefore pending authorization-code scopes, preserving rules for other spaces, and revokes credentials/codes when their delegation has no rules left. Signed consent forms are stateless: submitting an old form rechecks current authority and cannot establish deleted-space scopes. Existing credentials cannot recover deleted-space access. The policy notification makes subsequent authorization consult the committed deletion. Enrollment-derived web entries disappear with their membership/enrollment source; independent administrator entry policies, other spaces, accounts and unrelated authorization remain unchanged. Lists/pickers refresh and clear the deleted selection.

Adapter-provisioned app data files are retained: platform identity deletion neither opens nor deletes app-owned content. Their cleanup requires a separately authorized operator following the owning app's storage contract. Recreating a space does not restore removed permissions or delegations.

The catalog and scoped `apps` list include all installed reviewed apps (fourteen built-ins), rather than only business integrations. Retain `id`, `name` and `actions`; a business app's existing adapter ID remains its ID. Add `webAppId` (web-entry ID), `supportsBusinessActions` (declared business adapter), `businessAvailable` (configured business integration), `entryPolicy` (reviewed web-entry boundary) and `enrollmentAllowed` (whether owner enrollment is available). Existing scoped enrollment state remains unchanged. This metadata neither installs an adapter nor widens its actions. A business app without a configured adapter is visible but cannot be enrolled. Polaris remains platform-administrator-only and Letters/Profiles remain document-owner-only; they are visible with an explanation but cannot be enrolled through a space. Existing endpoint paths and write payloads remain compatible.

Settings separates the space overview's members and complete app list from **Manage** pages scoped to one app. Each page contains only that app's enrollment, current member resource permissions and grant form; the app is fixed rather than selected from another app's controls. Owner checks, member scope, resource/action bounds and enable/disable confirmation behavior remain unchanged. A grant-policy app without business actions grants web entry to current members when explicitly enrolled; it cannot accept business resource grants or create agent capabilities/delegations. Other app-owned checks remain in force. Disablement or membership removal withdraws this derived entry on subsequent access; independent administrator entry policies and other spaces keep their existing effect.

Enrollment is durable identity-store policy, initialized with no apps for a newly created space. It can select only installed reviewed apps; enrollment is neither backend installation nor a resource grant. A space with no explicit runtime policy continues to use static app space lists. Once an owner sets an explicit policy, web authorization, bridge execution/discovery, app HTTP and app jobs consult that same current boundary. Self-service owners retain space-management authority even with no enrolled apps, but app resources require explicit grants, including for the owner. Existing administrator-managed space role behavior remains compatible. Disabling an app deletes its resource grants and stored delegation rules for this space and withdraws subsequent consent, discovery and access with existing credentials; re-enabling never revives them. Membership removal does not revive old permissions if the account rejoins. Other spaces remain unchanged.

## 5. Workbench sign-in and delegation

A website login starts an eight-hour native session. The browser uses the person's current app and resource permissions. `authorizationMode` is `native` for ordinary users and `administrator` for platform administrators. The account menu contains account information and sign-out. All signed-in users can open Settings at `/admin/`. Ordinary accounts see their own access and agent delegations and can create or manage their own business spaces. Administrators also see global status, user management and entry policies.

An external client starts the OAuth grant. Consent identifies the client and explicitly selects one of the current user’s accessible spaces, defaulting to their personal space when present. The selected space filters the currently permitted, implemented operations. A user without spaces can create one inline before continuing the same request; creation grants no app/resource access. Keep selection through retries and bind the designation to consent, authorization code and grant. The existence of a grant does not establish that the client connected or used a tool. In standalone mode, `/auth/delegate` still offers explicit first-party delegation when applicable. An empty capability set yields an empty state rather than a submittable empty scope.

`GET /auth/grants` and `DELETE /auth/grants/:id` handle the signed-in person's delegations. `POST /auth/logout` ends the current session. The cookie is `praxis_business_session` with HttpOnly, SameSite=Lax and Secure for an HTTPS issuer. `/auth/session` omits passwords, access tokens and session tokens. `delegated` refers to a real stored delegation. Bind consent to the session and request for ten minutes. Sensitive responses are uncached. The persistent login limiter allows at most ten failures in 15 minutes. Internal errors and protocol codes use English.

### Website entry and single sign-on

With `webGateway.enabled`, the workbench and managed apps use the same Praxis website identity. Sign-in, effective app entries, business permission and external delegation are different checks. Effective entries include resource-authorized business apps and member entries for grant-policy non-business apps in explicitly enrolled spaces, independently of administrator per-user entry policy. Platform-administrator/document-owner entry boundaries remain unchanged. Being a space owner, family administrator or Bearer client does not grant every website entry.

`AuthStore.setWebAccess({userId,apps,prds,expiresAt,workbench})` stores administrator-controlled metadata in `auth_web_access`. Select app IDs from the supported allowlist in the current build. `prds` is Boolean. Since v0.1.24 all valid accounts have a workbench; the legacy Boolean `workbench` is accepted for compatibility. `expiresAt` is a future Unix millisecond timestamp or null for until revoked. The native browser session still expires after eight hours. An empty administrator entry policy leaves the workbench available, with any resource-authorized apps from explicitly enrolled spaces; it grants no PRD entry. It revokes future access but cannot retrieve data already downloaded.

```sh
npm run business:admin -- web-access \
  --config /absolute/private/business.json \
  --spec /absolute/private/web-access.json
```

Use a mode-600 regular spec file, for example `{"userId":"existing-user-id","apps":["tingproof"],"prds":false,"expiresAt":null}`. This maintenance interface changes entry policy without reading app data or creating a business delegation. Use the website for routine administration. A TingProof-only workbench establishes the app boundary. Separate checks control project and task access.

`GET /api/business/web-access` is available when the gateway feature is enabled. It requires an active native `praxis-browser` session, rejects Authorization headers and does not fall back from Bearer to cookie. The response includes `username`, `apps`, `workbench:true`, `prds`, `expiresAt`, `permissionsExpireAt`, `csrfToken`, `platformAdmin` and `canViewPlatform`. Keep identity expiration and entry-permission expiration distinct. Missing/expired administrator policy supplies no legacy entries or PRDs; currently authorized enrolled-space entries remain available. Corrupt policy fails closed with 503. `canViewPlatform` reflects the explicit platform administrator role. A 401 includes the canonical `loginUrl`. The administrator response also includes the native `userId` for the configured document-owner check. The response omits business records and access tokens. The gateway rechecks access and closes app HTTP/WebSocket connections at permission expiry.

### Management APIs

The first-party administrator endpoints at `/api/business/admin/*` require a native administrator session and reject Authorization headers. Writes additionally require same-origin CSRF. Ordinary users can use `/api/business/account/*` for their own session, permission summary, delegations and revocation, plus the scoped space lifecycle described above. Identity comes from the session. They receive no global user picker, chart data or installation/administrator entry-policy controls.

Enabled platform administrators receive default entries. The managed gateway restricts Letters and Profiles to the configured document owner with an active administrator session. An attempt to save an ineffective entry policy for an administrator returns 409 `ADMIN_DEFAULT_ACCESS`. Removing the role restores ordinary explicit entry and enrolled-space rules. Administrators still use their own existing space/resource/action grants for business operations. External tokens are separate from browser sessions. Standalone session modes can also be `delegated` and `none`.

Login defaults to the workbench root. A validated `return_to` preserves an app destination, while OAuth preserves its exact registered callback. Legacy `/business`, `/business/` and `/business.html` lead to the same workbench in gateway mode. Focused Reminder and TingProof pages and the space management API remain distinct. Standalone development uses its own business entry.

Relative to `/api/business/admin`:

- `GET /session` reads the current administrative session. `GET /users` lists paginated users and `POST /users` creates an identity. The administrator-only Spaces Current user selector reuses Agent delegations’ complete registered-user listing with native dropdown pagination and no search, preserves the selected account across pages and changes display context only; all requests retain the signed-in administrator’s authorization.
- `PATCH /users/:id` enables or disables an account. `POST /users/:id/password` resets its password. Existing passwords cannot be read. Reset invalidates old sessions, codes and delegated credentials.
- `PUT /users/:id/platform-admin` changes the platform role. Disabling or demoting the last enabled administrator returns 409; a database transaction protects concurrent changes.
- `GET/PUT /users/:id/web-access` reads or updates website entry policy. `GET /users/:id/grants` is paginated and redacted. `DELETE /grants/:id` revokes the grant. Administrative calls create no implicit business space or resource grant.

### Administrator account detail and deletion

Settings → Users has a **New user** section followed by the list, with no heading creation button or inline user editor. Selecting a user opens `/admin/?view=users&user=<user-id>`, a dedicated detail page titled with the username and a **Back to users** link. Refresh/deep links and browser history preserve selection. Account details, enable/disable, password reset and administrator-role controls retain their current behavior. Ordinary users have neither these views nor administrator API access.

Paths below are relative to `/api/business/admin` and retain native-administrator, Authorization-header rejection, same-origin and CSRF checks:

| Request | Body or result |
| --- | --- |
| `GET /users/:id` | `{user:{id,username,enabled,platformAdmin}}`; bounded account detail only, without password or credentials. |
| `DELETE /users/:id` | Exactly `{confirmUsername}` matching the target username. Missing/mismatched confirmation returns HTTP 400 `CONFIRMATION_REQUIRED`; reject unknown fields. No caller can delete themselves: HTTP 403 `SELF_DELETION_FORBIDDEN`. Nonadministrators are refused. |

Deletion refuses HTTP 409 `OWNED_SPACES_REQUIRED` when the target owns any nonautomatic space, returning `ownedSpaces:[{id,type}]` so Settings can clearly identify spaces to resolve through existing space management first. Do not delete or orphan these spaces. A target's marked automatically provisioned personal space does not block deletion: remove it and its platform authorization/enrollment references atomically with the account. This exception does not make that space independently deletable. Retain app-adapter data files for separately authorized operator cleanup; do not open or modify app content.

Under the existing policy serialization/control transaction, remove the user, sessions, agent delegations and credentials, pending authorization codes/consent scopes, all space memberships, resource permissions and administrator entry policy, together with the automatic personal space's references. A failure rolls back the complete operation. Deleted identities, old credentials and stateless consent submissions cannot regain access; unrelated users/spaces/independent permissions remain unchanged. The existing centered confirmation modal warns about these removals and file retention, requires the exact typed username, traps focus and dismisses without mutation on Cancel/Escape/backdrop. On success refresh lists and all user selectors, clear deleted selections, return to Users, and show the normal acknowledged success alert only after follow-up reads succeed. Use isolated synthetic fixtures for USR01–USR06, including API denials, atomic rollback, owned-space refusal, immediate revocation, retained adapter files and actual Chromium 1440/390 px detail/creation/confirmation/picker flows. Technical deployment evidence remains separate from independent business acceptance.

`webGateway.originHost` is a fixed existing backend hostname. Fixed gateway routes set the port. Optional `shareManifestFile` is a private absolute canonical path; the business service validates configuration shape and the gateway enforces share scope. An unavailable identity service must close access to private legacy apps.

## 6. Remote OAuth for MCP

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` or its `/mcp` suffix | Resource and authorization metadata |
| `GET /.well-known/oauth-authorization-server` | Issuer, endpoints, scopes, S256 and client types |
| `POST /oauth/register` | Bounded public client registration; no arbitrary metadata fetch |
| `GET/POST /oauth/authorize` | Login, explicit space and scope selection, inline space creation when needed, and two-minute single-use code |
| `POST /oauth/token` | Code/PKCE exchange or refresh rotation; additive `space_id` for designated authorizations |
| `POST /oauth/revoke` | Revoke the client's delegation using the corresponding credential |

For new designated authorizations, `space_id` accompanies the existing access-token, token-type, expiry, refresh-token and scope fields on code exchange and refresh. A designation narrows consent to that space’s allowed app/actions; it adds no grant. Existing clients, stored grants and legacy flows remain compatible, and legacy credentials without a designation retain their previous scope semantics. Preserve Origin/CSRF, signed-consent, PKCE, exact callback/resource, code lifetime/single-use and refresh rotation/reuse checks.

The code flow requires `response_type=code`, registered `client_id`, exact `redirect_uri`, `code_challenge_method=S256`, challenge and exact `resource=${issuer}/mcp`. Exchange rechecks client, redirect, audience and verifier. The authorization response includes `iss` and the original `state`. Consent can grant only the overlap of current user permissions and requested scope.

Examples include `reminder:read`, `reminder:write`, `tingproof:read`, `tingproof:write` and `spaces:members|sharing|delegation`. Check current discovery for the complete list. A broad write scope alone does not grant all mutations or allow an ordinary guest to assign tasks. Space management requires the current owner/admin relationship.

Public protocol discovery accepts credential-free cross-origin requests. Login, delegation and session interfaces enforce browser origins. Public client registration is rate limited. Supported integration paths include preregistration, constrained DCR, public clients, code/PKCE and rotating refresh credentials. Client ID Metadata Documents, OIDC identity APIs, provider-specific plugin cards and enterprise SSO require independent implementation and verification.

### Designated space chain audit · v0.1.151

The public `praxis_use_guide` and its companion skill describe the complete sequence: connect the protected `/mcp`, sign in, choose the intended accessible space directly in the consent dropdown, and explicitly select permitted actions. Inline creation remains available when no space exists and grants no app/resource permission. Code exchange and refresh return the designated `space_id`; a tool requiring `spaceId` receives that value as `tools/call` → `arguments.spaceId`, according to its published schema. These are different field spellings at the OAuth and tool boundaries.

Audit found a client gap: the installed MCP SDK's OAuth token schema strips unknown fields, including the additive `space_id`. A token extension alone therefore cannot establish that an agent can obtain the space ID. Authenticated `initialize` instructions now include the current authorized space catalog, and `praxis_refresh_capabilities` returns additive `spaces:[{spaceId,apps:[{id,actions}]}]`. Both derive from the existing `bridge.catalog` authorization intersection, expose no business records and grant no authority. Refresh recomputes the projection; do not infer permission from a historic ID, select an arbitrary first space or guess IDs. If several spaces remain possible, ask the user which intended scope to use. Legacy grants keep their existing scope semantics and may have no token designation.

The consent dropdown submits its existing GET request on change, with a narrowly hash-authorized script only on selector documents; permission submission remains an explicit POST with unchanged Origin, CSRF, signed consent and PKCE/callback binding. All other authentication documents retain their existing script restrictions. Owned-space account-deletion refusal retains the existing `#notice` persistent fixed error overlay and its complete space IDs, rather than introducing another popup.

Verification uses isolated synthetic public guidance, browser consent and actual MCP SDK calls, including a signed native Reminder service. Record the source, browser and deployed results separately below; these checks do not establish independent business-agent or physical-phone acceptance.

| Audit stage / criterion | Technical evidence | Result |
| --- | --- | --- |
| Public guidance | `tests/public-mcp.test.mjs`: actual SDK reads both language editions of `praxis_use_guide` and its companion skill, including the field mapping and fallback; 2/2 pass. Anonymous responses remain fixed guidance with no account catalog. | Pass |
| Consent designation and inline creation | `tests/business-space-designation.test.mjs` and the browser case in `tests/business-auth.test.mjs`: real Chromium at English 1440 / Chinese 390 px exercises direct native selection with keyboard/pointer, unchecked permissions, no-space inline creation, empty-consent retry, browser-followed cross-origin callback and PKCE completion. Focused browser cases 2/2 pass without skips. | Pass |
| Token and actual tool parameters | `tests/mcp-space-chain.test.mjs`: public guide → explicit consent → code/refresh `space_id` → actual SDK `reminder_list({spaceId})` against a signed native Reminder fixture. The installed SDK 1.32.2 exchange strips the extension; initialized/refreshed authorized catalog recovers the same ID and a second actual tool call succeeds. Foreign-space refusal and recomputation after enrollment removal pass. | Pass |
| MCP cleanup and shared errors (MCP01) | `tests/admin-layout.test.mjs`: Chromium English/Chinese × 1440/390 px removes the three obsolete surfaces. An actual synthetic 409 preserves account/spaces and lists two complete IDs in the exact same fixed `#notice` node as an ordinary read error: no new popup, zero content/scroll shift, persistence across views and explicit refresh clearance. Baseline already used this error mechanism; no second implementation was added. | Pass |
| Source checks and reader (MCP02–MCP03) | Final `npm test`: 502 passed, 0 failed, 9 opt-in browser skips (511 total); affected browser cases above ran separately. Both updated PRDs opened through the real workbench reader with version 0.1.151 and no overflow. | Pass |
| Independent business-agent / physical-phone acceptance | This change uses isolated maintenance fixtures only; the designated independent client owns business acceptance. | N/A — outside this technical packet |

## 7. Verification and deployment

BSA01–BSA04 and the updated BUC01 additionally require isolated synthetic registration/provisioning persistence and idempotency, automatic-origin deletion refusals for user/admin versus extra-personal-space deletion, explicit consent selection/default/inline creation, designated token `space_id` and legacy/PKCE/Origin/CSRF regression. Real Chromium at 1440/390 px checks these consent states and the administrator’s complete paginated user search and selected-user read-model; ordinary users retain their own context. These are maintenance technical checks, separate from an independent client’s business acceptance.

- `node --test tests/business-auth.test.mjs` covers synthetic permission intersections, guest limits, personal isolation, revocation and restart, credential digests, CSRF, single-use code binding and refresh-token rotation.
- `node --test tests/app-transport.test.mjs` checks the shared enrollment boundary in execution, discovery, app HTTP and job authorization. The business authorization suite additionally covers self-service creation, member grants, code/PKCE consent, revocation, restart and elevation refusals.
- `node --test tests/business-auth.test.mjs tests/admin-layout.test.mjs` covers the complete installed catalog, capability metadata and bounded non-business enrollment. The opt-in real Chromium layout checks use isolated synthetic HTTP fixtures at 1440/390 px for overview/Manage/return, enable/disable, member add/remove, app-scoped grant/revoke, single separators, browser `window.alert` success dialogs acknowledged by the user without page rows, layout/copy changes or auto-dismiss timers, and persistent errors including failed follow-up reads after successful operations (which suppress success alerts), no horizontal overflow, and both workbench PRD languages. Set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to run the browser checks; an unconfigured skip is not browser evidence.
- The authorization/layout checks additionally cover BSD01–BSD04: exact-ID confirmation/cancellation, creator and platform-administrator deletion, joined-member/automatic-personal-space refusal, user-created personal-space deletion, atomic rollback, scoped delegation/consent/enrollment removal, immediate re-access refusal and unrelated-space/user preservation. Real Chromium at 1440/390 px verifies the warning and refreshed lists/pickers with isolated fixtures; retained adapter files are documented rather than cleaned up.
- The pre-migration authorization suite also checked login rate limiting, space management and cross-process policy leases.
- The earlier web-access and administration suites exercised entry grants, persistence, withdrawal, cookie/client boundaries and configuration validation. In this checkout run `node --test tests/private-document-access.test.mjs tests/app-launcher.test.mjs` for owner access, revocation during a read and grant-filtered launchers.
- The historical browser smoke exercised Chromium against a temporary service with isolated credentials. It selected the browser via `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Check login and return, scope selection, mobile-width consent, code exchange, revocation and cross-space/action rejection.

A production deployment separately verifies adapter enforcement, legacy routes, HTTPS, real client compatibility and event withdrawal. Independent business-agent and physical-phone acceptance require their designated operators. [Verification guide](VERIFICATION.en.md)
