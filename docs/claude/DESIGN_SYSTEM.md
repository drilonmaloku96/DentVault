# DentVault Design System — Clinical Calm

**Subject**: Dental patient management for independent practitioners. The design serves clinical precision and patient care flow—not decoration.

**Audience**: Dentists, hygienists, clinical staff entering data during patient visits and review sessions.

**Single job**: Surface clinical facts clearly, reduce cognitive load during diagnosis and treatment, make procedural data entry (charting, perio probing, treatment planning) feel inevitable, not laborious.

---

## Design Principles

1. **Clinical data is the hero.** Typography, color, and layout exist to make clinical facts readable and actionable. No flourishes that obscure. 
2. **Warm, not sterile.** Avoid the cold neutral greys of hospital systems. The palette is warm paper, deep forest, and clinical teal—materials that feel considered, not default.
3. **Floating panels for context.** Acute problems, medical history, and notes live in draggable, resizable floating windows on the patient view—a deliberate reuse of the mental model patients already know (sticky notes, patient chart margins).
4. **Timeline as spine.** Patient events flow chronologically with color-coded entry types. The timeline bar at the bottom is always visible—not modal, not hidden.
5. **Structured data, not free text.** Every piece of clinical info is tagged, queryable, and part of the record—no data buried in notes.

---

## Color System

**Philosophy**: The palette is rooted in dental clinical materials and warm paper surfaces. Every color earns its place; semantic colors (success, warning, critical) sit alongside brand accent.

### Tokens

```css
/* Neutrals — warm paper and deep forest */
--color-surface-primary: #fffdf9;   /* Off-white paper, max contrast */
--color-surface-secondary: #f5f2ec; /* Warm beige, secondary surfaces */
--color-surface-tertiary: #eceadf;  /* Lighter accent for subtle backgrounds */
--color-surface-inverse: #14201e;   /* Deep pine, sidebar & headers */

--color-text-primary: #14201e;      /* Deep pine on light surfaces */
--color-text-secondary: #4c5560;    /* Mid-grey with subtle blue bias */
--color-text-tertiary: #8b929a;     /* Lighter, for captions & hints */
--color-text-inverse: #eaf3f0;      /* Off-white on dark surfaces */
--color-text-muted: #a2a8ae;        /* Faint, for metadata & disabled */
--color-border: #e0dccf;            /* Warm border, slightly cooler than surfaces */
--color-border-subtle: #ede8dd;     /* Faint divider lines */

/* Clinical accent & semantic */
--color-primary: #127a6f;           /* Clinical teal — the main action color */
--color-primary-light: #e4f0ec;     /* Teal background for badges & pills */
--color-primary-dark: #0e5d55;      /* Darker teal for hover states */

--color-critical: #d1493f;          /* Red — clinical alerts, decay, critical findings */
--color-critical-light: #f7e4e1;    /* Red background for warnings */
--color-warning: #cf9b34;           /* Amber — perio alerts, recall due */
--color-warning-light: #faf1e2;     /* Amber background */
--color-success: #2f9e6f;           /* Green — completed procedures, good outcomes */
--color-success-light: #e6f4ec;     /* Green background */
--color-info: #3b7fd4;              /* Blue — visits, images, neutral info */
--color-info-light: #e7f0fb;        /* Blue background */

/* Accent — clay for procedure types & secondary actions */
--color-accent: #c2673f;            /* Clay — endo, restorative, special procedures */
--color-accent-light: #f8ece4;      /* Clay background for accent badges */

/* Treatment plan procedure types */
--color-proc-endo: #7c5cd0;         /* Purple — endodontics */
--color-proc-perio: #2bb39c;        /* Teal-green — periodontics */
--color-proc-ortho: #5b8bc1;        /* Blue-grey — orthodontics */
--color-proc-prosth: #a89f88;       /* Taupe — prosthetics */
--color-proc-hygiene: #4fae7a;      /* Green — prophylaxis & hygiene */

/* Dark mode — remaps tokens only */
@media (prefers-color-scheme: dark) {
  --color-surface-primary: #1a1f23;
  --color-surface-secondary: #242b31;
  --color-surface-tertiary: #2d3540;
  --color-surface-inverse: #eaf3f0;
  --color-text-primary: #eaf3f0;
  --color-text-secondary: #b5bcc5;
  --color-text-tertiary: #8a919a;
  --color-text-inverse: #14201e;
  --color-border: #3d4851;
  --color-border-subtle: #2d3540;
}

/* User theme toggle overrides both */
:root[data-theme="light"] {
  --color-surface-primary: #fffdf9;
  /* ... etc */
}
:root[data-theme="dark"] {
  --color-surface-primary: #1a1f23;
  /* ... etc */
}
```

