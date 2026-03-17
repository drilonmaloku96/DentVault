# DentVault — Dual Language (EN / DE) Implementation Plan

## Overview

Full EN ↔ DE language switching, selectable in Settings. Language persists in the `settings` table. Every piece of UI text — buttons, labels, placeholders, section headings, tooltips — switches instantly without a reload.

**Languages:** English (`en`) · German (`de`, default)

---

## Architectural Decisions

### 1. Translation format — typed TypeScript objects, not JSON

```
src/lib/i18n/
  types.ts        ← the full Translations interface (single source of truth for keys)
  en.ts           ← English translation object satisfying Translations
  de.ts           ← German translation object satisfying Translations
  index.svelte.ts ← reactive i18n store + LangCode type export
```

Why TS over JSON: full autocomplete, compile-time checks that both translations are complete, no JSON import gymnastics.

### 2. Reactive store — `i18n.t` object accessor (no function calls)

```typescript
// src/lib/i18n/index.svelte.ts
class I18nStore {
  code = $state<LangCode>('de');
  t    = $derived(code === 'en' ? en : de);
}
export const i18n = new I18nStore();
```

Usage in every component:
```svelte
<script>
  import { i18n } from '$lib/i18n';
</script>

{i18n.t.nav.patients}
{i18n.t.actions.save}
{i18n.t.categories.endodontics}
```

`i18n.t` is `$derived` so any template reading it is automatically reactive.

### 3. Dental tag labels — decoupled from persisted data

**Currently:** `DentalTag.label` is a German string saved in the `settings` table.

**After overhaul:** `label` is **removed from the persisted `DentalTag` object**. Labels are looked up from `i18n.t.chart.tags[tag.key].label` at render time. The stored object only keeps: `key`, `color`, `strokeColor`, `pattern`, `shortcut`.

```typescript
// New DentalTag (persisted)
interface DentalTag {
  key: string;         // immutable: 'healthy', 'decayed', etc.
  color: string;
  strokeColor: string;
  pattern: PatternType;
  shortcut: string;    // user-customisable single letter
}

// Label is always:
i18n.t.chart.tags[tag.key]?.label ?? tag.key
```

**Shortcut defaults per language** — stored inside the translation file:
```typescript
// in en.ts / de.ts
chart: {
  tags: {
    healthy:    { label: 'Healthy',    defaultShortcut: 'h' },
    decayed:    { label: 'Caries',     defaultShortcut: 'c' },
    filled:     { label: 'Filling',    defaultShortcut: 'f' },
    crowned:    { label: 'Crown',      defaultShortcut: 'k' },
    root_canal: { label: 'Root Canal', defaultShortcut: 'r' },
    implant:    { label: 'Implant',    defaultShortcut: 'i' },
    bridge:     { label: 'Bridge',     defaultShortcut: 'b' },
    missing:    { label: 'Missing',    defaultShortcut: 'm' },
    extracted:  { label: 'Extracted',  defaultShortcut: 'e' },
    impacted:   { label: 'Impacted',   defaultShortcut: 'p' },
    fractured:  { label: 'Fracture',   defaultShortcut: 'x' },
    prosthesis: { label: 'Prosthesis', defaultShortcut: 't' },
    watch:      { label: 'Watch',      defaultShortcut: 'u' },
  }
}
```

When the user switches language, a **confirmation dialog** appears:
> *"Reset dental tag keyboard shortcuts to [Language] defaults? Your custom shortcuts will be lost."*
> **[Reset shortcuts]** · **[Keep my shortcuts]**

If they click Reset, `dentalTags.resetShortcutsToLanguageDefaults()` reads `i18n.t.chart.tags[key].defaultShortcut` for each tag and updates the store + persists.

### 4. User-configurable stores — defaults translate, user additions stay as-is

Stores like `complicationTypes`, `acuteTagOptions`, `medicalTagOptions`, `docCategories`, `staffRoles`, and `textBlocks` contain defaults that should appear in the active language, BUT user-added items are freeform and are never translated automatically.

**Approach:**

