# Scheduling Reference

## Calendar Pointer System

All calendar interactions (slot drag-create, appointment drag/resize, block drag/resize) handled exclusively via `onGridPointerDown` / `onGridPointerMove` / `onGridPointerUp` on the grid container with `setPointerCapture`. **Never add standalone `onclick` to appointment or block wrappers for interaction logic** — it bypasses the pointer capture system.

**Right-click exception**: `onGridPointerDown` skips (`return` early) when `e.button === 2` so the browser's `contextmenu` event fires normally and reaches `AppointmentBlock`'s `oncontextmenu` handler. Without this, `e.preventDefault()` in the pointer handler suppresses the `contextmenu` event. The grid itself also has an `oncontextmenu={onGridContextMenu}` handler for right-clicks that land on **empty** space (not on `[data-appt-id]`/`[data-block-id]`, which own their own right-click) — it `preventDefault()`s the native menu and deselects (`selectedApptId`, `selectedBlockId`, `multiSelectedApptIds` all cleared).

**`onpointercancel`** is wired to the same reset logic as `onpointerup`'s pending/active-drag cleanup (`apptPendingId`, `blockPendingId`, `isDragging`, and the group-drag state below). Without it, a cancelled gesture (losing pointer capture mid-drag) can leave those flags stuck true, which makes the next click-drag in the same room column get reinterpreted as continuing to move/resize the previous appointment instead of starting a new one.

## Slot Height

`SLOT_HEIGHT = 14` px per 5-minute slot (in `DayView.svelte`). 15 min = 42 px, 30 min = 84 px. `AppointmentBlock` receives `slotHeight` and derives `isCompact` (< 40 px) and `showNotes` (≥ 56 px) from it.

## Appointment Interactions

- **Single click** → selects (shows ring, enables drag-move + edge-resize), collapses any active multi-selection
- **Shift-click** (not on a resize handle) → toggles multi-select (see below) instead of starting a drag/resize
- **Double click** → opens `BookingPanel` edit dialog
- **Right-click** → opens status context menu (if `onstatuschange` prop is provided)

Detection via `data-appt-id` on wrapper div and `data-appt-handle="top|bottom"` on resize handles inside `AppointmentBlock.svelte`. Callbacks: `onAppointmentQuickUpdate(id, startTime, endTime, durationMin, roomId)`, `onAppointmentStatusChange(id, status)`.

## Multi-Select + Group Drag

