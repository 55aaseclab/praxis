# Business identity, authorization and OAuth

English · [简体中文](BUSINESS-AUTH.md)

Platform maintenance and business use have separate identities. The business identity module supplies authorization, without giving business users host administration, arbitrary file access or deployment tools. Synthetic tests and independent live client verification have separate records.

## 1. Identity store

`src/business/auth.mjs` exports `AuthStore` and `createAuthHandler`. It uses Node's built-in SQLite. Keep the mode-600 database outside Git. It holds derived passwords, authorization rules, credential digests and redacted audit records. Construct the store with `{ file, issuer, clock? }`; the optional clock supports isolated testing. Production uses a configured HTTPS issuer, with HTTP allowed only on loopback for development. Host, proxy headers and model input cannot select a different issuer, audience or browser origin.

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

Settings → Spaces and the workbench space entry are available to every signed-in native user. Creation assigns ownership from the session, accepts a personal/family/team type (`company` is the stored team type), and establishes no resource permission or delegation. The owner alone edits enrollment, members and permissions through these account endpoints. Members can read their own space details without receiving unrelated accounts or permissions. No endpoint grants platform administration or issues credentials for another user.

Paths below are relative to `/api/business/account/spaces`:

| Request | Body or result |
| --- | --- |
| `GET /` | Own spaces and the deployment's reviewed installed app catalog: `{spaces,catalog}`. |
| `POST /` | `{type}`; create a space owned by the current native session. |
| `GET /:spaceId` | Scoped `{space,apps,members,permissions}`; members receive only their permitted details. |
| `PUT /:spaceId/apps/:appId` | `{enabled}`; owner enables/disables a catalog app for this space. |
| `POST /:spaceId/members` | `{username,role:'member'}`; owner adds an existing account. Personal spaces reject other members. |
| `DELETE /:spaceId/members/:userId` | Owner removes membership and its dependent permissions/delegation slice, preserving the owner. |
| `POST /:spaceId/permissions` | `{userId,appId,resources,actions,expiresAt?}`; explicit grant within this space and the installed operation ceiling. |
| `DELETE /:spaceId/permissions/:permissionId` | Owner revokes a permission belonging to this space. |

These first-party endpoints require the native browser cookie, reject Authorization headers and require same-origin CSRF on writes. Unknown fields, foreign-space targets and elevation attempts are refused. Existing delegated space-management endpoints above retain their separate role/delegation contract.

Enrollment is durable identity-store policy, initialized with no apps for a newly created space. It can select only installed reviewed apps; enrollment is neither backend installation nor a resource grant. A space with no explicit runtime policy continues to use static app space lists. Once an owner sets an explicit policy, web authorization, bridge execution/discovery, app HTTP and app jobs consult that same current boundary. Self-service owners retain space-management authority even with no enrolled apps, but app resources require explicit grants, including for the owner. Existing administrator-managed space role behavior remains compatible. Disabling an app deletes its resource grants and stored delegation rules for this space and withdraws subsequent consent, discovery and access with existing credentials; re-enabling never revives them. Membership removal does not revive old permissions if the account rejoins. Other spaces remain unchanged.

## 5. Workbench sign-in and delegation

A website login starts an eight-hour native session. The browser uses the person's current app and resource permissions. `authorizationMode` is `native` for ordinary users and `administrator` for platform administrators. The account menu contains account information and sign-out. All signed-in users can open Settings at `/admin/`. Ordinary accounts see their own access and agent delegations and can create or manage their own business spaces. Administrators also see global status, user management and entry policies.

An external client starts the OAuth grant. Consent identifies the client and offers only currently permitted, implemented operations. The existence of a grant does not establish that the client connected or used a tool. In standalone mode, `/auth/delegate` still offers explicit first-party delegation when applicable. An empty capability set yields an empty state rather than a submittable empty scope.

`GET /auth/grants` and `DELETE /auth/grants/:id` handle the signed-in person's delegations. `POST /auth/logout` ends the current session. The cookie is `praxis_business_session` with HttpOnly, SameSite=Lax and Secure for an HTTPS issuer. `/auth/session` omits passwords, access tokens and session tokens. `delegated` refers to a real stored delegation. Bind consent to the session and request for ten minutes. Sensitive responses are uncached. The persistent login limiter allows at most ten failures in 15 minutes. Internal errors and protocol codes use English.

