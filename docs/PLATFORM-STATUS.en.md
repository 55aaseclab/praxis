# Status overview in Settings

English · [简体中文](PLATFORM-STATUS.md)

Administrators see permission coverage, connections and storage state in **Settings → Overview**. Other accounts neither fetch nor display global status. Each group shows when it was checked and distinguishes unknown, unavailable, stale and in-progress results. Refresh manually or every 30 seconds. Viewing status runs no backup, synchronization or permission mutation. [Platform manual](PLATFORM.en.md)

Local Chart.js renders counts, coverage and aggregated durations alongside accessible numeric tables. Tables show connection and replica state, time, scope and definitions. Unknown and stale values remain distinct from zero. Draw a historical trend only when history was collected. Dispose of charts on refresh, navigation and invalidation. If the chart library fails, the tables remain available. All chart assets are same-origin.

## Access and configuration

Settings (`/admin/`) opens the General section. Administrators can select Overview to see status, MCP call traces and always-expanded usage observations. Users, app access and agent delegations have separate sections. Ordinary members can choose their language and review their own access and delegations. The current `canViewPlatform` reflects a platform administrator role and each read-only API rechecks it. Disabled or expired sessions, external clients and business Bearer credentials are refused. Clear details on logout or loss of authority. Do not persist the overview in browser storage.

Use the canonical HTTPS workbench. Plain HTTP on another origin cannot use its secure browser cookie. A synthetic browser test does not establish real phone connectivity when the external chain is unavailable.

Optional private core configuration:

```json
{
  "console": {
    "storageStatusFile": "/private/praxis/platform-status/storage.json",
    "storageConfigFile": "/private/praxis/config/storage.json"
  }
}
```

Use a separate 700 directory outside Git and 600 JSON files. The stack validates the configuration. The core backend mounts redacted output read-only. The web process has no storage configuration, raw data, keys or Docker socket mount. The status publisher reads existing configuration, repository outcomes and worker heartbeats and writes a fixed projection without network access. Updating the Settings page does not require restarting a running backup.

A fixed local proxy maps `/api/platform/status` to `/api/business/console/status`, and `/api/platform/observations?window=day|week` to the corresponding aggregate. It forwards the approved native session cookie only, rejects caller Authorization and cross-origin requests, accepts no target URL, follows no redirects and bounds time and response size. Responses are uncached.

## MCP calls in Trace

Trace opens on **MCP calls**. Its day/week summary and tool breakdown are computed from recorded calls across that window, independently of the current page of rows. Each call shows a registered tool or safe unknown/control category, outcome, duration and safe caller references. Follow the linked business lifecycle for actual authorization, dispatch, commit and readback. A returned job is accepted work, not proof that the job completed. HTTP success and tool success remain distinct.

Use `GET /api/platform/traces?source=mcp&window=day|week` through the native administrator session. Runtime observations, lifecycle history, authorization decisions and app changes remain separate selectable sources. Polaris contributes workflow context; it does not supply the MCP call count. Historical records are not backfilled into tool calls, and the capture boundary is shown explicitly. The source selector and pagination do not grant business-record access.

## Interpreting values

- Coverage includes apps integrated into unified business permissions. An unexpired grant can still lose permission to perform an action.
- A service probe measures recent reachability. Adapter configuration and actual MCP usage have distinct evidence.
- Local snapshot, remote copy and integrity checks each have their own timestamps. Reading a fresh status file performs no cloud verification.
- A replica matching the most recent snapshot may still lack newer business commits. Queued or active work has a distinct status. A missing successful coverage receipt is shown as unrecorded. Browser exports, original audio and recovery keys require separate protection.
- Daily and weekly experience data comes from the redacted observations store. Browser samples are unverified and do not measure distinct users. Capability candidates need human review.

## Recorded checks

At v0.1.29 the local Chart.js 4.6.1 views and numeric tables passed 383 root tests and browser checks for drawing, resizing, disposal, library fallback, CSP and permissions. Fourteen deployed services were healthy. No real business write or storage-worker restart was needed.

At v0.1.19 all 294 root tests passed, including isolated Docker publisher, mount and MCP checks. Read-only checks covered anonymous 401, the then-supported viewer 200, post-logout 401 and the observations report. The eight desktop entries rendered at 1280px and 390px. The status view distinguished local snapshots, an in-progress replica and absent coverage receipts.

Synthetic AuthStore users covered mixed, stale, 403/503 and delayed responses, daily/weekly aggregation and 390px, 768px and desktop layouts. The fixture uses no private account or business files. In the public checkout, run the storage status and HTTP tests with `node --test tests/storage-status.test.mjs tests/workbench-http.test.mjs`.
