# ROADMAP — Facial Analysis (extraoral photo evaluation)

Third image-analysis mode alongside **Ceph Analysis** (embedded Cephalyzer) and **X-ray Report**
(native viewer + PDF). Evaluates extraoral photographs — **profile (lateral)** and **frontal** —
by placing soft-tissue landmarks and computing the standard orthodontic photo analyses.

**Two design pillars:**
1. **Borrow Cephalyzer's coordinate/line system** — its `Point / Line / Angle / Distance` schema
   (`../Cephalyzer/vite-project/src/types/cephalometric.ts`) with landmarks in image-pixel
   coordinates, lines by point ids, angles as `three_point | line_line`, distances as
   `point_point | point_line`, norms as `{ value, deviation }` with SD-band interpretation texts.
   This is a **native Svelte re-implementation** of that model (like X-ray Report), NOT a second
   iframe embed — the analyses differ, only the geometry engine concept carries over.
2. **AI-trainable by construction** — every stored analysis is a clean (image, keypoints) training
   pair so a landmark-detection model can later auto-place points with human correction feedback.
   See "AI-trainability requirements" — these are hard constraints, not nice-to-haves.

---

## Orthodontic background — the analyses to implement

All measurements are **angles, ratios, and relative line distances** — extraoral photos have no
reliable mm scale (unlike cephs), so absolute-mm metrics are excluded unless the user calibrates
(optional ruler feature, Phase F4). This constraint is clinical reality, not a shortcut.

### Profile view (lateral)

| Analysis | Definition | Norm (adult) |
|---|---|---|
| **Facial convexity angle** | G′–Sn–Pog′ | ~165–175° (12° convexity ±4) — convex / straight / concave profile classification |
| **Nasolabial angle** | Cm–Sn–Ls | 102° ± 8° |
| **Mentolabial angle** | Li–Sm–Pog′ | ~120–130° |
| **Ricketts E-line** | Prn–Pog′ line; signed distance of Ls, Li | lips behind line, Li closer (≈ −2 mm Li, −4 mm Ls on cephs — on photos report as % of Sn–Me or qualitative ahead/on/behind) |
| **Steiner S-line** | Pog′ to columella midpoint; Ls, Li relative | lips touch the line |
| **Burstone line** | Sn–Pog′; Ls, Li relative | Ls ≈ +3.5, Li ≈ +2.2 (relative, same % convention) |
| **Holdaway H-angle** | H-line (Ls–Pog′) vs N′–Pog′ | 7–15° |
| **Merrifield Z-angle** | FH-approximation (see below) vs profile line (Pog′–most protrusive lip) | 80° ± 9° |
| **Facial thirds** | Tr–G′ : G′–Sn : Sn–Me′ | ≈ 1 : 1 : 1 |
| **Lower-third ratio** | Sn–Stms : Stmi–Me′ | ≈ 1 : 2 |
| **Nasofrontal angle** | G′–N′–Prn | 115–130° |
| **Cervicomental angle** | throat line vs submental line (C–Me′ vs neck tangent) | ~90–105° |

FH-approximation on photos: line through tragus (T) and orbitale-approximation (soft-tissue
infraorbital point, Or′) — landmarks included in the profile set for this reason. True head
orientation should come from **natural head position (NHP)** photography; note this in the UI hint.

### Frontal view

| Analysis | Definition | Norm |
|---|---|---|
| **Facial midline & symmetry** | midsagittal line G′–philtrum–Pog′; per-landmark horizontal deviation of Prn, Pog′, Me′ | deviations ≈ 0 (report as % bizygomatic width) |
| **Facial thirds** | Tr–G′ : G′–Sn : Sn–Me′ (vertical) | 1 : 1 : 1 |
| **Rule of fifths** | face width (Zy–Zy) into five eye-width segments (Ex/En landmarks + alar base + face outline) | 5 equal fifths; nose width ≈ intercanthal fifth; mouth width ≈ interpupillary/medial-iris distance |
| **Facial index** | face height (N′–Me′) / bizygomatic width (Zy–Zy) | mesoprosopic band ~0.85–0.90 (eury < , lepto >) |
| **Bigonial : bizygomatic ratio** | Go′–Go′ / Zy–Zy | ≈ 0.7–0.8 |
| **Interpupillary vs commissure cant** | angle between pupil line and Ch–Ch line | ≈ 0° (flag > 3–4°) |
| **Lower-third ratio** | Sn–Stms : Stmi–Me′ | 1 : 2 |