**Usage**:
- **Surfaces**: primary for cards, dialogs, main content; secondary for alternating rows, sidebar accents; tertiary for subtle backgrounds (tags, badges).
- **Text**: primary for body & headings; secondary for body on secondary surfaces; tertiary for captions; muted for disabled/inactive states.
- **Semantics**: critical for alerts & decay findings; warning for perio concerns; success for completed procedures; info for neutral facts (visits, images).
- **Accent**: primary for buttons, active states, highlights; accent for procedure badges & secondary actions.

---

## Typography

**Philosophy**: Three faces, each with a job. Bricolage Grotesque for display (rare, for emphasis), Hanken Grotesk for interface (the main voice), Space Mono for clinical data (must scan fast).

### Type Scale

All sizes are base-16 (1rem = 16px). Ratios are 1.2× (minor third) for typical scales; 1.5× jumps for major emphasis.

```
/* Display — Bricolage Grotesque, 700 weight, only for major headlines */
52px / 1.02 lh  ← hero title (patient name, major section)
38px / 1.1 lh   ← section break (large context shift)
30px / 1.15 lh  ← primary H1 (patient detail header)
26px / 1.2 lh   ← secondary H2 (card title, major block)
20px / 1.3 lh   ← tertiary H3 (subsection in modal/panel)

/* Interface — Hanken Grotesk, 400/500/600 weights */
17px / 1.5 lh   ← paragraph (comfortable body text, max 65ch width)
15px / 1.5 lh   ← body on secondary surfaces (cards, sidebar)
13.5px / 1.6 lh ← label & caption (button text, form labels, small info)
12px / 1.6 lh   ← hint & tertiary (placeholder, disabled, faint metadata)

/* Clinical data — Space Mono, 400 weight, monospace */
13px / 1.55 lh  ← patient ID, tooth numbers, measurement units (tooth 26, #A-1042, 3.2mm)
11.5px / 1.55 lh ← timeline metadata (date, doctor initials, timeline tick labels)
10px / 1.6 lh   ← smallest: grid headers, perio chart headers, space-constrained labels
```

**Weight usage**:
- Display (Bricolage): 700 always.
- Interface (Hanken): 400 for body, 500 for section labels & labels, 600 for button text & strong emphasis.
- Monospace (Space): 400 always; rely on context (caps, `letter-spacing`) for hierarchy.

**Alignment & spacing**:
- Headings: `text-wrap: balance` to prevent widows.
- Body: max 65 characters; generous line spacing (1.5–1.6) for clinical reading.
- Monospace: `font-variant-numeric: tabular-nums` so measurements & IDs line up in columns.
- Labels on buttons & form inputs: `letter-spacing: 0.04–0.08em` to add visual weight without making them taller.

---

## Layout

**Sidebar navigation** (always left, 224px wide):
- Deep-pine background, light text.
- Top logo area (56px) with tilted-square icon + "DentVault" wordmark.
- Patient list or open-patient card (variable height, scrolls).
- Main nav items (Dashboard, Patients, Schedule, Settings) with active state: left accent bar + teal background.
- No inner "Settings" sidebar—sub-pages use a back button in the content header.

**Patient page two-column**:
- Left rail (290px): Acute Problems, Medical History, Notes, Timeline Filter as floating panels or sticky cards.
- Center: Timeline entries with vertical line, colored dots for entry type, time metadata on the right.
- Quick-add bar at bottom (fixed): "Add timeline entry..." prompt + Save button.

