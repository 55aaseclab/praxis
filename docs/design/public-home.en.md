# Public product homepage

Design and implementation · 2026-11-20 · [简体中文](public-home.md) · [Original English prototype](public-home.en.html) · [Original Chinese prototype](public-home.zh-CN.html)

## Purpose and scope

A person arriving from search should understand what Praxis is, see actual agent-to-app behavior and choose either trying the hosted service or running a private instance. Existing users can open the workbench directly. This is a public product surface, separate from authenticated daily work.

Implementation decision (2026-11-20): the homepage is served from the existing canonical workbench origin. Anonymous visitors opening the origin root or `/zh-cn/` receive the public homepage; signed-in sessions keep the workbench at `/`. The former workbench About Praxis link and its `/about/` pages are removed; this homepage replaces that content. Prototype HTML is superseded by the server-rendered edition in `src/public-home.mjs` with assets from `public/`.

## Visual revision — full-width example

The latest approved layout places the H1 and its two actions together above a full-width product example, replacing the side-by-side hero. Keep the actual GIF at a readable size and preserve autoplay, reduced-motion controls and no-JavaScript poster. Use a full-viewport sticky header with a compact content row, a consistent section rhythm and a result-card preview on the native workbench canvas. The card separates app identity, reason, title, due time, evidence and primary/secondary actions instead of squeezing them into one header. Keep all existing content sections, authorization/ask/review order and SEO endpoints.

## Ownership layout correction

Restore Keep the work yours to its original left/right composition: heading on the left, the two shortened data/access and trace entries stacked on the right. Phones retain a single column. Keep the removed agent-choice entry removed and leave the other homepage revisions intact.

## Content revision — attention and concise sections

Remove both visible demo caption lines; normal autoplay leaves no empty caption strip. Reduced-motion users retain the play/pause control, and no-JavaScript visitors retain the animation link. Position cards as **Your attention, on your terms.**: focus now, defer or hide, with reading kept separate from acceptance/read receipts. Stack the app-directory heading above its description. Under Keep the work yours, show only two concise columns for data/access and recorded actions; remove Your agent, your choice. Add Documentation and Contribute to the sticky header, preserving mobile wrapping and anchor clearance. English and Simplified Chinese change together.

## Visual direction

Use the native product's quiet system typography and recognizable app artwork. The distinctive content is the existing real Paseo / Praxis four-frame example with synthetic Reminder content, not a fabricated chat UI. Revision (2026-11-20, applied): the header is sticky; the hero drops the supporting paragraphs and shows the animated workbench example beside the H1, playing automatically (static poster with an explicit play control under `prefers-reduced-motion`; the poster remains the no-JavaScript and share-card image); the connection steps read Authorize → Ask → Review; and a result-card design preview follows the app directory. No fake customer logos, usage metrics, star counts or decorative dashboard replicas.

| Token | Value and purpose |
| --- | --- |
| Paper | `#ffffff`, primary canvas |
| Ink | `#252529`, headings and body |
| Secondary | `#606069`, supporting content |
| Line | `#e1e5e6`, structural separators |
| Pine | `#20584d`, primary actions and focus |
| Mist | `#f1f3f6`, workbench canvas / setup background |
| Type | Native system sans, including PingFang / Microsoft YaHei for Chinese; no remote font dependency |
| Scale | 64px desktop / 38px phone H1 (Chinese 54/32px); 34/28px section titles; 17px body, 1.65 line-height |
| Layout | 1160px maximum, 32/20px gutters; left-aligned content, generous section spacing, no repeated card grid |

The first pass considered a conventional three-benefit card row. Remove it: a real product example and an actual app directory explain this product better. Use numbered markers only for the three-step connection sequence.

## Content and flow

```text
Praxis       Apps / Get started / Documentation / Contribute / GitHub / Language / Open workbench   (sticky)

A self-hosted workbench
for your AI agent.
Try with your agent / Self-host Praxis

Full-width real example, autoplay

Authorize / Ask / Review: three actual steps

Fourteen published components: icons, names, brief purposes, source links

Attention-card preview: choose what to focus on, defer or hide

Keep the work yours: two concise columns for data/access and recorded actions

Try online: copy connection prompt, sign in, choose access, first task
Self-host: full Compose command, credentials command, local connection

Visible FAQ / source and documentation links
```

Lead copy: “A self-hosted workbench for your AI agent.” Supporting paragraphs were removed in the applied revision; the animated product example returns below the H1 and actions at full width. Protecting attention is the intent; do not promise every workflow already achieves zero clicks. Individuals, families, teams and organizations are all included without an employee-monitoring pitch.

The fourteen components use app-owned icons and names. Source links are public repository links, not anonymous links to private app records. Polaris is labelled as runtime observations and contributes no app card. The deployed directory is generated from the reviewed app registry; it is not another canonical app table.

The hosted flow copies the exact README OAuth prompt, opens the existing workbench for sign-in and gives a concrete Reminder example. State that an account is required and self-service registration is planned. The local flow starts all fourteen apps with `docker compose up --build -d --wait`, retrieves generated credentials and then uses the local MCP endpoint. No fake signup button, unsupported booking/agent execution or automatic OAuth completion.

## Interaction and accessibility

Deployment assets use content-hashed CSS/JavaScript paths. HTML and legacy unversioned aliases revalidate rather than staying fresh independently; immutable caching applies only to exact content-addressed assets. This prevents the observed mixed-version header and missing demo spacing after an upgrade.



