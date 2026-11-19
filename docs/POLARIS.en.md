# Polaris workspace and data

[简体中文](POLARIS.md)

## Workspace identity

Praxis storage identifies an installation by its workspace ID. The default working-data root is `<dataRoot>/workspaces/<workspaceId>/apps/polaris`. Select a different registered root with `workingData.roots.polaris`. An existing installation can also have a durable storage key used by its archives, signatures or checkpoints. Preserve both identifiers when moving storage. The administrator-facing reader checks the workspace ID on its observation file.

## Data ownership and recovery

| Data | Recovery check |
| --- | --- |
| Workspace binding and private configuration | Preserve the mapping between the workbench workspace and its durable data. Keep the original configuration with the private rollback material. |
| Run history and checkpoints | Preserve the original store. Compare the identifiers, timestamps and statuses of the authorized academic runs with the reader projection, including failed runs. |
| Archives and exports | Retain the original files, signatures and keys under the source owner's access controls. Verify copy integrity before changing the active binding. |
| Reader projection | Supply a single owner-only file with the expected workspace ID, mounted read-only. It can be regenerated from the authorized source. |
| Presentation | The platform pins the independent viewer source. Rebuild its static interface from the pinned revision. |

The earlier installation maintained a control database, workspace binding, archive and export directories, collection checkpoints and private client state. They have separate recovery requirements. Back up a live database consistently and retain its original workspace association. The hosted reader only needs the selected observation projection. Keep original archives, client state, tokens and credentials outside Git and outside the reader container.

## Running and verifying the reader

Administrators enter at `/apps/polaris/`; the local service is bound through a dedicated ingress on `127.0.0.1:18787`. The viewer checks its observation file on each API read. Recreate the read-only mount when atomic replacement changes the file's inode. Verify workspace identity, run counts by terminal status, denied access for other accounts, and the return to the workbench. During migration, keep the original private records available for recovery. [Viewer installation and observation schema](POLARIS-VIEWER.md) · [Storage and recovery](STORAGE.en.md)
