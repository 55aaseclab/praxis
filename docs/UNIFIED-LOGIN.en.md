# Unified sign-in and the public gateway

English · [简体中文](UNIFIED-LOGIN.md)

Unified sign-in arrived in v0.1.20. The deployment edge terminates TLS and forwards to a fixed upstream. The origin handles website sessions, app access, business authorization and Travel shares. [Platform manual](PLATFORM.en.md)

## User entry

Open the canonical HTTPS workbench URL for the installation and sign in with Praxis. A valid account receives a workbench showing the apps and projects it may open. For example, a dedicated TingProof account can see TingProof without access to other apps or PRDs. Task permissions inside TingProof are checked independently.

The browser reuses its same-origin secure session until the user signs out or the session is revoked. First-party users act with their own current business permissions. External agents use OAuth authorization code with PKCE and a scoped Bearer token for `/mcp`. The same issuer handles authorization, refresh and revocation. HTTP on 4321 redirects to canonical HTTPS. Raw application ports are restricted to the host. Earlier browser-local data was outside the scope of the original cutover.

## Identity and authorization

The existing identity database persists users. `auth_web_access` stores app IDs, PRD access and expiry. Every valid native browser session can enter the shell. App and PRD requests recheck entry permissions. Expired access removes content without prematurely ending the session. A missing policy gives an empty workbench; a corrupt one fails closed. Family or company space administrators do not automatically become platform administrators. Global status requires explicit platform administrator status.

A website entry grant and a business action/resource grant cover different capabilities. A business Bearer credential cannot open a legacy whole-app page. Legacy Basic authentication cannot establish a Praxis identity. The business service independently authenticates login, OAuth and API requests. Use Settings for routine account and entry changes. [Business identity and authorization](BUSINESS-AUTH.en.md)

## Runtime boundaries

Private business configuration:

```json
{
  "webGateway": {
    "enabled": true,
    "originHost": "localhost",
    "shareManifestFile": "/private/praxis/web-gateway/travel-shares.json"
  }
}
```

`originHost` selects the fixed legacy app Host. The business service uses the canonical issuer Host. The share manifest directory contains the grants, lock and atomic replacement files. Use 700 for the directory and 600 for the manifest. The gateway mounts it read-only and keeps identity databases, adapter keys and the Docker socket outside the web container. Where private readers are enabled, each has a separate read-only documents mount.

The generated Compose override runs `praxis-public` on the host network at 14321. Raw app ports and the business listener bind to loopback. Forwarding is limited to the configured local services and supports HTTP, conditional images, range requests, SSE and WebSocket. Long-lived flows recheck access every five seconds and at permission expiry. Business writes enforce current authority, resource revision and idempotency in the service and owning app.

Private images preserve ETag/Last-Modified and 304 and revalidate the browser session. Other private responses are uncached. The gateway strips spoofable identity headers and `Set-Cookie` from legacy apps. Travel shares validate the capability, single trip, expiry and revocation on every request and reject query parameters, mutations and upgrades.

## Cutover and recovery

The original transition deployed origin guards and loopback bindings first. Verify anonymous, owner and restricted users and OAuth, validate the edge’s fixed gateway configuration, reload the relay, recreate the edge to remove the old user-file mount, and retire the legacy edge share checker. Preserve other services and their certificate configuration. Current deployments use the installation’s private Compose definitions and blue/green procedure. [Managed deployment](MANAGED-DEPLOYMENT.md)

An unavailable origin returns 503. Legacy Basic-mode checks expect another authentication flow. Run `npm test` with synthetic identities and records. The original cutover also tested the edge forwarder and exercised sign-in from a browser. Separately check the live canonical redirect, restricted account behavior, metadata and revocation.

Recovery configurations are private. When restoring a relay configuration, match it to its expected origin routes, listeners and access controls. A code rollback leaves identity state, grants and business records in place.