Each store has two tiers:
1. **Keyed defaults** — items with a known `key` (e.g. `'infection'`). Label is looked up from `i18n.t.complications.types.infection`. If language changes, the label changes automatically.
2. **Custom items** — items with a `key` that starts with `'custom_'` or that isn't in the translation map. These display their stored `label` directly (unchanged by language switch).

For `complicationTypes` and clinical tags (currently bare string arrays), the schema must be migrated to `{ key: string; label?: string }[]` where `label` is only set for custom items.

**Migration approach** (no DB migration needed — these are stored in the `settings` table as JSON):
- On store load, if value is an array of strings (old format), convert each string to `{ key: 'custom_' + slug(str), label: str }`.
- Known default strings (e.g. `'infection'`, `'Allergy'`) are matched and converted to keyed defaults.

### 5. Text blocks — bilingual defaults, user templates unchanged

Default text blocks ship in both languages. On first load (no persisted value), the active language's defaults are used. If user has customised them, changes persist regardless of language switch. A **"Reset to [Language] defaults"** button per text-block section offers a fresh start.

### 6. Language persistence

```
settings table key: 'app_locale'
values: 'en' | 'de'
default: 'de'
```

Loaded in `+layout.svelte` immediately after `vault.init()`, before any other store loads, so all stores initialise with the correct language defaults.

---

## Translation File Structure (`types.ts` interface)

