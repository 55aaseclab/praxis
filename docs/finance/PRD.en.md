# Finance requirements

A local CNY ledger for income, expenses, budgets, assets and savings projections. Set your target, record movements and compare actual and planned monthly savings. The initial ledger uses zero balances and a configurable target.

The standalone app opens its own view and keeps working data separate from its source. Integration with an external workbench uses the same renderer.

## Praxis provider

The app owns a version-1 `praxis-provider.mjs` contract for source-backed workbench cards and data-source metadata. Reads use host-supplied authorized callbacks; the provider has no direct filesystem, credential or network access. Preserve native object links, real revisions or stable content hashes, and distinct empty, partial and unavailable results. Personal card handling never modifies shared records. See [provider contract](PRAXIS-PROVIDER.md).

## App-owned Praxis integration

This app owns its reviewed `praxis-integration.mjs`: native entry policy, typed business operations and MCP guidance where supported. Praxis loads that declaration from the installed source and retains authorization, signing, policy leases and audit. Installation does not grant access or start a backend. Existing native interfaces, data ownership and recovery boundaries remain in force.

## Structured database storage

The authoritative structured store uses app-owned SQLite with stable space/resource identities and unchanged native/API/CLI behavior. Use explicit JSON import/export and lossless conversion; preserve revisions, ordering, extension fields, receipts, events and mode. Keep originals/assets separate, do not initialize a missing configured source silently, and retain immutable legacy sources and a reversible cutover. Prove synthetic parity, isolation, concurrent/replayed writes, integrity and export/reopen before deployment.