### Frontal-smile view (optional 3rd sub-view, Phase F4)

Smile arc (incisal edge curve vs lower lip), incisal display, gingival display (gummy smile
threshold ~3–4 mm — photo-only proxy: ratio to upper-lip length), buccal corridors
(intercommissure vs visible dentition width), smile symmetry. Needs tooth-edge landmarks —
defer until frontal/profile are proven.

### Landmark vocabulary (stable string IDs — the AI label space; never rename, only append)

- **Profile** (17): `tr, g, n, or, t, prn, cm, sn, ls, stms, stmi, li, sm, pog, gn, me, c`
- **Frontal** (19): `tr, g, n, en_r, en_l, ex_r, ex_l, pu_r, pu_l, zy_r, zy_l, al_r, al_l, sn, ls, ch_r, ch_l, go_r, go_l` + `stms, stmi, li, pog, me` shared where visible

---

## Data model & AI-trainability requirements

New timeline entry type **`facial_analysis`** (add to `SYSTEM_ENTRY_TYPES`), one entry per
(source image), upserted — same pattern as `xray_report` (`getXrayReportEntryForSource` sibling:
`getFacialAnalysisEntryForSource`, SQL filters `entry_type`, JS matches `chart_data.source`,
never `LIKE` on serialized fields).

`chart_data` JSON — **schema is the training-data format; version it from day one**:

```jsonc
{
  "schemaVersion": 1,
  "source": "<vault-relative image path>",
  "view": "profile" | "frontal",            // frontal_smile reserved
  "imageWidth": 3024, "imageHeight": 4032,   // natural px — landmarks stored in NATURAL-IMAGE px
  "mirrored": false,                          // profile photos normalized to face-right (see below)
  "landmarks": {
    "prn": { "x": 1512.3, "y": 1810.7, "placedBy": "human", "confidence": null }
    // placedBy: "human" | "ai";  confidence: model score when placedBy = "ai"
    // an AI point the user drags becomes placedBy "human" — corrections are gold labels
  },
  "measurements": [ /* computed snapshot: { id, value, unit, standardValue?, standardDeviation? } */ ],
  "pdf": "<vault-relative pdf path>",         // once generated
  "notes": "<free text from the report box>"
}
```

**Hard rules for trainability:**
1. Landmarks always in **natural-image pixel coordinates** (not viewport/zoomed coords, not
   pre-normalized floats — normalization to [0,1] happens at dataset-export time, keeping raw
   px lossless). The viewport transform (zoom/pan/uiScale) must never leak into stored coords.
2. Landmark IDs are a **closed, stable vocabulary** per view (tables above). Adding a landmark
   = append + `schemaVersion` bump; renaming/reusing an ID is forbidden.
3. **Profile mirroring normalization**: at load, detect/ask facing direction; if face-left, set
   `mirrored: true` and flip the displayed image so all stored profile coordinate frames are
   face-right. One canonical orientation halves the data the model needs.
4. Measurements are **always derived from landmarks by pure functions** — never hand-entered —
   so labels can be regenerated from coordinates alone.
5. **Dataset export** (Phase F3): `exportFacialDataset()` walks all `facial_analysis` entries →
   writes a folder of `{images/, annotations.jsonl}` in COCO-keypoints-style records
   (`image path, width, height, view, keypoints: [x, y, v], placedBy flags`). This is the
   train-a-model handoff. Lives behind Settings, not on the patient page.
6. **Auto-place hook** (Phase F4, model TBD — heatmap-regression keypoint CNN is the standard
   approach): a single `suggestLandmarks(imageDataUrl, view): Promise<Landmarks>` seam in the
   store, rendered as `placedBy: "ai"` points the user confirms/drags. Ship the seam + "not
   available" stub now; the model comes after enough data exists.

