# Scheduling Reference

## Calendar Pointer System

All calendar interactions (slot drag-create, appointment drag/resize, block drag/resize) handled exclusively via `onGridPointerDown` / `onGridPointerMove` / `onGridPointerUp` on the grid container with `setPointerCapture`. **Never add standalone `onclick` to appointment or block wrappers for interaction logic** — it bypasses the pointer capture system.

**Right-click exception**: `onGridPointerDown` skips (`return` early) when `e.button === 2` so the browser's `contextmenu` event fires normally and reaches `AppointmentBlock`'s `oncontextmenu` handler. Without this, `e.preventDefault()` in the pointer handler suppresses the `contextmenu` event.

## Slot Height

`SLOT_HEIGHT = 14` px per 5-minute slot (in `DayView.svelte`). 15 min = 42 px, 30 min = 84 px. `AppointmentBlock` receives `slotHeight` and derives `isCompact` (< 40 px) and `showNotes` (≥ 56 px) from it.

## Appointment Interactions

- **Single click** → selects (shows ring, enables drag-move + edge-resize)
- **Double click** → opens `BookingPanel` edit dialog
- **Right-click** → opens status context menu (if `onstatuschange` prop is provided)

Detection via `data-appt-id` on wrapper div and `data-appt-handle="top|bottom"` on resize handles inside `AppointmentBlock.svelte`. Callbacks: `onAppointmentQuickUpdate(id, startTime, endTime, durationMin, roomId)`, `onAppointmentStatusChange(id, status)`.

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

## Appointment Type Icons

`appointment_types` has `icon TEXT NOT NULL DEFAULT ''` (migration v64). Emoji displayed in block as a colored dot replacement. Joined as `type_icon` on `Appointment` via `APPOINTMENT_JOIN`. Editable in Settings → Schedule → Appointment Types.

## Block Interactions

Identical pattern to appointments.
- **Single click** → selects (shows ring, enables drag-move + edge-resize)
- **Double click** → opens `ScheduleBlockEditDialog`

Detection via `data-block-id` on wrapper div and `data-block-handle="top|bottom"` on resize handles inside `ScheduleBlockCell.svelte`. Quick-update callback: `onBlockQuickUpdate(id, startTime, endTime, roomId)`. Block drag state mirrors appointment drag state (prefix `block*` vs `appt*`).

`ScheduleBlockCell.svelte`: Accepts `isSelected?: boolean` prop — shows color ring. Has `data-block-handle="top"` and `data-block-handle="bottom"` resize handle divs. No `onclick` prop — parent wrapper handles all pointer events.

## Deselect on Empty Click

Clicking empty calendar area (slot drag path with no movement) clears both `selectedApptId` and `selectedBlockId`.

## BookingPanel Keyboard Navigation

↑↓ arrows + Enter to select + Escape to close. `highlightedIndex` + `data-idx` + `scrollIntoView` pattern. Status buttons derive from `appointmentStatuses.list` (not hardcoded).

## Day Abbreviations (i18n)

`defaults.dayAbbrevs` — Sun-first abbreviated day names (7 items, index 0 = Sunday, matching SQL `strftime('%w')`). Use this instead of hardcoded strings for day-of-week labels. `defaults.workingDays` has full names in same order.