### Website entry and single sign-on

With `webGateway.enabled`, the workbench and managed apps use the same Praxis website identity. Sign-in, effective app entries, business permission and external delegation are different checks. Effective entries include resource-authorized apps in explicitly enrolled spaces, independently of administrator per-user entry policy. Being a space owner, family administrator or Bearer client does not grant every website entry.

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

- `GET /session` reads the current administrative session. `GET /users` lists paginated users and `POST /users` creates an identity.
- `PATCH /users/:id` enables or disables an account. `POST /users/:id/password` resets its password. Existing passwords cannot be read. Reset invalidates old sessions, codes and delegated credentials.
- `PUT /users/:id/platform-admin` changes the platform role. Disabling or demoting the last enabled administrator returns 409; a database transaction protects concurrent changes.
- `GET/PUT /users/:id/web-access` reads or updates website entry policy. `GET /users/:id/grants` is paginated and redacted. `DELETE /grants/:id` revokes the grant. Administrative calls create no implicit business space or resource grant.

`webGateway.originHost` is a fixed existing backend hostname. Fixed gateway routes set the port. Optional `shareManifestFile` is a private absolute canonical path; the business service validates configuration shape and the gateway enforces share scope. An unavailable identity service must close access to private legacy apps.

## 6. Remote OAuth for MCP

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` or its `/mcp` suffix | Resource and authorization metadata |
| `GET /.well-known/oauth-authorization-server` | Issuer, endpoints, scopes, S256 and client types |
| `POST /oauth/register` | Bounded public client registration; no arbitrary metadata fetch |
| `GET/POST /oauth/authorize` | Login, explicit scope selection and two-minute single-use code |
| `POST /oauth/token` | Code/PKCE exchange or refresh rotation |
| `POST /oauth/revoke` | Revoke the client's delegation using the corresponding credential |

The code flow requires `response_type=code`, registered `client_id`, exact `redirect_uri`, `code_challenge_method=S256`, challenge and exact `resource=${issuer}/mcp`. Exchange rechecks client, redirect, audience and verifier. The authorization response includes `iss` and the original `state`. Consent can grant only the overlap of current user permissions and requested scope.

Examples include `reminder:read`, `reminder:write`, `tingproof:read`, `tingproof:write` and `spaces:members|sharing|delegation`. Check current discovery for the complete list. A broad write scope alone does not grant all mutations or allow an ordinary guest to assign tasks. Space management requires the current owner/admin relationship.

Public protocol discovery accepts credential-free cross-origin requests. Login, delegation and session interfaces enforce browser origins. Public client registration is rate limited. Supported integration paths include preregistration, constrained DCR, public clients, code/PKCE and rotating refresh credentials. Client ID Metadata Documents, OIDC identity APIs, provider-specific plugin cards and enterprise SSO require independent implementation and verification.

## 7. Verification and deployment

- `node --test tests/business-auth.test.mjs` covers synthetic permission intersections, guest limits, personal isolation, revocation and restart, credential digests, CSRF, single-use code binding and refresh-token rotation.
- `node --test tests/app-transport.test.mjs` checks the shared enrollment boundary in execution, discovery, app HTTP and job authorization. The business authorization suite additionally covers self-service creation, member grants, code/PKCE consent, revocation, restart and elevation refusals.
- The pre-migration authorization suite also checked login rate limiting, space management and cross-process policy leases.
- The earlier web-access and administration suites exercised entry grants, persistence, withdrawal, cookie/client boundaries and configuration validation. In this checkout run `node --test tests/private-document-access.test.mjs tests/app-launcher.test.mjs` for owner access, revocation during a read and grant-filtered launchers.
- The historical browser smoke exercised Chromium against a temporary service with isolated credentials. It selected the browser via `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Check login and return, scope selection, mobile-width consent, code exchange, revocation and cross-space/action rejection.

A production deployment separately verifies adapter enforcement, legacy routes, HTTPS, real client compatibility and event withdrawal. Independent business-agent and physical-phone acceptance require their designated operators. [Verification guide](VERIFICATION.en.md)