```typescript
export interface Translations {
  meta: {
    code: 'en' | 'de';
    name: string;               // 'English' | 'Deutsch'
  };

  // ── Global actions ───────────────────────────────────────────────
  actions: {
    save: string; cancel: string; delete: string; edit: string;
    close: string; add: string; confirm: string; search: string;
    filter: string; export: string; load: string; reset: string;
    new: string; back: string; next: string; prev: string;
    done: string; saveClose: string; open: string; copy: string;
    dismiss: string; accept: string; apply: string; remove: string;
  };

  // ── Common UI ────────────────────────────────────────────────────
  common: {
    loading: string; noData: string; optional: string; required: string;
    date: string; notes: string; name: string; all: string; none: string;
    unknown: string; yes: string; no: string; today: string;
    legacy: string; examiner: string; doctor: string; tooth: string;
  };

  // ── Navigation ───────────────────────────────────────────────────
  nav: {
    patients: string; dashboard: string; reports: string; settings: string;
  };

  // ── Vault / app init ─────────────────────────────────────────────
  vault: {
    opening: string; choosePath: string; noVault: string;
    welcome: string; welcomeDesc: string;
  };

  // ── Patients ─────────────────────────────────────────────────────
  patients: {
    title: string; new: string; search: string;
    noResults: string; noPatients: string;
    status: { active: string; inactive: string; archived: string; deceased: string };
    gender: { male: string; female: string; other: string; unknown: string };
    fields: {
      firstName: string; lastName: string; dob: string; gender: string;
      phone: string; email: string; address: string;
      referralSource: string; smokingStatus: string; occupation: string;
      allergies: string; bloodGroup: string;
    };
    tabs: {
      timeline: string; plans: string; chart: string;
      perio: string; documents: string;
    };
    medicalHistory: string; acuteProblems: string; conditions: string;
    editPatient: string; deletePatient: string;
    deleteConfirm: string; deleteWarning: string;
  };

  // ── Timeline ─────────────────────────────────────────────────────
  timeline: {
    title: string; addEntry: string; noEntries: string;
    filter: string; filterAll: string; loading: string;
    entry: {
      category: string; outcome: string; toothNumbers: string;
      doctor: string; colleagues: string; relatedEntry: string;
      addImage: string; viewImage: string; openExternal: string;
      legacyProvider: string; complications: string; addComplication: string;
    };
    snapshot: { take: string; view: string; title: string };
    tagSuggestion: {
      title: string; accept: string; dismiss: string;
      relatedEntry: string; pickEntry: string;
    };
  };

  // ── Treatment categories ─────────────────────────────────────────
  categories: {
    endodontics: string; orthodontics: string; prosthodontics: string;
    periodontics: string; oral_surgery: string; restorative: string;
    preventive: string; imaging: string; other: string;
  };

  // ── Treatment outcomes ───────────────────────────────────────────
  outcomes: {
    successful: string; retreated: string; failed_extracted: string;
    failed_other: string; ongoing: string; unknown: string;
  };

  // ── Treatment plans ──────────────────────────────────────────────
  plans: {
    title: string; new: string; noPlans: string;
    addItem: string; totalCost: string; completedCost: string;
    linkEntry: string;
    status: { draft: string; active: string; completed: string; cancelled: string };
    fields: { name: string; description: string; cost: string; tooth: string };
  };

  // ── Dental chart ─────────────────────────────────────────────────
  chart: {
    title: string; open: string;
    startCharting: string; stopCharting: string;
    chartingProgress: string;   // e.g. "{n} of 32 teeth"
    takeSnapshot: string; editTags: string;
    bridgeTitle: string; prosthesisTitle: string;
    dissolve: string;
    abutment: string; pontic: string; implantAbutment: string;
    surfaces: { B: string; O: string; L: string; M: string; D: string };
    conditionHistory: string; noHistory: string;
    lastExamined: string; toothNotes: string;
    selectSurfaces: string; clearSurfaces: string;
    prosthesisTypes: {
      telescope: string; clasp: string; attachment: string; replaced: string;
    };
    bridgeRoles: { abutment: string; pontic: string };
    // Tag labels + default shortcuts (one entry per dental tag key)
    tags: {
      healthy:    { label: string; defaultShortcut: string };
      watch:      { label: string; defaultShortcut: string };
      decayed:    { label: string; defaultShortcut: string };
      filled:     { label: string; defaultShortcut: string };
      crowned:    { label: string; defaultShortcut: string };
      root_canal: { label: string; defaultShortcut: string };
      implant:    { label: string; defaultShortcut: string };
      bridge:     { label: string; defaultShortcut: string };
      missing:    { label: string; defaultShortcut: string };
      extracted:  { label: string; defaultShortcut: string };
      impacted:   { label: string; defaultShortcut: string };
      fractured:  { label: string; defaultShortcut: string };
      prosthesis: { label: string; defaultShortcut: string };
    };
    resetShortcuts: string; resetShortcutsConfirm: string;
    editTagsDialog: {
      title: string; tagName: string; color: string;
      stroke: string; pattern: string; shortcut: string;
      duplicateShortcut: string;
    };
  };

  // ── Periodontal probing ──────────────────────────────────────────
  perio: {
    title: string; open: string;
    startCharting: string; stopCharting: string;
    chartingProgress: string;
    examiner: string; loadPast: string; compare: string;
    compareOff: string; saveClose: string;
    buccal: string; lingual: string; palatal: string;
    pd: string; recession: string; cal: string; bop: string; plaque: string;
    mobility: string; furcation: string; furcationSites: string;
    clickToStart: string; noRecord: string;
    comparison: {
      title: string; improved: string; worsened: string;
      unchanged: string; noChanges: string;
    };
    summary: {
      sites: string; meanPd: string; pd4plus: string;
      pd6plus: string; bopPct: string; teeth: string;
    };
  };

  // ── Documents ────────────────────────────────────────────────────
  documents: {
    title: string; add: string; noDocuments: string;
    category: string; openFile: string; deleteFile: string;
    deleteConfirm: string; uploadTitle: string;
  };

  // ── Dashboard ────────────────────────────────────────────────────
  dashboard: {
    title: string;
    filters: { dateFrom: string; dateTo: string; doctor: string; allDoctors: string };
    stats: {
      totalPatients: string; activePatients: string;
      entriesThisMonth: string; successRate: string; activePlans: string;
    };
    categoryChart: string; outcomeTable: string; recentActivity: string;
    drillDown: string; noData: string;
    providerOutcomes: string;
  };

  // ── Reports ──────────────────────────────────────────────────────
  reports: {
    title: string; filters: string; exportCsv: string; noResults: string;
    columns: {
      date: string; patient: string; category: string; outcome: string;
      teeth: string; doctor: string; notes: string;
    };
  };

  // ── Settings ─────────────────────────────────────────────────────
  settings: {
    title: string; language: string; languageLabel: string;
    saved: string; resetToDefaults: string;
    sections: {
      general: string; vault: string; appearance: string;
      docCategories: string; clinicalTags: string; staffRoles: string;
      textBlocks: string; complicationTypes: string; about: string;
    };
    vault: { path: string; changePath: string; backup: string };
    theme: { label: string; light: string; dark: string; system: string };
    docCategories: {
      title: string; description: string; add: string;
      labelField: string; iconField: string;
      deleteConfirm: string;
    };
    clinicalTags: {
      acuteTitle: string; acuteDesc: string;
      medicalTitle: string; medicalDesc: string;
      addTag: string; deleteConfirm: string;
    };
    staffRoles: {
      title: string; description: string; add: string;
      roleLabel: string; prefix: string; deleteConfirm: string;
    };
    textBlocks: {
      title: string; description: string; add: string;
      triggerLabel: string; bodyLabel: string;
      resetToLangDefaults: string; resetConfirm: string;
      placeholderHint: string;
    };
    complicationTypes: {
      title: string; description: string; add: string; deleteConfirm: string;
    };
    about: { title: string; version: string; description: string };
  };

  // ── Staff / Doctors ──────────────────────────────────────────────
  staff: {
    title: string; add: string; edit: string; delete: string;
    fields: { name: string; role: string; email: string; phone: string };
    deleteConfirm: string; noStaff: string;
  };

  // ── Complications ────────────────────────────────────────────────
  complications: {
    title: string; add: string; resolve: string; delete: string;
    noComplications: string; resolved: string;
    severity: { mild: string; moderate: string; severe: string };
    fields: { type: string; severity: string; description: string };
    // Known default type labels (keyed by complication type key)
    types: {
      infection: string; dry_socket: string; nerve_damage: string;
      hemorrhage: string; allergic_reaction: string; pain_persistent: string;
      swelling: string; instrument_fracture: string; perforation: string;
      sinus_communication: string; restoration_failure: string;
      implant_failure: string; other: string;
    };
  };

  // ── Audit log ────────────────────────────────────────────────────
  audit: {
    title: string; noRecords: string;
    actions: { update: string; delete: string };
    entityTypes: {
      timeline_entry: string; treatment_plan: string;
      treatment_plan_item: string; dental_chart: string;
      document: string; patient: string;
    };
    filters: { search: string; action: string; entity: string };
  };

  // ── Ortho classifications ────────────────────────────────────────
  ortho: {
    title: string; pretreatment: string; posttreatment: string;
    angleClass: {
      class_I: string; class_II_div1: string;
      class_II_div2: string; class_III: string;
    };
    molarRelationship: string; overjet: string; overbite: string;
    crowding: { none: string; mild: string; moderate: string; severe: string };
    crossbite: { none: string; anterior: string; posterior_unilateral: string; posterior_bilateral: string };
    openBite: { none: string; anterior: string; posterior: string };
    midlineDeviation: string; treatmentType: string; extractionPattern: string;
  };

  // ── User-configurable defaults (keyed defaults for stores) ────────
  defaults: {
    docCategories: Array<{ key: string; label: string; icon: string }>;
    staffRoles: Array<{ key: string; label: string; prefix: string }>;
    acuteTags: Array<{ key: string; label: string }>;
    medicalTags: Array<{ key: string; label: string }>;
    textBlocks: Array<{ key: string; label: string; body: string }>;
    complicationTypes: Array<{ key: string; label: string }>;
  };
}
```

