# Public product homepage

Design proposal · 2026-11-20 · [简体中文](public-home.md) · [English prototype](public-home.en.html) · [Chinese prototype](public-home.zh-CN.html)

## Purpose and scope

A person arriving from search should understand what Praxis is, see actual agent-to-app behavior and choose either trying the hosted service or running a private instance. Existing users can open the workbench directly. This is a public product surface, separate from authenticated daily work.

Implementation decision (2026-11-20): the homepage is served from the existing canonical workbench origin. Anonymous visitors opening the origin root or `/zh-cn/` receive the public homepage; signed-in sessions keep the workbench at `/`. The former workbench About Praxis link and its `/about/` pages are removed; this homepage replaces that content. Prototype HTML is superseded by the server-rendered edition in `src/public-home.mjs` with assets from `public/`.

## Visual direction

Use the native product's quiet system typography and recognizable app artwork. The distinctive content is the existing real Paseo / Praxis four-frame example with synthetic Reminder content, not a fabricated chat UI. Show a static poster first, with explicit play/pause and a reduced-motion default. No fake customer logos, usage metrics, star counts or decorative dashboard replicas.

| Token | Value and purpose |
| --- | --- |
| Paper | `#ffffff`, primary canvas |
| Ink | `#252529`, headings and body |
| Secondary | `#606069`, supporting content |
| Line | `#e1e5e6`, structural separators |
| Pine | `#20584d`, primary actions and focus |
| Mist | `#f1f4f5`, product example / setup background |
| Type | Native system sans, including PingFang / Microsoft YaHei for Chinese; no remote font dependency |
| Scale | 64px desktop / 38px phone H1 (Chinese 54/32px); 36/28px section titles; 17px body, 1.65 line-height |
| Layout | 1160px maximum, 32/20px gutters; left-aligned content, generous section spacing, no repeated card grid |

The first pass considered a conventional three-benefit card row. Remove it: a real product example and an actual app directory explain this product better. Use numbered markers only for the three-step connection sequence.

## Content and flow

```text
Praxis       Apps / Get started / GitHub / Language / Open workbench

A self-hosted workbench              Ask for an outcome. Choose access.
for your AI agent.                  Review and use the result.
Try with your agent / Self-host Praxis

Actual Paseo + Praxis example, poster / play control

Ask / Authorize / Review: three actual steps

Fourteen published components: icons, names, brief purposes, source links

Keep the work yours: data ownership, trace evidence, build your own apps

Try online: copy connection prompt, sign in, choose access, first task
Self-host: full Compose command, credentials command, local connection

Visible FAQ / source and documentation links
```

Lead copy: “A self-hosted workbench for your AI agent.” Supporting copy explains that people ask for an outcome, choose access and review/use results. Protecting attention is the intent; do not promise every workflow already achieves zero clicks. Individuals, families, teams and organizations are all included without an employee-monitoring pitch.

The fourteen components use app-owned icons and names. Source links are public repository links, not anonymous links to private app records. Polaris is labelled as runtime observations and contributes no app card. Future production rendering should generate this release directory from the reviewed app registry rather than maintain another canonical app table.

The hosted flow copies the exact README OAuth prompt, opens the existing workbench for sign-in and gives a concrete Reminder example. State that an account is required and self-service registration is planned. The local flow starts all fourteen apps with `docker compose up --build -d --wait`, retrieves generated credentials and then uses the local MCP endpoint. No fake signup button, unsupported booking/agent execution or automatic OAuth completion.

## Interaction and accessibility

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
| Media | Static responsive screenshot for first paint; user-requested animation; explicit image dimensions, lazy lower-page icons and no blocking external fonts |

The separate public-site origin avoids moving browser-local Calendar/Matrix state or changing existing OAuth callbacks. If later hosted on the same origin, decide its root/workbench routing and compatibility before implementation; do not silently displace the current root or create a second installation.

Design basis: [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [localized pages](https://developers.google.com/search/docs/specialty/international/localized-versions), [structured-data requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app). These practices do not guarantee indexing, ranking or rich results.

## Prototype checks

Passed in Chromium: both editions at 1440px and 390px, all fourteen images, no horizontal overflow, keyboard skip navigation, static reduced-motion default and play/pause, exact clipboard success, denied-clipboard recovery with unchanged button geometry, and complete content with JavaScript disabled. The new requirements opened through both workbench PRD reader editions; eighteen scoped PRD checks pass. These are local design-prototype results, not deployed SEO evidence.

[English desktop](public-home-desktop-en.png) · [Chinese desktop](public-home-desktop-zh-CN.png) · [English phone](public-home-phone-en.png) · [Chinese phone](public-home-phone-zh-CN.png)

## Acceptance

Check both editions at 1440px and 390px, keyboard navigation, no-JavaScript content, reduced motion, exact clipboard values, stable copy-control geometry and manual-selection fallback. All fourteen names/icons/source links must be present; hosted/local instructions must remain distinct and accurate. Open the updated PRDs through the reader in both languages. Record prototype evidence separately from production SEO: canonical host, sitemap, Search Console submission and public deployment remain unimplemented in this design phase.
