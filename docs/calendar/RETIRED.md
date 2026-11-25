# Calendar retired

Calendar was retired from the Praxis distribution on 2026-11-25 (platform release v0.1.158). The application repository `github.com/55aaseclab/calendar` was deleted at the same time.

This directory preserves the app's final public documents from release `0.2.0` at source commit `88385e6d153d06418524971291587d460e134a32`:

| Document | Content |
| --- | --- |
| [README.md](README.md) | Bilingual app guide |
| [PRD.md](PRD.md) | Bilingual product requirements (v0.2.0) |
| [ROADMAP.md](ROADMAP.md) | Bilingual roadmap |

Calendar is no longer part of the installed distribution, the workbench, the app catalog or the OAuth/MCP consent surface. Historical release rows and verification ledger entries that mention Calendar remain as history and are not updated. Browser-local agenda and `.ics` exports stayed device-local by design; no server-side calendar store existed, so there is no server data to migrate.