---

## Keyboard Shortcut Defaults Per Language

### German defaults (current behaviour)
| Key | Tag | Reason |
|-----|-----|--------|
| `g` | healthy | **G**esund |
| `u` | watch | beobach**u**ng |
| `k` | decayed | **K**aries |
| `f` | filled | **F**üllung |
| `o` | crowned | kr**O**ne |
| `w` | root_canal | **W**urzelbehandlung |
| `i` | implant | **I**mplantat |
| `b` | bridge | **B**rücke |
| `x` | missing | fehle**X**d → x for "missing" |
| `e` | extracted | **E**xtrahiert |
| `p` | impacted | im**P**aktiert |
| `r` | fractured | f**R**aktur |
| `t` | prosthesis | pro**T**hese |

### English defaults (new)
| Key | Tag | Reason |
|-----|-----|--------|
| `h` | healthy | **H**ealthy |
| `u` | watch | watch / **U**nder observation |
| `c` | decayed | **C**aries |
| `f` | filled | **F**illing |
| `k` | crowned | Krone → `k` (crown has no unique first letter) |
| `r` | root_canal | **R**oot canal |
| `i` | implant | **I**mplant |
| `b` | bridge | **B**ridge |
| `m` | missing | **M**issing |
| `e` | extracted | **E**xtracted |
| `p` | impacted | **P**impacted |
| `x` | fractured | fra**X**ture → x (f taken) |
| `t` | prosthesis | pro**T**hesis |