---

## Architecture (mirror X-ray Report, reuse its lessons)

**Entry**: same `cephSelection` store, third toolbar button "Facial Analysis" in `TimelineView`
(enabled by existing `isImage` getter + patient match; pick a third accent color — Ceph is violet,
X-ray Report is teal). On open: view-type chooser (profile / frontal) unless an existing analysis
for that image already fixes the view.

**Route**: `patients/[patient_id]/facial-analysis/+page.svelte` (+ `+page.ts` `prerender = false`),
`FullScreenView`, native — no iframe.

**Shared viewport (F0, do first)**: extract the X-ray Report page's viewer interaction block
(wheel zoom 0.12 / clamp [0.1, 5], Z/B/C drag-adjust, right-drag pan, contextmenu suppression,
root-zoom-corrected pointer deltas, Escape-with-preventDefault) into a reusable
`src/lib/components/imaging/ImageViewport.svelte` that hosts an overlay snippet in **image
coordinate space** (children render in natural-image px inside the transformed container, so
SVG overlays stay glued to the image under any zoom/pan). Refactor the X-ray Report page onto it —
behavior must not change there.

**Landmark engine** (`src/lib/components/imaging/LandmarkLayer.svelte` + a
`facialAnalysis.svelte.ts` store):
- Guided placement: active-landmark queue per view template (name + description + example hint),
  click places, auto-advances; any placed point is draggable (pointer events + capture,
  `setPointerCapture`); magnifier loupe on drag (Cephalyzer-style) is a stretch goal, not F1.
- Overlay: one SVG in image-space rendering points (labeled dots), lines, angle arcs, and the
  E/S/H reference lines with signed lip offsets. Visibility toggles per measurement group.
- All click→coordinate math divides by BOTH the viewport scale and the root zoom (uiScale rule).

**Measurement engine** (`src/lib/services/facial-measurements.ts`): pure functions
(angle3, angleLines, signedPointLineDistance, ratio) + **data-driven analysis tables**
(`FACIAL_TEMPLATES`: per-view landmark list, lines, measurements with `{ id, type, args, standard:
{ value, deviation }, bands }`) — Cephalyzer's `Template`/`AnalysisStandard`/`MeasurementDescription`
shapes adapted. Results panel groups measurements with norm bars (value vs ±SD, like Cephalyzer's
harmony display, CSS-only). Norms user-configurable via settings **later** — table-driven now so
that's an additive change (Customizability-First rule: do not hardcode norm branches in components).

**Persistence & PDF**: identical pipeline to X-ray Report — FloatingPanel with notes textarea +
"Save Analysis" / "Generate PDF"; PDF (jsPDF, A4 landscape) = annotated image (canvas: draw image +
overlay → dataURL) + measurement table with norms/deviations + notes; written next to the photo as
`{basename}_facial.pdf`; `documents` row ensured by `rel_path` BEFORE returning (auto-tracker
dodge); **no `document_id`** on the entry (cascade-delete trap); entry upserted with
`entry_date` kept on update. **No sidecar file** — analysis lives in `chart_data` only (a sidecar
would be auto-tracked into a junk `document` entry; the DB row is the source of truth).

