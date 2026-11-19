# Usage and performance observations

English · [简体中文](OBSERVABILITY.md)

F32 records service requests, business HTTP/MCP operations, adapter calls and workbench browser events in a separate local SQLite database. Opening a tile records an attempted launch. It does not measure completion inside each independent app. Maintainers review these signals when investigating product needs.

## Enable collection

Set `createPraxisServer({ observationsFile })` or `PRAXIS_OBSERVATIONS_FILE` on the root service, and `observationsFile` in the private business service configuration. An absent setting disables collection. Both processes can share the dedicated database outside Git. Use a 700 parent directory and a 600 regular file with no symbolic or hard links. Only an existing observation database bearing its expected application identifier can be opened for writes. Keep it separate from app, identity, event and backup databases.

When a reverse proxy rewrites Host, configure the one trusted public origin using `observationsOrigin` or `PRAXIS_OBSERVATIONS_ORIGIN`. It must be HTTPS or loopback HTTP and match the browser Origin exactly. Forwarded headers do not expand it. A standalone installation with no configured origin validates against the request Host.

Prune at startup and on writes to a maximum of 30 days and 50,000 records. Routine writes wait zero time for the SQLite lock; initialization waits up to 250 ms. Lock contention, corruption, disk failures or observation errors must not alter the business result. The database has no business outbox or replica registration. Docker mounts only its designated directory. Verify production collection on the deployed service.

## What is recorded

`OBSERVATION_SCHEMA` defines field and enumeration allowlists. The server creates the ID and timestamp. It records event, route category, method, origin category, app, capability, outcome, reason and bounded nonnegative integer duration. Unrecognized categories use `other` or a fixed unknown value. Omit bodies, arguments, resource IDs, usernames, raw URLs or queries, arbitrary tool/operation names, IPs, user agents, device IDs, credentials, errors and stack traces.

Report HTTP transport, MCP protocol, business calls and adapter calls as separate groups. A successful MCP HTTP response can contain a tool-level error. Classify `isError` as denial, conflict or unavailable as appropriate. A tool hidden by permissions does not establish a missing capability. When the SDK rejects an unrecognized name early, record only its safe classification. Unknown operations may map to known search, share, import, export or scheduling categories.

Health checks, catalog discovery, internal collection and SSE system events do not appear as user failures, capability candidates or slow business calls. For SSE record connection setup time. Count a disconnected ordinary request as a single cancellation. The slow-page threshold is three seconds and the slow business/adapter threshold is one second. Report sample size, outcomes and p50/p95. Denial, concurrency conflict and unavailability carry different meanings.

## Business traces for workflow review (design goal)

The diagnostic observation store described above is short-lived and reports aggregate service behavior. Workflow review needs a business record governed by the owning project's access and retention rules. Record a minimal event for every MCP request received by the server. For business calls, capture the tool, safe outcome, duration and retry relationship, and correlate the call with the project and Polaris run wherever the server can establish that relationship. Protocol requests and denied attempts can be represented by safe categories without revealing any protected object. An absent link or an action outside the captured systems is a coverage gap.

Link the business trace to workflow and output versions, source references, human decisions and recorded acceptance or rework. Keep source content in the owning app and check access when resolving its references. Use allowlisted fields for trace events and keep raw request and response bodies and credentials out of them. Support review of business actions and decisions within the project. [Product requirements](PRD.en.md)

## Browser ingress

The workbench accepts `POST /api/observations`, JSON up to 1,024 bytes, and at most 120 entries per service instance per minute. Origin must match the request Host. If present, Sec-Fetch-Site must be `same-origin`. Browser observations are unverified client reports.

```json
{"event_name":"page_load","duration_ms":123}
```

Accepted names are `page_load`, `registry_load`, `app_open` and `page_error`. Optional fields are `duration_ms` and an app ID in the current allowlist. Durations are capped at ten minutes. Wait up to two seconds for a submission. Drop incomplete bodies. Return 204, 400, 403 or 429 according to validation and limits. Reports in **Settings → Overview** are aggregates restricted to authorized browser identities. [Status overview](PLATFORM-STATUS.en.md)

## Aggregate reports

```sh
node scripts/observations.mjs report --file /private/operational/observations.db --window day
node scripts/observations.mjs report --file /private/operational/observations.db --window week --json
```

The CLI reads existing databases. Disabled, unavailable and empty are distinct states. Day and week reports exclude observations outside the selected interval. Browser results are separate and capability candidates need human review.

Synthetic acceptance covers privacy sentinels in bodies, arguments, URLs, arbitrary names and errors; successful, denied, conflicting, unsupported and slow requests; MCP HTTP success with tool failure; excluded catalog probes; same-origin checks; size, rate and retention limits; contention and restart. At v0.1.18 all 268 root tests passed. Isolated Chromium covered a single load, privacy filtering and continued page availability during collection failure. The deployed homepage produced redacted HTTP and browser observations. Thirteen services were healthy. These checks performed no live business writes.