---

## Step-by-Step Implementation

### Step 0 — Prerequisite: read these files before starting
- `src/lib/stores/dentalTags.svelte.ts` — understand current DentalTag shape
- `src/lib/stores/complicationTypes.svelte.ts` — understand current structure
- `src/lib/stores/clinicalTags.svelte.ts` (acuteTags / medicalTags)
- `src/lib/stores/categories.svelte.ts`
- `src/lib/stores/staffRoles.svelte.ts`
- `src/lib/stores/textBlocks.svelte.ts`
- `src/routes/+layout.svelte` — store init order

---

### Step 1 — Create `src/lib/i18n/` infrastructure

**1a. `src/lib/i18n/types.ts`**
Copy the `Translations` interface from this plan. Export `LangCode = 'en' | 'de'`.

**1b. `src/lib/i18n/de.ts`**
Full German translation object satisfying `Translations`. This is the default. Include:
- All UI strings in German
- `defaults.docCategories` in German (`'Röntgenbilder'`, `'Fotos'`, `'Laborbefunde'`, `'Überweisungen'`, `'Einwilligungen'`, `'Sonstiges'`)
- `defaults.staffRoles`: `[{ key: 'doctor', label: 'Zahnarzt', prefix: 'Dr.' }, { key: 'nurse', label: 'Assistenz', prefix: '' }]`
- `defaults.acuteTags` in German
- `defaults.medicalTags` in German
- `defaults.complicationTypes` in German
- `defaults.textBlocks` — 6 German templates (copy from current `textBlocks.svelte.ts`)
- `chart.tags` with German labels + German default shortcuts

**1c. `src/lib/i18n/en.ts`**
Full English translation satisfying `Translations`. Include:
- All UI strings in English
- `defaults.*` in English
- `chart.tags` with English labels + English default shortcuts

**1d. `src/lib/i18n/index.svelte.ts`**
```typescript
import { en } from './en';
import { de } from './de';
import type { LangCode } from './types';
import { getSetting, setSetting } from '$lib/services/db';

const LANGS = { en, de } as const;

class I18nStore {
  code = $state<LangCode>('de');
  t    = $derived(LANGS[this.code]);

  async init() {
    const saved = await getSetting('app_locale');
    if (saved === 'en' || saved === 'de') this.code = saved;
  }

  async setLang(code: LangCode) {
    this.code = code;
    await setSetting('app_locale', code);
  }
}

export const i18n = new I18nStore();
export type { LangCode };
```

**Checklist:**
- [ ] `src/lib/i18n/types.ts` — Translations interface + LangCode
- [ ] `src/lib/i18n/de.ts` — complete German translation
- [ ] `src/lib/i18n/en.ts` — complete English translation (all same keys)
- [ ] `src/lib/i18n/index.svelte.ts` — reactive store with init() + setLang()
- [ ] `npm run check` — 0 errors (TypeScript will catch any missing translation keys)

---

### Step 2 — Initialise i18n in layout before other stores