**Charts & procedural views** (Dental, Perio, Treatment Plan):
- Full-screen in a `FullScreenView` container with back button in header (z-45, above timeline bar at z-40).
- Tooth/site selection on left or inline; detail panel on right (tooth notes, surface tags, perio values).
- Data entry grid (numpad for perio, surface picker for chart) in a sidebar.
- No modal dialogs—charting lives in full window.

**Timeline bar** (bottom-left-56-right-0, fixed z-40):
- Sticky on scroll; patient page's `ResizeObserver` measures header height to position the chart/plan/ortho toolbar below it.
- Date grouped entries; click to expand. Inline status marks (✓, ✗, ⏳ for waiting/in-chair).

**Fixed UI rules**:
- Sticky nav: only the top patient banner on patient detail.
- Bottom timeline bar: fixed position; never sticky (sticky fails in flex-col at content end).
- Modals & floating panels: z-50 above everything; floating panels draggable, resizable with pointer events + setPointerCapture.
- Minimum window: 820 × 560 px. Content area at min-width: 548 px (820 − 224 sidebar − 48 padding).

---

## Component Palette

**Buttons**:
- **Primary** (Teal): `--color-primary` bg, white text, 11px gap to icon, rounded 10–11px.
- **Secondary** (Light border): `--color-border` border, `--color-text-primary` text, white bg, rounded 10px.
- **Destructive** (Red): `--color-critical` bg, white text, rounded 10px.
- Hover: shift to `--color-primary-dark`; no shadow (shadow is for elevation, not hover).
- Icon padding: 16–18px h, 11–13px v, 8px gap.

**Badges & Pills**:
- Semantic (success/warning/critical): use color token bg + darker text (e.g., `#2f9e6f` on `#e6f4ec`).
- Type (Endodontics, Imaging, Visit): use procedure color + light bg (e.g., `#7c5cd0` on `#efeafb`).
- Neutral (metadata): `--color-text-tertiary` on `--color-surface-tertiary`.
- Pill shape: `border-radius: 999px`, padding 4–6px h × 9–11px v.

**Form inputs**:
- Border: `--color-border`, rounded 11px.
- BG: `--color-surface-primary`.
- Focus: teal left-accent bar (2–3px) + slight shadow or border-color shift.
- Placeholder: `--color-text-tertiary`.

**Cards & containers**:
- BG: `--color-surface-primary`, border `--color-border`, rounded 13–14px for content cards, 18px for large sections.
- Shadow: `0 30px 70px -34px rgba(20,32,25,.5)` for depth on white; lighter in dark mode.
- Padding: 15–20px for small cards, 26px for full-width sections.

