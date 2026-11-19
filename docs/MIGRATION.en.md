# Platform migration comparison

[简体中文](MIGRATION.md)

The frozen platform revision `8e666c2` is the source baseline for this comparison. Platform maintenance code and its synthetic tests belong in Praxis. Independently owned applications remain pinned to their own public repositories. Private business records, installation credentials and operation history remain in private storage.

## Deployment and operation contracts

| Original capability | Current source |
| --- | --- |
| Native app images and Compose services | [Dockerfile.builtins](../Dockerfile.builtins) and [compose.yaml](../compose.yaml) build the pinned native app sources. Static readers ship in the platform image. |
| Application stack control | [stack.mjs](../scripts/stack.mjs) retains plan, build, startup, assets, activation, status, logs and exec workflows. |
| Unified service control | [run-stack.mjs](../scripts/run-stack.mjs) coordinates the configured app, business, storage and observation services. |
| Business service control | [business-stack.mjs](../scripts/business-stack.mjs) preserves private identity, application keys and source mappings. |
| Backup registration | [storage-bootstrap.mjs](../scripts/storage-bootstrap.mjs) and [registry](../src/storage/registry.mjs) register existing canonical sources. |
| Application data planning | [app-data.mjs](../scripts/app-data.mjs) and [app paths](../src/storage/app-paths.mjs) retain explicit working roots and recoverable handover. |
| Operator data inventory | [data-inventory.mjs](../scripts/data-inventory.mjs) reports registered source bindings and coverage. |
| Version synchronization | [version.mjs](../scripts/version.mjs) keeps package metadata, requirements and roadmap versions aligned while preserving historical records. |
| Lattice native workbench and media | [public build adapter](../scripts/build-slides-public.mjs) and [native portal adapter](../scripts/serve-slides-public.mjs) retain the original engine, authoring, files and render endpoints. |
| Polaris observations | [viewer deployment](POLARIS-VIEWER.md) uses the separately published read-only edition and private workspace-scoped observations. |
| Existing managed installation | [managed deployment](MANAGED-DEPLOYMENT.md) preserves its explicit project names, immutable images, mounts and writer handover. |

## Verification scope

A healthy process establishes readiness. It does not establish that an original application function survived migration. Check the native browser interface and the underlying operations with synthetic records, including import, editing, authoring, file delivery and export where the app supports them. Compare the same records after service restart. Check owner, ordinary member, limited resource delegation, anonymous requests and revocation separately.

The fresh Compose installation generates private keys and identities once. Its volume binding markers detect a missing or mismatched data root. Initialization retries preserve the installation's existing account and policy. The original managed installation is verified through its own private descriptor and recovery point.

Historical private content is restored through its authorized owner and registered private bindings. Public application source and empty first-run stores are kept distinct from that content.

## Existing TingProof integration

The restored native authoring mode preserves the existing gateway entry policy for installations that have not connected TingProof to scoped business spaces. The full built-in installation enables per-space native-authoring authorization and requires full read and assignment authority across its configured spaces. An existing managed deployment enables that integration explicitly with `PRAXIS_TINGPROOF_SCOPED=true` after its space mapping is configured. Scoped external assignment calls continue to enforce their own business permissions.