**File: `src/routes/+layout.svelte`**

In the `onMount` block, add `await i18n.init()` immediately after `await vault.init()` and before any other `store.load()` calls. This ensures all stores that use `i18n.t` for defaults get the right language on first load.

```svelte
<script>
  import { i18n } from '$lib/i18n';
</script>
```

Also update sidebar nav labels to use `i18n.t.nav.*` and vault loading text to use `i18n.t.vault.*`.

**Checklist:**
- [ ] Import `i18n` in `+layout.svelte`
- [ ] Call `await i18n.init()` first in `onMount`
- [ ] Sidebar: replace `'Patients'`, `'Dashboard'`, `'Reports'`, `'Settings'` with `i18n.t.nav.*`
- [ ] Loading text: replace `'Opening vault…'` etc. with `i18n.t.vault.*`
- [ ] `npm run check` — 0 errors

---

### Step 3 — Update `dentalTags` store

**File: `src/lib/stores/dentalTags.svelte.ts`**

Changes:
1. Remove `label` from the `DentalTag` interface and from default data
2. Keep `key`, `color`, `strokeColor`, `pattern`, `shortcut`
3. Add a derived `labelFor(key)` helper: `i18n.t.chart.tags[key]?.label ?? key`
4. Add `resetShortcutsToLanguageDefaults()` method that maps each tag key to `i18n.t.chart.tags[key].defaultShortcut`
5. On load: if persisted data has `label` field (old format), strip it silently (backwards compat)

Update all components that currently do `tag.label` to do `i18n.t.chart.tags[tag.key]?.label ?? tag.key`.

Components to update:
- `ToothDetailPanel.svelte` — tag buttons
- `ToothChart.svelte` — legend labels
- `DentalChartView.svelte` — shortcut display `[k]`
- `EditTagsDialog.svelte` — tag name display + shortcut inputs

**Checklist:**
- [ ] Remove `label` from `DentalTag` interface
- [ ] Update default tags array (remove all `label` fields)
- [ ] Add `labelFor(key)` export or use inline `i18n.t.chart.tags[key]?.label ?? key`
- [ ] Add `resetShortcutsToLanguageDefaults()` to store
- [ ] Update `ToothDetailPanel.svelte`
- [ ] Update `ToothChart.svelte` legend
- [ ] Update `DentalChartView.svelte`
- [ ] Update `EditTagsDialog.svelte` — add "Reset shortcuts to language defaults" button
- [ ] `npm run check` — 0 errors

---

### Step 4 — Update user-configurable stores to use keyed defaults

**Stores to update:** `complicationTypes.svelte.ts`, `clinicalTags.svelte.ts` (acuteTags + medicalTags), `categories.svelte.ts`, `staffRoles.svelte.ts`, `textBlocks.svelte.ts`

**Pattern for each store:**

```typescript
// Old (bare strings for complication types):
const DEFAULT_COMPLICATION_TYPES = ['infection', 'dry_socket', ...]

// New (structured objects):
interface ComplicationType { key: string; label?: string }
// label is ONLY set for custom user-added items
// For known keys, label is looked up from i18n.t.complications.types[key]
// For custom keys (prefix 'custom_'), label is the stored string

// Load migration: if persisted value is string[], convert each to:
// - if it matches a known default key → { key: known_key }
// - otherwise → { key: 'custom_' + idx, label: str }
```

**For each store, implement `displayLabel(item)` helper:**
```typescript
function displayLabel(item: ComplicationType): string {
  return item.label
    ?? i18n.t.complications.types[item.key as keyof typeof i18n.t.complications.types]
    ?? item.key;
}
```

**Text blocks** — keep bilingual defaults. On language switch, the user can click "Reset to [Language] defaults" which calls `textBlocks.resetToLanguageDefaults()` which reads `i18n.t.defaults.textBlocks`.

**Categories, staffRoles** — same pattern: known keys look up from `i18n.t.defaults.docCategories[key].label`; custom items use stored label.

