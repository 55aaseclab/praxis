# Praxis UI/UX design guide

English · [简体中文](ui-style-guide.md)

Start with a user's task and their next decision. Opening a project should land on that project; opening a linked source should land on the requested document and passage. This defines the route, initial content and return behavior. Retain user-authored material in its original language.

## Choose the surface

| Task | Surface | Acceptance |
| --- | --- | --- |
| Open an app or project | A workbench grouped by the objects people recognize | Every project opens its corresponding Projects overview with the correct title. |
| Compare objects or switch views | A collection with persistent selection and relevant filters | Returning restores the scope, filter and reading position. |
| Read, browse or verify a citation | A reading pane with a clearly named chapter, file or page contents list | Citations reach the original passage; the table of contents crosses page boundaries. |
| Edit a record or complete a specialized action | Controls near the affected item with clear draft, saving and saved states | Users can tell whether a change was saved and can prevent unintended draft loss. |

## Navigation, return and authorization

Links navigate to addresses. Buttons act on an object, and disclosure controls reveal content in place. Use consistent action names. Home returns to the workbench, browser Back restores the previous location, and Previous section stays in the document.

Put sufficient scope in deep links, including space, project, source and passage where applicable. Reauthorize on navigation and refresh. Explain a missing or inaccessible object and offer a valid return route. Confirm access before showing private identities, counts or entries. Preserve focus and still-authorized content during refresh. On expiry, account change or revocation, clear the affected content and ignore stale responses.

Use the shared lower-left Home control on managed private pages. Keep independent apps usable on their own. Public share pages remain within the shared scope. The mobile directory can collapse while preserving location, access checks and return.

## Visible states and recovery

| State | Feedback and next action |
| --- | --- |
| First load | Name what is loading. Show related items together; independent areas may become ready separately. |
| Background refresh | Preserve focus, selection and scroll. Update changed rows without moving content under the user's pointer. |
| Empty, filtered or unknown | Show a confirmed zero, a no-matches state with a clear-filter action, or an unknown value. Offer creation only where it is supported and authorized. |
| Long or partial operation | Report actual progress and make completed portions readable. Identify what can be retried. |
| Error or uncertain write | Keep input and scope. Offer sign-in after expiry. Re-read after a timed-out write before retrying. |

Describe success by the observable result. An accepted upload, parsed source and searchable index are different states. Confirm destructive actions by naming the object and consequence.

## Operation and review

Name interactive controls. Keep focus visible, support keyboard access and restore focus on dialog close. Announce important state changes without interrupting on every poll. Honor reduced motion and provide comfortable touch targets.

Verify the path from entry to action, visible result and return. Check an app directory with a slow response, a citation to its original passage, or an editor with an interrupted save. Home acceptance includes opening the actual managed app and activating Home on desktop and a narrow viewport.

## Visual design foundations

Use this guide when creating or changing an app interface within the requested scope. The direction is a simple, content-first native application: compact navigation, clear hierarchy, restrained color, and familiar controls. **Share a visual language; choose the layout for the user's task.** Reminder is the golden reference for breathing room and the collection-app sidebar template, not a requirement to put every page into two columns. Do not copy its business data or introduce a dependency on its code or runtime.

Apple's Human Interface Guidelines inform the principles below. Reference dimensions, template choices and sample tokens are **Praxis conventions**, not Apple requirements. Explicit user choices and the owning app's requirements take precedence. Applying the guide does not authorize retrofitting untouched apps.

Platform navigation and account controls belong to Praxis, outside an app's own navigation and content. In managed private pages, provide a compact, accessible Home control fixed at the bottom left: a 44 CSS px target, inset 12 px plus device safe areas. Keep this anchor stable during scrolling, content updates and chart rendering; never scan the page to move it or rewrite the app's body viewport. Handle a demonstrated conflict with a real app control through narrow app-owned spacing. Keep account information and logout in the workbench account menu. All authenticated users use the same management page, with contents limited by their current role. Ordinary users may view their own access and manage their own agent grants; administrator modules and data remain separately protected. Permission and delegation management stays in the existing management interface; do not duplicate it in the account menu. Independently running apps and public shares do not receive private platform controls. Preserve app-local unsaved-change protection and same-tab history; do not add a runtime dependency on Praxis to independent app code.

