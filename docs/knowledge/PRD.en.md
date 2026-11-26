# Knowledge requirements

> Retired from the Praxis distribution on 2026-11-25; archived documents, see [RETIRED.md](RETIRED.md).

Browse workspace libraries, read documents and notes, search indexed passages and inspect paper statistics. The runtime supports revisioned entries, an attachment inbox, document parsing and scoped business operations. New installations start empty.

The standalone app opens its own view and keeps working data separate from its source. Integration with an external workbench uses the same renderer. The interface follows the workbench language preference exclusively; no in-app language control renders. The library sidebar renders the content directory as a self-evident list without a literal contents label, and the reading view keeps its page-outline block.

## Praxis provider

The app owns a version-1 `praxis-provider.mjs` contract for source-backed workbench cards and data-source metadata. Reads use host-supplied authorized callbacks; the provider has no direct filesystem, credential or network access. Preserve native object links, real revisions or stable content hashes, and distinct empty, partial and unavailable results. Personal card handling never modifies shared records. See [provider contract](PRAXIS-PROVIDER.md).

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.
