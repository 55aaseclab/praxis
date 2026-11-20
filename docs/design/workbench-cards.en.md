# Workbench cards — design proposal

Status: Implementation and acceptance design for v0.1.114, 2026-11-19. The interactive prototype remains a synthetic illustration. [简体中文](workbench-cards.md) · [Interactive prototype](workbench-cards.html)



[Desktop preview](workbench-cards-desktop-en.png) · [Phone preview](workbench-cards-phone-en.png)

## Purpose

Help the person doing the work understand a result, inspect its evidence and choose when to act. The card should save the reader a round of searching or reconstructing context. Use the [employee-attention requirements](../PRD.en.md#protect-employees-attention) as the product basis.

Reading reference: [置身钉内](https://gist.github.com/horaceho/4be04df73b1f1ede458ad5cec2b94132). Its discussion of sender/receiver incentives, read receipts and card overload informs this proposal. The product choices below are Praxis design decisions.

## The card

Keep the existing Apps / For you icon switch in the bottom bar. Start the content at the top. Show one readable card with a finite, browsable queue, keyboard arrows and explicit previous/next controls. Offer a list for locating an item without turning the page into an endless feed.

| Layer | Content and purpose |
| --- | --- |
| Source and reason | Identify the owning app and the actual reason this item appeared, such as a reminder the person set or a work item assigned for their review. |
| Result or question | Use a concrete title. A decision card states the question rather than assigning a vague new task. |
| Useful preview | Show a short source-backed result or the options that need judgment. Preserve the author's language. Omit a missing preview instead of inventing one. |
| Evidence on demand | Expand the relevant source, version and unresolved facts. Link to the authorized original. |
| Main action | One clear entry into the owning app, such as Open brief, Open reminder or View options. |
| Personal handling | Later and Hide this version change the reader's presentation. Undo remains available. |

Synthetic examples in the prototype cover a revised fieldwork brief, a personal reminder and a choice of visit time. They show the intended interaction and proposed richer data. They are not connected to production services.

## Reader control

- Looking, scrolling, swiping and opening an item do not accept work, approve a result or complete an underlying record.
- Later changes when the card appears to this person. It does not change the item's deadline, assignment or shared status. Show the selected time and allow undo.
- Hide this version is private and reversible. Group subsequent updates by the underlying object; ten updates produce one current card. A new version can return at the person's next chosen review time.
- Keep a current card and its keyboard focus stable when updates arrive. Announce available updates without opening them automatically.
- Put language and personal display preferences in Settings. Normal results can wait until the reader chooses to look. Immediate interruption requires an explicitly agreed rule, a concrete impact and someone authorized to resolve it.
- Explain ordering with source facts and user preferences. Sender seniority, unread state and inferred employee availability do not determine urgency.
- Keep ordinary empty space. Empty copy is simply “There is nothing new here.” Offer Apps; avoid scoring, streaks, pressure to clear a queue or praise for finishing work.

Reading, deferral and personal display preferences stay separate from shared business progress. Workflow traces can record authorized committed actions, source versions and explicit decisions. Personal browsing is not a team performance feed. Security access logs retain their separate authorization and retention rules.

## Text-selection regression

The real mouse-selection release reproduced the previous-card bug before the fix. The synthetic browser regression now covers retained selection and native clipboard copy, selection/modifier-key protection, primary-touch navigation in both directions (including browser-generated touch events), cancellation, interactive controls and keyboard navigation in English/Chinese at1440px and390px. Run `tests/browser/attention-selection.mjs` with `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` pointing to the installed browser tooling; optional `PRAXIS_BROWSER_EVIDENCE_DIR` selects an external evidence directory. No private records are used.

## Visual and interaction language

Use the current gray workbench canvas, white cards, native system typography and pine-green actions. A single source accent identifies context. Dates use ordinary text; the interface does not turn every deadline into an alarm. Preserve existing navigation and the app-owned result view.

Use a clear title, a compact preview and quieter source metadata. Keep evidence expandable. Do not put several competing primary actions on a card. A visible focus ring, 44 CSS px targets and normal vertical scrolling apply on desktop and phone. Horizontal swipes remain optional; buttons and keyboard controls provide equivalent navigation. Mouse and pen drags select text without turning a card. Only a primary touch can start a swipe; a noncollapsed selection, interactive control, cancelled gesture or modified selection key must never turn the card.

Open enters the owning app at the particular object. Home returns to the same card and safe scroll position. Any future consequential mutation belongs to the owning app's typed, version-checked and authorized operation, with explicit intent and readback.

## Data and implementation boundaries

The app-owned provider contract supplies cards for all thirteen non-runtime apps and data inventory for all fourteen apps. Polaris is the runtime and supplies inventory and runtime trace metadata rather than workbench cards. Projections include source-backed previews, evidence and revisions. Owner-only Later/Hide state is persisted independently. See the [provider contract](../APP-PROVIDERS.md#english).

The implementation contract requires:

1. An app-owned projection with stable object identity, revision, source-backed preview, explicit reason and authorized evidence references. Readable titles, previews and counts inherit the original resource permissions. Model speculation does not become a source fact.
2. Owner-only presentation preferences keyed by user, object and revision. Deferral and hiding must not use Reminder date changes, completion or deletion as a shortcut.
3. A clear update boundary: coalesce object revisions, retain focus and let the reader choose when to display new content.
4. The existing source-app navigation and authorization rules. Additional app sources need explicit integration. An administrator-only app does not become visible to ordinary members through a card.

The running card renderer follows this target while app-owned projectors supply the data. The prototype is an interaction reference, and source, persistence and authorization checks use isolated synthetic services and app stores.

## States

| State | Presentation |
| --- | --- |
| Loading | A quiet placeholder with a loading label; no artificial task counts. |
| Empty | A brief neutral message and an Apps entry. |
| Partial | Keep the successfully authorized items and explain which update is unavailable without revealing denied resources. Offer retry. |
| Error | Explain that content could not be loaded and offer retry. Do not present unverified data as fresh. |
| Access lost | Remove protected titles, previews, counts and evidence. Discard late responses from the previous identity. |
| Revision changed | Show a factual update cue; old content cannot silently become a confirmation of a new version. |

## Acceptance for implementation

- Opening, navigating or hiding a card leaves the shared business record unchanged.
- Personal Later/Hide survives the agreed refresh/device scope and cannot be queried by another member through ordinary product interfaces. The UI explains that the source deadline stays unchanged.
- Multiple updates to one object remain one card; a refresh does not replace the card being read or steal focus.
- A meaningful result, a precise question and its evidence are understandable without opening several unrelated apps.
- Changing only the sender's organizational rank does not change ordering. A rule-based interruption can explain its specific impact.
- Source links open the exact object. Home restores the reader's position on desktop and phone, in English and Simplified Chinese.
- Missing context, partial refresh, denied resources and stale versions remain distinct. Identity loss clears protected content; the design does not promise instantaneous cross-device resource revocation that the current system lacks.
- Evaluate voluntary user effort per accepted result, evidence-finding time and avoidable interruptions. Queue-clearing rate, reading speed and individual response times are not employee scores.

Acceptance separates prototype layout checks, actual app/store projections, native HTTP authorization and preference persistence, browser-local owner boundaries, and deployed verification. A synthetic fixture or prototype is not evidence of a live business operation.