**Checklist:**
- [ ] `complicationTypes.svelte.ts` — migrate to `{ key, label? }[]`, add migration for string[] format, add `displayLabel()` helper
- [ ] `clinicalTags.svelte.ts` — same migration for acute and medical tags
- [ ] `categories.svelte.ts` — add `displayLabel()` that checks `i18n.t.defaults.docCategories`
- [ ] `staffRoles.svelte.ts` — add `displayLabel()` that checks `i18n.t.defaults.staffRoles`
- [ ] `textBlocks.svelte.ts` — add `resetToLanguageDefaults()` method
- [ ] `npm run check` — 0 errors

---

### Step 5 — Add language switcher to Settings page

**File: `src/routes/settings/+page.svelte`**

At the top of the Settings page (before other sections), add a **Language / Sprache** section:

```svelte
<!-- Language section -->
<section>
  <h2>{i18n.t.settings.language}</h2>
  <div class="flex gap-2">
    {#each ['de', 'en'] as code}
      <button
        onclick={() => handleLangChange(code)}
        class={i18n.code === code ? 'selected' : 'unselected'}
      >
        {code === 'en' ? '🇬🇧 English' : '🇩🇪 Deutsch'}
      </button>
    {/each}
  </div>
</section>
```

`handleLangChange(code)`:
1. Call `await i18n.setLang(code)`
2. Check if any dental tag's current shortcut differs from the new language's default
3. If so, show a confirmation dialog: "Reset shortcuts to [Language] defaults?"
4. If user confirms, call `dentalTags.resetShortcutsToLanguageDefaults()`

**Checklist:**
- [ ] Add Language section to Settings page (top position)
- [ ] Implement `handleLangChange()` with shortcut reset confirmation
- [ ] `npm run check` — 0 errors

---

### Step 6 — Translate all components and pages (sweep)

This is the bulk step. For each file, replace every hardcoded string with `i18n.t.*`.

**Order of priority (highest impact first):**

#### 6a. Routes (pages)
- [ ] `src/routes/+layout.svelte` — sidebar (already partially done in Step 2)
- [ ] `src/routes/patients/+page.svelte`
- [ ] `src/routes/patients/new/+page.svelte`
- [ ] `src/routes/patients/[patient_id]/+page.svelte`
- [ ] `src/routes/patients/[patient_id]/edit/+page.svelte`
- [ ] `src/routes/dashboard/+page.svelte`
- [ ] `src/routes/reports/+page.svelte`
- [ ] `src/routes/settings/+page.svelte`

#### 6b. Timeline components
- [ ] `src/lib/components/timeline/TimelineView.svelte`
- [ ] `src/lib/components/timeline/TimelineEntryBar.svelte` (or equivalent entry form)
- [ ] `src/lib/components/timeline/TagSuggestionBar.svelte`
- [ ] `src/lib/components/timeline/ChartSnapshotCard.svelte`

#### 6c. Patient components
- [ ] `src/lib/components/patient/PatientCard.svelte`
- [ ] `src/lib/components/patient/PatientForm.svelte`
- [ ] `src/lib/components/patient/PatientClassifications.svelte`
- [ ] `src/lib/components/patient/AcuteProblemsBox.svelte`
- [ ] `src/lib/components/patient/MedicalHistoryBox.svelte`
- [ ] `src/lib/components/patient/PatientNotesBox.svelte`

#### 6d. Dental chart components
- [ ] `src/lib/components/dental/DentalChartView.svelte`
- [ ] `src/lib/components/dental/ToothDetailPanel.svelte`
- [ ] `src/lib/components/dental/ToothChart.svelte`
- [ ] `src/lib/components/dental/RestorationEditorPanel.svelte`
- [ ] `src/lib/components/dental/EditTagsDialog.svelte`

#### 6e. Perio components
- [ ] `src/lib/components/perio/ProbingChartDialog.svelte`
- [ ] `src/lib/components/perio/PerioDataEntryPanel.svelte`
- [ ] `src/lib/components/perio/PerioSummaryBar.svelte`
- [ ] `src/lib/components/perio/PerioComparisonView.svelte`