Use links for navigation and source destinations. Copy controls update only their existing fixed icon slot and a visually hidden live region; failure preserves selectable prompt text. No inserted “Copied” row, shifting geometry or toast. The demo button updates its accessible name and `aria-pressed`; the static poster remains meaningful without JavaScript. Preserve visible focus, minimum 44px touch targets, no horizontal page overflow and two-column app directory at phone width. Do not hide the product explanation or FAQ in accordions.

## Search and sharing contract

| Item | Production design |
| --- | --- |
| Intent | Self-hosted AI-agent workbench; agent-connected apps; user-controlled access and custom apps |
| English title | `Praxis — A self-hosted workbench for your AI agent` |
| Chinese title | `Praxis — 为你的 AI 智能体准备的自托管工作台` |
| Description | Plain product summary: choose an agent, authorize app work, review results, self-host or try online |
| Language URLs | English `/`; Chinese `/zh-cn/` on the confirmed public-site origin, each self-canonical; reciprocal `hreflang=en`, `zh-Hans`, `x-default` |
| Delivery | Anonymous HTTP200, semantic pre-rendered HTML with H1/H2, normal crawlable links; no client-only translated body or forced language redirect |
| Discovery | XML sitemap with the two canonical public URLs and actual modification dates; robots permits public pages |
| Private surface | Login and business data retain authentication; robots/noindex does not protect private data |
| Structured data | Truthful `WebSite` / `SoftwareSourceCode` facts consistent with visible copy; do not invent prices, ratings, reviews or promise a rich result |
| Share | Locale-specific title/description, real synthetic product screenshot with dimensions and alt text, absolute URLs from the configured public origin |
| Media | Static screenshot for first paint; autoplay after JavaScript with normal motion; reduced-motion button or no-JavaScript animation link; explicit image dimensions, lazy lower-page icons and no blocking external fonts |

The page shares the existing canonical origin with the authenticated workbench. Preserve Calendar/Matrix browser storage, OAuth callbacks and the existing session-dependent root routing.

Design basis: [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [localized pages](https://developers.google.com/search/docs/specialty/international/localized-versions), [structured-data requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app). These practices do not guarantee indexing, ranking or rich results.

## Verified implementation checks

### v0.1.132 content revision

All six requested changes are deployed in English and Chinese. The full suite passes **443/443** checks; focused homepage/navigation checks pass20/20. Actual server-rendered browser checks cover1440/390px and320px navigation wrapping, stacked app headings, two ownership columns, removed captions, attention copy, Documentation/Contribute links and all existing motion/no-JavaScript/cache behavior. Live readback matches the versioned CSS/JS bytes. All35 non-slot containers remain unchanged; blue132 is active and green131 is healthy for rollback. Live screenshots below are updated. Local commits only; no public push.



### v0.1.131 cache regression

A browser retaining v0.1.129 CSS reproduced the reported block-layout header and zero gap below the hero actions. Without clearing that browser cache, the content-addressed stylesheet restored the flex header and 40px desktop / 30px phone gap. Source integration and the full platform suite pass **443/443** checks; English/Chinese desktop/phone and both PRD readers also pass.



### v0.1.130 visual revision

Deployed **0.1.130** at the existing canonical origin. Curl readback confirms the full-width template and exact CSS bytes in English/Chinese, with anonymous app-directory access still401. Live Chromium screenshots at both widths replace the local-fixture previews. Blue is the sole writer and green0.1.129 remains healthy for rollback; all35 non-slot containers retain their original IDs. Consistent identity/events backups and private deployment receipts remain outside Git. This release was committed locally; it was not pushed.



The final source passes **442/442** platform checks, including the public-home integration case. Four actual server-rendered scenes (English/Chinese, 1440px/390px) show the full-width demo below the two actions, a viewport-wide sticky header (69px desktop/97px phone), uncovered Apps/Get started/Self-host anchors and no horizontal overflow. Both editions retain normal-motion autoplay, reduced-motion play/pause, and a no-JavaScript poster with an explicit animation link. Clipboard success/failure leaves the control geometry unchanged. Both current PRDs opened in the workbench reader. The linked screenshots below were replaced with this server-rendered implementation.



Passed in Chromium: both editions at 1440px and 390px, all fourteen images, no horizontal overflow, keyboard skip navigation, static reduced-motion default and play/pause, exact clipboard success, denied-clipboard recovery with unchanged button geometry, and complete content with JavaScript disabled. The new requirements opened through both workbench PRD reader editions; eighteen scoped PRD checks pass. These browser checks exercise the actual server-rendered page, not the original standalone prototype. Production readback is recorded with the release deployment.

[English desktop](public-home-desktop-en.png) · [Chinese desktop](public-home-desktop-zh-CN.png) · [English phone](public-home-phone-en.png) · [Chinese phone](public-home-phone-zh-CN.png)

## Acceptance

Check both editions at 1440px and 390px, keyboard navigation, no-JavaScript content, reduced motion, exact clipboard values, stable copy-control geometry and manual-selection fallback. All fourteen names/icons/source links must be present; hosted/local instructions must remain distinct and accurate. Open the updated PRDs through the reader in both languages. Keep synthetic source checks, public deployment readback and Search Console indexing evidence distinct; Search Console submission and rankings are not established by this UI release.
