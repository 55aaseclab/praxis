# Matrix Reader retired

Matrix Reader was retired from the Praxis distribution on 2026-11-25 (platform release v0.1.158). The application repository `github.com/55aaseclab/matrix-reader` was deleted at the same time.

This directory preserves the app's final public documents from release `0.1.3` at source commit `e2e9dc53cfd48cef4f2a01bafa648600b837f940`:

| Document | Content |
| --- | --- |
| [README.md](README.md) | Bilingual app guide |
| [PRD.md](PRD.md) | Bilingual product requirements (v0.1.3) |
| [ROADMAP.md](ROADMAP.md) | Bilingual roadmap |

Matrix Reader is no longer part of the installed distribution, the workbench, the app catalog or the OAuth/MCP consent surface. Historical release rows and verification ledger entries that mention Matrix Reader remain as history and are not updated. Matrix accounts, sessions, encryption keys and message history always lived in the browser and on the connected homeserver; the app kept no server-side business volume, so there is no server data to migrate. Reader devices simply lose the retired workbench origin.
