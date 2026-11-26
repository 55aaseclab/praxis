# Dynamic backup coverage for business spaces

English · [简体中文](BUSINESS-STORAGE.md)

The app owns the source of truth. Before each replica job, call `withBusinessBackupSources(storageConfig, businessConfig, { knownActiveSources })` to construct a temporary storage configuration for the existing snapshot and encrypted-replica pipeline. This operation leaves the active business data and on-disk registry in place.

Coverage includes:

- Identity, delegation, audit, event and pending synchronization state in `database` and `eventsDatabase`. SQLite online backup includes committed changes in the WAL.
- The configured TingProof data file, `apps.tingproof.dataFile`, and the Projects and Memo databases (`projects.db` and `memo.db` under each configured app’s `dataDir`). A source already registered at the same path is reused.

The function reads protected mappings and SQLite event metadata. It does not need task or correction text. Sources are deduplicated by real path. Conflicting types, targets or space bindings fail. Paths that escape their root, symbolic links and overlaps with staging or replica repositories are rejected.

A new space with no evidence of activity may lack a file. Report it as `uninitialized` in `coverage.omitted`. A missing source previously registered, observed in events or supplied in `knownActiveSources` fails the job and leaves work pending.

The worker should persist previously observed active source paths in a private coverage inventory outside Git and pass them back on subsequent runs, including after restart. Event collection alone can miss the interval between the first commit and collection if the file disappears in that interval. Record whether the persistent inventory covers this case. Keep only source identities and paths in the inventory.

Report included sources, uninitialized omissions and failures separately. A complete input inventory establishes the contents of a snapshot. Cloud upload and a successful restore require separate receipts. Authorization metadata in the identity database belongs in encrypted backups. Keep app signing keys and recovery material separate. [Storage guide](STORAGE.en.md) · [Verification guide](VERIFICATION.en.md)