## Choose a layout template

### One function, one interface

Different records, regions, users and service providers use the same components, layout and interactions for the same business function. Render validated data through the existing interface; isolate provider differences in narrow adapters. Do not clone renderers, page scripts or styles for another dataset, or add old controls merely to preserve an earlier page. Code owns field types, labels, units and missing states; agents fill allowlisted data rather than inventing presentation. Verify the shared interface with multiple datasets and missing values. Keep app ownership and independent operation intact; this rule does not introduce a cross-app runtime dependency.

Start with the primary task, then choose a shell. Font, color, control states, spacing rhythm and accessibility remain consistent across shells. These are design templates, not a shared runtime library or four new product features.

| Template | Use when | Structure and reference |
|---|---|---|
| Launcher | Discovering and opening apps or projects | Centered responsive icon grid with small group headings and one compact identity/navigation row. Praxis workbench uses this template. Prefer no permanent sidebar for a small set of launchers. |
| Collection | Switching among task views, routes, users or other collections while keeping navigation available | Compact sidebar and flexible main pane. Reminder is the measured golden reference below; Travel and management use this pattern where their navigation warrants it. |
| Reading | Reading documents, notes or reference material | Comfortable 65–80-character reading width; an optional contents rail for long documents and unobtrusive contextual navigation. Do not reserve an empty sidebar for short text. |
| Editor | Creating or changing content that needs sustained working space | A generous canvas or editor with a local toolbar; optional contextual inspector when it serves the task. Do not shrink a slide or document canvas merely to reproduce collection navigation. |

### Launcher template

The Praxis workbench uses a device-home-screen variant: a calm full-height canvas, recognizable app icons with names, and one compact bottom system bar for the existing brand, management, PRD collection and account actions. Keep applications and projects as peer groups. Secondary app descriptions may remain accessible without a permanent visible caption row. Reuse one DOM and renderer across desktop, tablet and phone; vary grid density and spacing through responsive CSS. Do not duplicate app entries in a second dock or introduce widgets, fake status indicators, search, pagination, drag editing or layout storage without a requirement.

Give the bottom bar a real layout row with safe-area spacing, rather than covering icons with an overlay. Let the canvas scroll when content or enlarged text exceeds the viewport. The account menu opens above its trigger, stays inside the viewport and can scroll on short screens. Every touch action needs a minimum 44 CSS px target, visible keyboard focus and complete accessible naming even when a long account label is visually shortened. Verify tablet portrait/landscape, 320–390 px phones, short landscape screens, 200% text and reduced motion alongside desktop. Scope this variant to the workbench body; readers and independent apps keep their own layouts.

Use the actual apps or projects as the main visual content. Start with a centered maximum width near 1200–1350 px, 32 px desktop / 16 px narrow outer padding, a responsive grid and modest section headings. Keep icons, labels and hit areas consistent; preserve recognizable app artwork. Avoid repeated card borders, decorative shadows, oversized titles, promotional sections, footers and extra panels that compete with launching an app.

A compact, normal-flow identity row may carry the platform name, gated management/document links and account controls. This functional row is appropriate here; it is not a mandate for a global bar in collection apps. Wrap the row and grid on narrow screens without hiding logout or permitted navigation. Preserve same-tab app navigation and scoped empty/error states. Do not add counts, filters, search or persistent navigation merely to fill space.

### Collection template: golden shell and sidebar

The reference is the actual Reminder [stylesheet](../../../third_party/reminder/public/styles.css) and [page structure](../../../third_party/reminder/public/index.html). Its desktop shell uses border-box sizing with a centered maximum width of 1350 CSS px, 32 px outer padding, and a 20 px gap between a 160 px sidebar and flexible main content. The sidebar is sticky, 32 px from the top. These dimensions establish the default breathing room; do not widen the sidebar to 180–220 px when the labels fit at 160 px. The main pane uses the shell's padding rather than adding another full outer inset.

