# Clinical Data Model & Keyword Detection

## Treatment Categories

Every procedure/treatment MUST be tagged with a treatment category:

| Category Key | Label | Examples |
|---|---|---|
| `endodontics` | Endodontics | Root canal, retreatment, apicoectomy, pulpotomy, pulp cap |
| `orthodontics` | Orthodontics | Fixed appliances, aligners, retainers, space maintainers |
| `prosthodontics` | Prosthodontics | Crowns, bridges, dentures, implant prosthetics, veneers |
| `periodontics` | Periodontics | Scaling/root planing, flap surgery, grafting, implant placement |
| `oral_surgery` | Oral Surgery | Extractions, surgical extractions, biopsies, frenectomy |
| `restorative` | Restorative | Fillings (composite, amalgam), inlays, onlays |
| `preventive` | Preventive | Cleanings, sealants, fluoride, exams |
| `imaging` | Imaging | Periapical, panoramic, CBCT, cephalometric |
| `other` | Other | Anything that doesn't fit above |

## Treatment Outcomes

| Outcome Key | Label | Meaning |
|---|---|---|
| `successful` | Successful | Treatment achieved its goal, tooth/condition stable |
| `retreated` | Retreated | Same treatment had to be redone on same tooth/area |
| `failed_extracted` | Failed → Extracted | Treatment failed, tooth was eventually extracted |
| `failed_other` | Failed → Other | Treatment failed, alternative treatment was done |
| `ongoing` | Ongoing | Treatment still in progress / too early to evaluate |
| `unknown` | Unknown | Outcome not yet recorded |

### Endo-Specific Outcome Chain

For endodontic treatments, track the chain of events per tooth:
1. **Initial RCT** → date, tooth, provider, technique
2. **Follow-up** → symptomatic? Radiographic healing?
3. **Retreatment** (if needed) → links back via `related_entry_id`
4. **Extraction** (if needed) → links back via `related_entry_id`

### Ortho-Specific Classification

Record at **treatment start** and **treatment end** via `ortho_classifications` table:

| Field | Values |
|---|---|
| `angle_class` | `class_I`, `class_II_div1`, `class_II_div2`, `class_III` |
| `molar_relationship` | `class_I`, `class_II`, `class_III`, `super_class_II`, `super_class_III` |
| `overjet_mm` | numeric (mm) |
| `overbite_mm` | numeric (mm) |
| `crowding` | `none`, `mild`, `moderate`, `severe` |
| `crossbite` | `none`, `anterior`, `posterior_unilateral`, `posterior_bilateral` |
| `open_bite` | `none`, `anterior`, `posterior` |
| `midline_deviation_mm` | numeric (mm) |
| `treatment_type` | `fixed_appliances`, `aligners`, `functional`, `headgear`, `surgical_ortho`, `other` |
| `extraction_pattern` | `non_extraction`, `4_premolars`, `2_upper_premolars`, `other` (text) |

---

## Smart Tag Suggestion System

Engine at `src/lib/services/keyword-engine.ts` (client-side regex, no AI). UI: `src/lib/components/ui/TagSuggestionBar.svelte`.

### Rules
1. Keyword scanner — scans as user types/saves for clinically significant keywords
2. Tag suggestion banner — non-intrusive chips with Accept / Dismiss
3. **Never auto-apply** — tags NEVER written to DB without explicit user Accept
4. Hedging language (may/might/consider/discuss) → low-confidence chip style
5. Negation (no signs of / ruled out) → suppresses suggestion entirely
6. `related_entry` suggestions — when retreatment/failed_extracted detected, special chip fires `onRelatedEntryAccept`

### Keyword → Category Mapping

| Keywords / Patterns | Suggested Category |
|---|---|
| `root canal`, `RCT`, `endodontic`, `pulpectomy`, `pulpotomy`, `pulp cap`, `apicoectomy`, `retreatment` | `endodontics` |
| `orthodontic`, `braces`, `aligner`, `Invisalign`, `retainer`, `archwire`, `bracket`, `malocclusion` | `orthodontics` |
| `crown`, `bridge`, `denture`, `veneer`, `implant prosth`, `pontic`, `abutment`, `onlay`, `inlay` | `prosthodontics` |
| `scaling`, `root planing`, `SRP`, `flap surgery`, `graft`, `perio`, `pocket`, `implant placement` | `periodontics` |
| `extraction`, `surgical extract`, `biopsy`, `frenectomy`, `impaction`, `third molar` | `oral_surgery` |
| `filling`, `composite`, `amalgam`, `restoration`, `caries`, `cavity`, `decay` | `restorative` |
| `cleaning`, `prophylaxis`, `sealant`, `fluoride`, `exam`, `check-up` | `preventive` |
| `x-ray`, `xray`, `radiograph`, `periapical`, `panoramic`, `CBCT`, `cephalometric`, `OPG` | `imaging` |

### Tooth Number Detection

Patterns: `#\d{1,2}`, `tooth \d{1,2}`, `FDI \d{2}`, Palmer notation (UL6/LR4 etc.)

### Outcome Detection

| Keywords | Suggested Tag |
|---|---|
| `retreatment`, `re-treatment`, `redo`, `repeat` | `treatment_outcome: retreated` + `related_entry` chip |
| `failed`, `failure`, `unsuccessful` | `treatment_outcome: failed_other` |
| `extracted due to`, `extraction following` | `treatment_outcome: failed_extracted` + `related_entry` chip |
| `successful`, `healed`, `asymptomatic`, `resolved` | `treatment_outcome: successful` |
| `healing`, `monitoring`, `review in` | `treatment_outcome: ongoing` |