**Integration checklist** (all mandatory, see CLAUDE.md):
- `SYSTEM_ENTRY_TYPES` + `typeLabel` mapping + `TimelineEntryCard` `STATIC_TYPE_CONFIG` row
- `patient-export.ts` `renderTimeline` badge; measurements table should render in the export
  (description carries a compact HTML measurement summary so the generic path shows it; a
  dedicated `renderFacial()` section can come later with Ceph Phase 1's `renderCeph()`)
- i18n block `facialAnalysis.*` (types.ts first), no hardcoded UI strings; landmark/measurement
  display names live in the template tables (single source), i18n only for chrome
- `npm run check` 0 errors; test at 820 × 560 min window

---

## Phases

- [x] **F0 — Shared viewport extraction** (July 2026): `ImageViewport.svelte` built, X-ray Report
  refactored onto it. Behavior preserved (verified by code review: same zoom/pan/adjust math,
  same Escape handling — no live UI pass done, see note below).
- [x] **F1 — Profile analysis MVP** (July 2026): route + view chooser + guided landmark placement
  + drag + SVG overlay + profile measurement set (12 measurements) + results panel + upserted
  `facial_analysis` entry with reload-for-editing.
- [x] **F2 — Frontal analysis + PDF** (July 2026): frontal template (23 landmarks, 11 measurements:
  midline/thirds/fifths/index/cant) + annotated PDF generation + documents-row/auto-track handling
  + export badge, all delivered together with F1 by the implementing agents rather than as a
  separate pass.
- **F3 — Dataset export**: `exportFacialDataset()` in Settings (folder + JSONL as specified).
  *Acceptance: export of N analyses reimports cleanly in a Python notebook (spot-check).* Not
  started — natural next step once real analyses exist to export.
- **F4 — Later**: auto-place model behind `suggestLandmarks()` seam; frontal-smile view;
  optional mm calibration (ReferenceScale-style two-point + known distance); norms editable in
  Settings; side-by-side timepoint comparison (borrow Cephalyzer comparison concepts).

**Note on verification**: F0–F2 were verified by full `svelte-check` (0 errors) and a careful
code-level review of the coordinate math, flip/mirroring frame, and save/PDF pipeline — not by
driving the actual Tauri app, since that requires taking over the live desktop session
(AppleScript/screen automation) and the user opted to try it themselves instead. Try a real
patient photo through both Profile and Frontal before relying on this in clinic; report anything
broken or awkward back for a fix pass.

## UX decisions (locked in — 2026-07-15)

1. **Facing direction**: auto-detect with manual override. On load, guess the facing direction
   (heuristic: default to "as uploaded" / face-outline asymmetry — implementer's judgment, does
   not need to be sophisticated since a human always confirms) and render a small `⇋ Flip` button
   top-left of the viewer. Flipping mirrors the displayed image AND toggles `mirrored` in
   `chart_data`, so stored landmark coordinates are always captured in the canonical face-right
   frame regardless of which way the source photo faced.
2. **Entry point**: **one** toolbar button, "Facial Analysis" (third accent color — Ceph=violet,
   X-ray Report=teal; pick a fourth distinct token, e.g. amber/indigo — do not reuse either).
   Clicking opens a small dialog: "Analyze this photo as:" with Profile/Frontal radio + Continue.
   If a `facial_analysis` entry already exists for this source image, skip the dialog and open
   directly into its existing view (the view is fixed once an analysis exists for that photo).
3. **Placement flow**: guided sequential queue. One landmark is "active" at a time — a small
   panel shows its name + a short plain-language hint (e.g. "Subnasale (Sn) — base of the nasal
   septum where it meets the upper lip"); clicking the image places it and auto-advances to the
   next undefined landmark in the view's fixed order. Every placed point stays draggable
   afterward (click any placed dot to reselect it as active, or drag it directly — dragging
   doesn't require reselecting). A completed landmark list should still be visible/scannable
   (small checklist alongside the active-landmark card) so the user can jump back to fix one
   without losing the guided order for the rest. **Trainability note**: fixed placement order
   means placement timestamps/order are uniform across analyses — worth keeping in mind if later
   telemetry on placement time-per-landmark is ever useful for QA, though this isn't required now.
4. **PDF findings text**: yes. Notes typed in the report box print as a "Clinical Notes" section
   below the measurement table (same pattern as X-ray Report's report box → PDF text), wrapping
   to additional pages if long. The notes textarea always saves regardless of PDF generation.

## Still open (implementer's judgment, lower stakes)

- Results panel layout: FloatingPanel (draggable, matches X-ray Report/Ceph precedent) vs a fixed
  right-side rail. Recommend FloatingPanel for consistency with X-ray Report unless the landmark
  checklist + measurement table together feel too cramped in a floating panel at the 820×560
  minimum window — in that case a fixed rail is the fallback, but note the deviation.
- Frontal-smile as a third sub-view now vs F4: stays F4 as planned (bigger landmark set, needs
  tooth-edge landmarks not yet modeled) — not reopened.