| Element | Golden starting point at a 16 px root size |
|---|---|
| Shell | `max-width: 1350px; margin: 0 auto; padding: 32px; gap: 20px` |
| Sidebar | `width: 160px; flex-shrink: 0; position: sticky; top: 32px` |
| Main pane | Flexible remaining width; `min-width: 0` |
| Root text | 16 px, line height 1.4, system font |
| English app name | 16 px, weight 650; brand padding `0 8px 16px` |
| Chinese subtitle | Block below app name; 0.72rem (11.52 px), regular, muted, 2.4 px top gap |
| Navigation entry | 14 px label; padding `7.2px 8px`; minimum height 36 px; 8 px internal gap; 3 px between rows; 8 px radius |
| Entry icon | 18 × 18 px; rounded colored glyph area, about 5.6 px radius |
| Entry count | 12 px, muted, aligned to the trailing edge |
| Selected entry | Soft neutral background and weight 650, plus semantic current state |

### Sidebar typography and vertical alignment

Set the sidebar's font family and unitless `line-height: 1.4` locally. The app name, Chinese subtitle, and navigation rows must inherit that 1.4 line height, even when main prose uses 1.6 or a legacy page body uses 1.65. Use Reminder's exact font order for this chrome: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`. Placing `system-ui` first can select a different font and change glyph metrics on Linux. Main content may use its own reading line height without moving the sidebar's line boxes.

Keep the subtitle's top margin at `0.15rem` and the brand's bottom padding at `1rem`. Verify the resulting line boxes, not just those declarations: a larger inherited line height can push the first entry down even when the margins and sidebar width match. At a 16 px root size on desktop, the reference brand block is about 56.9 px tall, placing the first entry about 56.9 px below the sidebar's top. This is a relative offset, not a universal viewport Y coordinate. Compare the rendered brand height, English/Chinese text positions, and first-entry offset with a golden fixture in the same browser, font environment, viewport, and zoom; use the fixture's measured values with a small rendering tolerance, such as 1 CSS px. Keep such comparison fixtures local to verification rather than introducing a runtime or test dependency between apps.

The sidebar protocol is **English app name → Chinese subtitle → navigation entries**, with each entry arranged **icon → label → count**. Use a brief Chinese subtitle that explains the app, and short navigation labels that fit the compact width. Choose meaningful icons while retaining visible text labels; decorative icons should be hidden from assistive technology. Counts must represent known, meaningful quantities within the current access scope. Omit an unknown or irrelevant count instead of inventing a number or adding a badge for decoration. A known zero can be shown when useful. Do not copy Reminder's category names or record counts into another app.

Use the measured geometry as the starting point, adapting only when actual content or accessibility requires it. On touch layouts, increase row hit areas toward 44 px without enlarging the desktop sidebar. A local label that cannot fit should wrap or receive a purposeful adaptation rather than force a wide navigation rail everywhere.

### Collection shell and navigation

- On desktop, use the golden two-column shell: a 160 px leading sidebar and flexible main content pane. Let the main pane shrink without overflowing and preserve the centered outer margins and 20 px column gap.
- Put app identity and primary navigation in the sidebar using the app-name, Chinese-subtitle, icon/label/count structure above, with at most two visible navigation levels. Show the active destination with a persistent selection treatment and appropriate `aria-current` value, such as `page` for a route or `location` for a section anchor.
- For this sidebar template, omit a global top bar and footer. Begin the main pane with a moderate page title and any necessary local actions; an in-pane heading or contextual control row is appropriate. Keep important actions near the content they affect. Do not apply this sidebar-specific rule to a launcher's compact identity row or an editor's functional toolbar.
- Navigation must respect the current access scope. A restricted or shared view must not expose another collection, a private catalog, or a broader workspace through its sidebar, back links, or mobile navigation. Preserve the app's route and authorization contracts when changing presentation.
- Use a readable content width and aligned leading edges. Prose usually benefits from a limit near 65–80 characters per line; tables, maps, and editors can use more of the pane. Use normal document scrolling unless the task benefits from independently scrolling panes.

These choices adapt the navigation and grouping principles in Apple's [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) guidance. The following visual and accessibility rules apply across templates; sidebar geometry applies only where a sidebar is chosen.


## Page boundaries

Use the approved page inventory: login, workbench, management, PRD collection, and existing app or project pages. Implement new requirements inside these pages and their existing components first. Add an independent page, settings center, or navigation entry only when the user explicitly requests it. An existing protocol login or OAuth confirmation flow does not justify another permanent authorization dashboard. Treat each extra page and navigation choice as a design cost.

## Typography and spacing

Use the reference system font stack with suitable language fallbacks: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`. Keep the sidebar's local typography contract above distinct from main prose leading. Use platform text styles in native implementations. Keep ordinary text regular and headings or active items medium/semibold; avoid light weights and decorative display fonts.