Shift-clicking appointments (mirrors `PatientTreeView`'s file multi-select pattern) toggles them into `multiSelectedApptIds` (`Set<string>`, in `DayView.svelte`). `AppointmentBlock`'s `isSelected` prop is `selectedApptId === appt.id || multiSelectedApptIds.has(appt.id)`, so every selected member gets the ring.

- **Starting the toggle set**: the first shift-click seeds the set from any existing `selectedApptId` before adding the clicked appointment, so a plain-select-then-shift-click flow grows the group as expected.
- **Group drag**: a plain (non-shift) press-and-drag on a `move`-op member of an active multi-selection (`multiSelectedApptIds.size > 1`) carries the whole group. At drag activation, every other member's time/room offset relative to the pressed ("anchor") appointment is captured once (`apptDragGroupOffsets`); each pointermove tick reapplies those fixed offsets to the anchor's new position to produce each member's ghost (`apptDragGroupGhosts`), clamped so no member is dragged past the visible-time floor or off the edge of the room list. On drop, `onAppointmentQuickUpdate` fires once per group member; the group stays selected afterward.
- **Resize handles always act on the single clicked appointment**, never the group, regardless of multi-selection membership — group semantics only apply to the plain-drag `move` op.
- **Collapse to single**: a plain click (no drag, no shift) on any appointment — a member of the group or not — clears `multiSelectedApptIds` and falls back to normal single-select. Right-click-empty-space deselect and schedule-block selection also clear it, for consistency.
- **The "flash and auto-deselect" trap**: the shift-click toggle branch in `onGridPointerDown` returns early without setting `apptPendingId`/`isDragging` (it's not starting a drag). The browser still fires a matching `pointerup` for that click, and — because neither of those flags got set — it would otherwise fall through to the "click on empty area → deselect" branch at the bottom of `onGridPointerUp` and immediately wipe the selection just toggled on. Fixed with a one-shot `suppressNextEmptyDeselect` flag (mirrors the existing `suppressNextSlotClick` pattern), set in the shift-click branch and consumed at the top of that deselect branch. Any future early-`return` branch added to `onGridPointerDown` needs the same guard if it doesn't also drive `apptPendingId`/`blockPendingId`/`isDragging`.

## Appointment Status System

Statuses are fully configurable via `appointmentStatuses` store (`src/lib/stores/appointmentStatuses.svelte.ts`), persisted under settings key `'appointment_statuses'`. Each entry: `{ key, label, kuerzel, color, isBuiltIn }`.

Built-in keys: `scheduled | waiting | in_chair | completed | cancelled | no_show`. Built-ins can have their label/kuerzel/color edited but cannot be deleted.

**Visual rules in `AppointmentBlock.svelte`**:
- Block left border + tinted background → derived from `appointmentStatuses.map[status].color`
- `scheduled` → exception: uses appointment type color instead
- `completed` → hardcoded `filter: grayscale(0.85); opacity: 0.65` on the content div
- `cancelled` → hardcoded `filter: grayscale(1); opacity: 0.32` on the content div
- Badge (kuerzel) → rendered as a **sibling** of the filtered content div (z-20) so it is never desaturated. Empty kuerzel = no badge shown.
- `in_chair` → pulsing dot prepended to kuerzel inside the badge

`AppointmentStatus` type is `string` — open for custom values. `updateAppointmentStatus(id, status: string)` in `db.ts`.

Status change is optimistic in `schedule/+page.svelte`: `appointments[idx].status = status` immediately, no full reload.

### No-Show Auto-Detection

Appointments still in the built-in `'scheduled'` status (patient never checked in) past `start_time + threshold` auto-flip to `'no_show'`. Threshold is a user-configurable minutes value (default 30), stored in the `settings` table under key `'no_show_threshold_min'` via the `noShowThreshold` store (`src/lib/stores/noShowThreshold.svelte.ts`, follows the single-scalar-store pattern of `uiScale.svelte.ts` — plain `String(n)`/`parseInt`, no JSON). Editable in Settings → Schedule → "No-Show Auto-Detection" card (`i18n.t.settings.schedule.noShowThreshold*`), styled after the adjacent Working Hours card (local-copy state + Save button + transient "Saved!" flash).

- **Only `status === 'scheduled'` qualifies** — not "any non-terminal status." An appointment already `'waiting'`/`'in_chair'` means the patient is physically present, so it's left alone even past the threshold; a clinic's custom status also doesn't match, since only `'scheduled'` means "never checked in." (`'scheduled'` is a protected built-in key — always present, may be relabeled but not removed.)
- **Client-side sweep, not a DB trigger or server job** — this is a single-user desktop app with no background process. `sweepNoShows()` in `src/routes/schedule/+page.svelte` filters the currently-loaded `appointments` array and reuses `handleAppointmentStatusChange` (same optimistic-update + `updateAppointmentStatus` DB write as a manual status change), so `no_show_recorded_at` gets stamped correctly.
- **Only ticks while viewing today** (`$effect` gated on `currentDate === todayStr`, `setInterval(sweepNoShows, 60_000)`, cleaned up on teardown) — mirrors `DayView`'s `isToday`-gated current-time interval. A past or future day's appointments can't newly become "N minutes late" relative to the current moment, and the schedule page only ever loads the single visible day (`getAppointmentsForDate`), so a day the user isn't looking at is never swept. **Consequence**: if the app isn't sitting on today's schedule page when an appointment goes late, it won't auto-flip until the user navigates back to today — there's no app-wide background sweep.
- **Re-entrancy guard** (`isSweepingNoShows`) prevents overlapping sweeps if a slow batch of status-flip writes from one tick is still in flight when the next 60s tick fires — same idiom as `PatientTreeView`'s `autoTrackUntrackedFiles`/`isAutoTracking` (see "Auto-tracking files added outside the app" in the main `CLAUDE.md`).

## Appointment Type Icons

`appointment_types` has `icon TEXT NOT NULL DEFAULT ''` (migration v64). Emoji displayed in block as a colored dot replacement. Joined as `type_icon` on `Appointment` via `APPOINTMENT_JOIN`. Editable in Settings → Schedule → Appointment Types.

## Block Interactions

Identical pattern to appointments.
- **Single click** → selects (shows ring, enables drag-move + edge-resize)
- **Double click** → opens `ScheduleBlockEditDialog`

Detection via `data-block-id` on wrapper div and `data-block-handle="top|bottom"` on resize handles inside `ScheduleBlockCell.svelte`. Quick-update callback: `onBlockQuickUpdate(id, startTime, endTime, roomId)`. Block drag state mirrors appointment drag state (prefix `block*` vs `appt*`).

`ScheduleBlockCell.svelte`: Accepts `isSelected?: boolean` prop — shows color ring. Has `data-block-handle="top"` and `data-block-handle="bottom"` resize handle divs. No `onclick` prop — parent wrapper handles all pointer events.

## Deselect on Empty Click

Left-clicking (slot drag path with no movement) or right-clicking empty calendar area clears `selectedApptId`, `selectedBlockId`, and `multiSelectedApptIds`.

## BookingPanel Keyboard Navigation

↑↓ arrows + Enter to select + Escape to close. `highlightedIndex` + `data-idx` + `scrollIntoView` pattern. Status buttons derive from `appointmentStatuses.list` (not hardcoded).

## Day Abbreviations (i18n)

`defaults.dayAbbrevs` — Sun-first abbreviated day names (7 items, index 0 = Sunday, matching SQL `strftime('%w')`). Use this instead of hardcoded strings for day-of-week labels. `defaults.workingDays` has full names in same order.