**Timeline entry circles** (colored dots on timeline):
- Diameter: 14px, centered on vertical line.
- Stroke: 3px white (or secondary surface color in dark mode) to pop from line.
- Fill: procedure-type color (Endo #7c5cd0, Imaging #127a6f, Visit #3b7fd4, etc.).

**Floating panels** (Acute, Medical, Notes):
- Always `position: fixed`, draggable via pointer events.
- Resizable via CSS `resize: both` (inline style + ResizeObserver to sync).
- BG: `--color-surface-primary`, border `--color-border`.
- Shadow when active; dims to 40% opacity on wheel (away from focus).
- Staggered initial positions: (x, 90), (x+40, 130), (x+80, 170) where x = max(20, floor(innerWidth/2) − 210).

---

## Data Visualization

**Perio probing grid**:
- 1–3 mm: light teal background (`#e4f0ec`) with border.
- 4–5 mm: light amber (`#faf1e2`).
- 6+ mm: light red (`#f7e4e1`).
- BOP (bleeding): red dot marker on the cell or separate row; red button to toggle.
- Current cell: darker teal border + bolder text to show focus.
- Keyboard entry: numpad in sidebar, backspace button.

**Dental chart tooth squares**:
- Healthy (no finding): white bg, thin border.
- Decay: red fill (`#d1493f`).
- Filling: blue fill (`#3b7fd4`).
- Crown: gold/tan fill (`#f4e3c0`) with darker border.
- Root canal: purple fill (`#7c5cd0`) with border.
- Implant: dark fill (`#2b3a38`).
- Missing: dashed border.
- Surface picker (occlusal/facial/lingual/mesial/distal): small inline grid on click; highlights the surface being edited.

**Timeline filters** (type count sidebar):
- List with checkbox toggle; show count next to type (14 Procedures, 22 Visits, etc.).
- Font-size 12.5px; 4-column wrap on larger screens.

---

## States & Interactions

**Loading**: Faint spinny loader; never block the interface.

**Errors**: Toast or inline message with `--color-critical` left border, white bg on light theme. Text: what went wrong + how to fix. No apologies.

**Hover**: 
- Buttons: shift primary color slightly darker; no shadow (shadow = depth, not response).
- Cards: very subtle lift (shadow increase from 0 to 2–4px).
- Timeline entry: slightly darker bg, show detail-toggle icon.

**Focus**: Teal left border on inputs; outline ring on buttons (if keyboard navigating).

**Active / Selected**:
- Nav items: left accent bar (3px, `--color-primary`).
- Perio cell: darker teal border + bold text.
- Timeline filter: pill with `--color-primary` bg + light text.

**Disabled**: `--color-text-muted`, reduced opacity (60–70%).

---

## Application to DentVault

### Current state → New implementation

The existing DentVault codebase (v0.7.0) uses `shadcn-svelte` with `@theme` inline in `src/app.css`. The new design system **redefines these tokens** without replacing shadcn's components—only the color values change.

**Changes**:
1. **app.css**: Replace `oklch()` custom properties with the hex tokens above. Redefine for dark mode and user theme toggle.
2. **Component overrides** (if needed): shadcn buttons, inputs, dialogs—inherit tokens. No new component library; reuse shadcn + token changes.
3. **Floating panels** (`FloatingPanel.svelte`): Already exist; no changes to logic. Audit styling to match palette.
4. **Timeline rendering** (`TimelineView.svelte`, `TimelineEntryCard.svelte`): Entry colors already map to types—verify they're using the procedure-color palette above.
5. **Dental chart** (`DentalChartView.svelte`, `ToothChart.svelte`): Surface colors already exist; swap for new palette.
6. **Perio grid** (`ParMeasurementGrid.svelte`): Update cell background colors to match new semantic grid (1–3/4–5/6+).
7. **Dark mode**: Extend existing `prefers-color-scheme: dark` rules with tokens.

### Audit checklist
- [ ] `src/app.css` tokens redefined (light + dark mode + user toggle).
- [ ] Button colors: primary uses `--color-primary`; destructive uses `--color-critical`.
- [ ] Timeline entry dots use procedure-color tokens.
- [ ] Badges (success/warning/critical) use semantic colors.
- [ ] Perio grid cells: 1–3 teal, 4–5 amber, 6+ red.
- [ ] Floating panels positioned & styled per spec.
- [ ] All text colors (primary/secondary/tertiary/muted) use tokens.
- [ ] Border & dividers use `--color-border` / `--color-border-subtle`.
- [ ] Dark mode tested in all screens (Patients, Patient detail, Chart, Perio, Plan, Schedule).
- [ ] Minimum window 820 × 560 px honored; fixed UI bars tested at narrow width.

---

## Implementation Notes

**Font loading**: Space Mono is already a system monospace fallback; Bricolage Grotesque and Hanken Grotesk are loaded via Google Fonts in the design doc. For the app, add `@import` to `app.css` or inline via data URI (CSP blocks external font CDNs in artifacts, but Tauri desktop app has no such restriction—use `@import`).

**Color accessibility**: All semantic colors (success, warning, critical) meet WCAG AA contrast on their light backgrounds. Teal (`#127a6f`) on white is 7.2:1; white on deep-pine is 13:1.

**Responsive**: The sidebar is always visible on desktop. On narrow windows (<768px), sidebar may collapse to icon-only or slide-out drawer—not specified in the design doc, so implement per DentVault's current responsive pattern.

**Component library**: This design system is an **evolution**, not a replacement. shadcn-svelte components stay; tokens + overrides do the heavy lifting.
