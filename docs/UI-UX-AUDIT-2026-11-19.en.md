# UI/UX audit · 19 November 2026

English · [简体中文](UI-UX-AUDIT-2026-11-19.md)

This audit covered the workbench, sign-in, Management, PRD reader, system navigation and the ten registered apps at the time. P1 means a user could be blocked, taken to the wrong object, misled about completion, or lose input. P2 identifies a navigation, feedback or accessibility obstacle where the task remains possible. [UI/UX guide](UI-UX.md)

| Surface | Observed issue and verified correction |
| --- | --- |
| Sign-in and navigation · P1 | Reauthentication or a wrong password could lose a project/section destination. The retry now keeps the account name and validated local destination, clears the password and returns to the intended object and location. |
| Workbench sign-out · P1 | A failed request previously looked like successful sign-out. Private content now closes first; confirmed sign-out redirects. An uncertain outcome provides retry or account reload. |
| Workbench load and direct access · P2 | A temporary session fetch error showed only login; a forbidden browser page could show raw JSON. The UI offers reread or a way home. APIs retain their error codes. |
| Management forms · P1 | Returning to the tab could discard a draft. Revalidated sessions retain drafts. Timed-out reads offer retry; uncertain writes prompt read-back before another save. |
| Management confirmation · P2 | Keyboard focus used to land on confirmation, and copy feedback was mouse-only. Cancel receives initial focus; Escape restores the trigger. Visible, announced copy status includes manual recovery. |
| PRD reader · P2 | Mobile TOC links previously had only line-height hit areas. Each target is at least 44 CSS px and opens its heading. |
| Reminder · P1/P2 | Failed initial catalog fetch can now retry session and catalog. Category changes retain keyboard focus in standalone and managed views. |
| Knowledge · P1/P2 | Search now matches imported filename/title. Background refresh preserves unsubmitted search text. A source can be reloaded; inaccessible project references show partial coverage. |
| Projects · P2 | Refresh preserves the expanded work item and its corresponding focus when the item still exists. |
| Memo · P1/P2 | Keyboard users can navigate scenarios, operate checklists and open photos. Escape closes a photo and restores focus. Delayed reads preserve recent checks. Failed guide reads can retry locally. |
| Finance · P1 | The edit dialog now permits read-back after revision conflict while preserving the draft. Canceling deletion preserves the entry. Back, Forward and refresh restore the linked view and filters. |
| Intelligence · P2 | Materials now open through native links. After changing comparison targets, returning to the list or following a heading, keyboard navigation resumes at the destination. |
| Travel · P1 | Failure to load category counts no longer blocks the authorized full itinerary directory. Back returns to the original day; a public share remains bounded to its itinerary. |
| Lattice · P1/P2 | Contradictory or stale links formerly opened another deck. Navigation now enforces space/resource, distinguishes empty/error, permits retry or return, and restores focus when a menu closes. |
| Polaris · P1/P2 | Settings formerly waited for about 3.52 MB of run history. Navigation opens after workspace authorization. Work/runs views load history on demand and show loading/error/retry. Enter/Space selects graph nodes; modifier-click supports a new tab. |
| TingProof · P1 | Slow subtitle/project responses formerly replaced newer selections. Latest selection wins; failure is distinguished from empty. Managed initialization/list fetch can retry. A pending correction is read-only, restores the draft on failure and requires read-back on uncertain results. Permission loss clears the task. |

Synthetic accounts and records covered retry, slow-response races, conflicts, cancellation and keyboard focus. A production read-only inspection opened 13 entry points at 390 and 1280 pixels. All returned HTTP 200 and rendered without page-wide horizontal overflow. In the initial concurrent pass the workbench, Management and PRD were not all ready. Individually reopening them succeeded. A successful entry load is separate from a successful business operation. Physical phones, individual screen-reader announcements, external maps, real media export and the full matrix of historic records/roles remained outside this inspection. The pre-migration Chromium regression exercised the sign-in, return and sign-out sequence.