| Role | Starting point for web apps |
|---|---|
| Page title | Start near Reminder's 1.45rem (23.2 px), semibold; one clear primary heading |
| Section heading | 18–20 px, medium/semibold |
| Body and controls | 15–16 px; root line height 1.4, with more leading for long passages when useful |
| Supporting metadata | 13–14 px, sufficient contrast |

Use relative units so text respects browser settings. Adjust the scale to the content without turning the title into a marketing headline. Preserve heading order and allow Chinese labels, long titles, and enlarged text to wrap.

Use a 4 px base with an 8 px spacing rhythm for content: 4–8 px within a tightly related group, 12–16 px between related elements, and 24–32 px between sections. For collection layouts, keep the measured sidebar row spacing and the golden shell's 32 px desktop / 16 px narrow outer padding rather than double-padding the main pane. Other templates use their chosen content width and the same spacing rhythm. Align labels, values, and section edges before adding visual decoration.

The hierarchy and legibility principles follow Apple's [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) guidance; the CSS sizes and spacing above are local starting points.

### Settings control rows and edge alignment

Management forms and lists share the main pane’s alignment guides: controls and object summaries begin at the left edge, and their action buttons end at the right edge. Keep one content width across sections. Do not give new-space, member, permission, account or password forms separate narrow containers that leave their actions ending at different horizontal positions. Use a full-width flex row with `justify-content: space-between`, bottom-aligned fields/actions and a defined 12 px gap; fields may grow while action buttons retain a readable width. Group related inputs on that row and place explanatory notes outside it, rather than inserting a note between a control and its button or leaving a detached submit row.

For Settings, use 16 px between field groups and 24 px between sections. Every section note has 12 px above and 20 px below. At 390 CSS px and below, stack the row with the same 12 px gap, aligning controls and actions to both content edges. Above that breakpoint keep the control/action pair horizontal. Retain visible keyboard focus, native semantic controls and the existing touch target sizes; narrow-screen targets are at least 44 CSS px high.

Keep native selects. Reserve bottom scrolling space and bring a low desktop select above its menu clearance when focused or opened, so the current value stays visible during normal selection. Native menu placement belongs to the browser/OS: inspect an actually open menu, including pointer and keyboard use, instead of inferring success from element geometry alone. Verify every management view at 1440 px and 390 px, plus 391 px for the row breakpoint, with synthetic content. Check shared left/right edges, note spacing, no horizontal overflow, unchanged submissions and current-value visibility. Apply these rules through the existing app-owned components and styles within the assigned scope.

## Color, surfaces, and controls

Use semantic app-owned tokens. A light appearance can start with this neutral palette and one accent, then adjust for the app's content and contrast requirements:

| Token role | Example |
|---|---|
| App background | `#fafafa` |
| Control / content surface | `#ffffff` |
| Selection / soft surface | `#f0f0f4` |
| Primary text | `#252529` |
| Secondary text | `#606069` |
| Decorative separator | `#e1e1e6` |
| Interactive accent | `#1672d4` |

These colors stay close to the reference while using darker secondary text for small subtitles and counts. Geometry and breathing room are the golden qualities; adjust color values where needed to preserve contrast.

Reserve accent color for links, selection, and the primary action. Give success, warning, and destructive states their own semantic roles with text or icons, rather than color alone. A decorative separator can be subtle; a boundary required to identify a control needs stronger contrast.

Prefer whitespace and thin separators to repeated containers. Use lists, tables, and sections for structured information. Use a card only when the content is a meaningful independent unit. Controls and selected rows can have modest 6–10 px corner radii; keep their size and treatment consistent. Reserve shadows for meaningful elevation, such as an overlay.

