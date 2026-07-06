/**
 * PAR visual semantics — single source of truth.
 * Import everywhere (chart, table, compare, legend, export).
 * Never redefine these per component.
 *
 * Pocket depth thresholds match DATA_INTEGRITY.md §par and ROADMAP_PAR §3.
 */

import type { ParBopState } from '$lib/types';

// ── Pocket depth ───────────────────────────────────────────────────────────

/** SVG fill color for a PD bar (used on the chart) */
export function pdBarColor(pd: number | null): string {
	if (!pd || pd <= 0) return '#d1d5db';  // gray-300 — empty
	if (pd <= 3) return '#34d399';          // emerald-400 — healthy
	if (pd <= 5) return '#fbbf24';          // amber-400 — watch
	return '#f87171';                       // red-400 — critical
}

/** SVG text color for PD number labels */
export function pdNumColor(pd: number | null): string {
	if (!pd || pd <= 0) return '#9ca3af';   // gray-400
	if (pd <= 3) return '#059669';          // emerald-600
	if (pd <= 5) return '#d97706';          // amber-600
	return '#dc2626';                       // red-600
}

/**
 * Tailwind class string for a PD chip in the grid / compare view.
 * PD 4–5 + BOP → orange (orange-100 bg).
 */
export function pdChipClass(pd: number | null, bop: ParBopState = 0): string {
	if (pd === null) return '';
	if (pd >= 6) return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300 font-bold';
	if (pd >= 4 && bop > 0) return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300';
	if (bop === 1) return 'bg-pink-100 dark:bg-pink-900/40';
	if (bop === 2) return 'bg-yellow-100 dark:bg-yellow-900/40';
	return '';
}

// ── BOP / plaque ───────────────────────────────────────────────────────────

/** SVG fill for a BOP circle indicator */
export function bopCircleColor(bop: ParBopState): string {
	if (bop === 1) return '#ef4444';  // red-500 — bleeding
	if (bop === 2) return '#fbbf24';  // amber-400 — pus
	return 'none';
}

export function bopCircleStroke(bop: ParBopState): string {
	if (bop === 1) return '#ef4444';
	if (bop === 2) return '#ef4444';  // pus: yellow dot ringed red
	return '#9ca3af';
}

/** Tailwind class for inline BOP dot in table cells */
export function bopDotClass(bop: ParBopState): string {
	if (bop === 1) return 'bg-red-500';
	if (bop === 2) return 'bg-yellow-400 ring-1 ring-red-400';
	return '';
}

// ── Mobility ───────────────────────────────────────────────────────────────

/** SVG fill/class for mobility grade (Roman numeral display) */
export function mobilityColor(grade: number | null): string {
	if (!grade || grade <= 1) return '#64748b';   // slate-500 — normal / I
	if (grade === 2) return '#d97706';            // amber-600 — II
	return '#dc2626';                             // red-600 — III
}

// ── Risk level ─────────────────────────────────────────────────────────────

export const RISK_CHIP_CLASSES = {
	stable:      'text-green-600 dark:text-green-400',
	maintenance: 'text-amber-600 dark:text-amber-400',
	high_risk:   'text-red-600 dark:text-red-400',
} as const;

// ── Bone level ─────────────────────────────────────────────────────────────

/** Stroke for bone-level polyline on chart / export */
export const BONE_LEVEL_STROKE = '#92400e';  // amber-800 / brown

// ── Status glyphs (SVG text) ───────────────────────────────────────────────

export function statusGlyph(status: string | null): string {
	if (status === 'missing')   return '✕';
	if (status === 'destroyed') return '⌀';
	if (status === 'implant')   return '⬢';
	return '';
}

export function statusOpacity(status: string | null): number {
	return status === 'missing' ? 0.15 : 1;
}