#### 6f. Remaining components
- [ ] `src/lib/components/documents/DocumentsView.svelte` (or equivalent)
- [ ] `src/lib/components/audit/AuditLogDialog.svelte`
- [ ] `src/lib/components/treatment/TreatmentPlanList.svelte` (and related)
- [ ] All other components found to have hardcoded strings

**Pattern for each component:**
```svelte
<script lang="ts">
  import { i18n } from '$lib/i18n';
  // remove all hardcoded string variables
</script>

<!-- before -->
<button>Save</button>
<!-- after -->
<button>{i18n.t.actions.save}</button>
```

**Important:** After each batch of components, run `npm run check`. Fix errors before continuing.

---

### Step 7 — Categories and outcomes displayed from translations

All places that display a category key (e.g. `'endodontics'`) must now go through `i18n.t.categories[entry.treatment_category]`. Same for outcomes.

Grep for all usages:
```
grep -r "treatment_category\|treatment_outcome\|CATEGORIES\|OUTCOMES" src/
```

Ensure every display of category/outcome uses the translation. The DB keys (`'endodontics'`, `'successful'`, etc.) never change — only their display labels.

**Checklist:**
- [ ] `getCategoryLabel(key)` helper: `i18n.t.categories[key] ?? key`
- [ ] `getOutcomeLabel(key)` helper: `i18n.t.outcomes[key] ?? key`
- [ ] All components using these update to use the helpers

---

### Step 8 — Final check and validation

```bash
npm run check   # must be 0 errors, 0 new warnings
```

Manual test:
1. Open Settings, switch to English → verify entire UI switches immediately
2. Open dental chart → tag labels in English, shortcuts not changed
3. Click "Reset shortcuts to English defaults" → shortcuts change to h/c/f/k/r/i/b/m/e/p/x/t
4. Switch back to German → labels revert, shortcuts remain (user's choice)
5. Open perio chart → all labels in active language
6. Check dashboard, reports, patient list → all translated
7. Open patient with existing data → data intact, labels translated

---

## File Inventory

| File | Action |
|---|---|
| `src/lib/i18n/types.ts` | **CREATE** |
| `src/lib/i18n/de.ts` | **CREATE** |
| `src/lib/i18n/en.ts` | **CREATE** |
| `src/lib/i18n/index.svelte.ts` | **CREATE** |
| `src/lib/stores/dentalTags.svelte.ts` | **MODIFY** |
| `src/lib/stores/complicationTypes.svelte.ts` | **MODIFY** |
| `src/lib/stores/clinicalTags.svelte.ts` | **MODIFY** |
| `src/lib/stores/categories.svelte.ts` | **MODIFY** |
| `src/lib/stores/staffRoles.svelte.ts` | **MODIFY** |
| `src/lib/stores/textBlocks.svelte.ts` | **MODIFY** |
| `src/routes/+layout.svelte` | **MODIFY** |
| `src/routes/settings/+page.svelte` | **MODIFY** |
| `src/routes/patients/+page.svelte` | **MODIFY** |
| `src/routes/patients/new/+page.svelte` | **MODIFY** |
| `src/routes/patients/[patient_id]/+page.svelte` | **MODIFY** |
| `src/routes/patients/[patient_id]/edit/+page.svelte` | **MODIFY** |
| `src/routes/dashboard/+page.svelte` | **MODIFY** |
| `src/routes/reports/+page.svelte` | **MODIFY** |
| 45+ component files in `src/lib/components/` | **MODIFY** |

---

## Execution Order for an Agent

Steps **must** run in order due to dependencies:

```
Step 0: Read all relevant files first
Step 1: Create i18n/ infrastructure (types → de → en → store)
Step 2: +layout.svelte init
Step 3: dentalTags store + dental chart components
Step 4: All other user-configurable stores
Step 5: Settings page language switcher
Step 6: Component sweep (6a → 6b → 6c → 6d → 6e → 6f)
Step 7: Category/outcome label helpers
Step 8: npm run check + manual test
```

Steps 3 and 4 can partially overlap. Steps 6a–6f can be done in any sub-order but check after each batch.