Avoid promotional hero sections, decorative illustrations, gradients, ornamental badges, oversized titles, repeated rounded cards, and unnecessary shadows. Retain useful content images, diagrams, maps, and domain-specific tools. Let real content supply the interface's character.

Light mode alone is acceptable unless the app promises more. When implementing dark mode, define and verify every semantic role, state, control, and embedded surface in both appearances; do not invert a few colors and leave unreadable exceptions. Apple's [Color](https://developer.apple.com/design/human-interface-guidelines/color) guidance supports consistent semantic color and verification across appearances; the sample hex values here are not Apple's system color specifications.

## Responsive behavior and accessibility

- Adapt to available width, not a device name. Start near 760 px with 16 px outer padding. For a collection shell, stack the panes and make the sidebar static; for a launcher, wrap the compact navigation and reduce grid columns; for reading, collapse the optional contents rail; for editing, keep the workspace useful and move secondary controls out of its way. Preserve destinations, active state and access scope. Do not introduce a marketing header on small screens.
- Stack content and action groups as needed. Allow long text to wrap; contain necessary wide tables or maps locally instead of making the whole page scroll sideways. Check narrow screens and 200% text/zoom for clipped text or hidden controls.
- Use native semantic links, buttons, form fields, navigation, and main landmarks. Give controls accessible names; keep keyboard order logical and focus visible. For collapsible navigation, expose expanded state, support keyboard dismissal where applicable, and restore focus to the trigger when it closes.
- Aim for comfortable touch targets around 44 × 44 CSS px, with enough separation to prevent accidental taps. A compact visible icon can have a larger hit area. Preserve keyboard and pointer usability as well.
- Meet contrast of at least 4.5:1 for ordinary text, 3:1 for qualifying large text, and 3:1 for meaningful control/state indicators against adjacent colors. Do not rely solely on color to communicate selection or status. Respect reduced-motion preferences and avoid decorative automatic motion.

These usability principles draw on Apple's [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) guidance. Web contrast thresholds follow W3C's [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) criteria; the touch-target recommendation is a Praxis web default, not a conversion of Apple points.

## Content, ownership, and review

Preserve the app's UI language and user-authored content; Praxis interfaces default to Chinese. Keep code, comments, internal errors, and CLI output in English. Write concise labels that explain the user's action. Keep implementation details, debug information, internal paths, and architectural explanations out of product flows unless they help the user make a meaningful decision. Empty and error states should provide useful next steps.

Implement tokens, styles, and components in the owning app. This document is shared guidance, not a central CSS package or runtime dependency. An app must retain its own data, behavior, deployment, and ability to run independently; do not import another app to obtain its appearance.

Before delivery, review desktop and narrow layouts with representative content against the chosen template. For a collection shell, compare the 160 px sidebar, 20 px gap, 32 px padding and brand/first-entry line boxes with Reminder in the same browser. For a launcher, check grid alignment, compact navigation, scoped empty states and the absence of unnecessary panels. For reading or editing, check useful content width and contextual controls. Across templates, verify hierarchy, spacing, keyboard focus, long text, zoom, contrast and every implemented appearance. Follow a restricted view's actual URL and confirm that navigation and content remain within its access scope. Preserve the app's existing content and interactions.

### Knowledge section outlines

When a section has an internal heading outline, opening that section expands its outline inside the left navigation. Selecting the current section title opens that outline; its disclosure control may still collapse it. Derive the outline and anchors from the current body after content edits, including transitions from no headings to headings, while preserving sibling sections in the chapter or part. Do not require content agents to maintain navigation text or hardcode a business document title. Preserve the existing mobile navigation disclosure.
A chapter is a container; its landing section is not the chapter itself. When adding a peer section, store chapter membership through the controlled data layer and reuse the reader, rather than appending the new section body to the landing page or cloning a page implementation. Keep stable section links, sibling navigation and independent document versions.

### Hover previews and copy feedback

A preview/copy control shows the pointer cursor over its complete hit area and text. Reveal full values in a bounded overlay on hover/focus and provide touch access. Keep copy, success and failure in the same reserved icon slot; use a hidden live region for announcements. Avoid inserting feedback rows, replacing the visible value, moving focus/scroll or animating text. Stable background refreshes retain the trigger DOM and active preview. Clear protected previews on identity/navigation changes.
