import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format a date string as DD/MM/YYYY.
 * Accepts ISO datetime strings, YYYY-MM-DD, or Date objects.
 * Returns '—' for empty/invalid input.
 */
export function formatDate(value: string | Date | null | undefined): string {
	if (!value) return '—';
	const d = typeof value === 'string'
		? new Date(value.length === 10 ? value + 'T12:00:00' : value)
		: value;
	if (isNaN(d.getTime())) return String(value);
	return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Format a datetime string as DD/MM/YYYY HH:MM.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	if (isNaN(d.getTime())) return String(value);
	return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Types used by shadcn-svelte components
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
export type WithoutChildren<T> = Omit<T, 'children'>;
export type WithoutChild<T> = Omit<T, 'child'>;
export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>;

// ── FDI tooth notation (European/German standard) ──────────────────────────
// Internal storage uses Universal 1–32; FDI is display-only.
const U_TO_FDI: Record<number, number> = {
	 1:18,  2:17,  3:16,  4:15,  5:14,  6:13,  7:12,  8:11,
	 9:21, 10:22, 11:23, 12:24, 13:25, 14:26, 15:27, 16:28,
	17:38, 18:37, 19:36, 20:35, 21:34, 22:33, 23:32, 24:31,
	25:41, 26:42, 27:43, 28:44, 29:45, 30:46, 31:47, 32:48,
};
const FDI_TO_U: Record<number, number> = Object.fromEntries(
	Object.entries(U_TO_FDI).map(([u, f]) => [f, Number(u)])
);

/** Convert Universal tooth number (1–32) → FDI two-digit number */
export function toFDI(universal: number): number {
	return U_TO_FDI[universal] ?? universal;
}
/** Convert FDI two-digit number → Universal tooth number (1–32) */
export function fromFDI(fdi: number): number {
	return FDI_TO_U[fdi] ?? fdi;
}

export const FDI_TOOTH_NAMES: Record<number, string> = {
	18: 'OK rechts – 3. Molar (Weisheitszahn)', 17: 'OK rechts – 2. Molar', 16: 'OK rechts – 1. Molar',
	15: 'OK rechts – 2. Prämolar',              14: 'OK rechts – 1. Prämolar', 13: 'OK rechts – Eckzahn',
	12: 'OK rechts – Seitlicher Schneidezahn',  11: 'OK rechts – Mittlerer Schneidezahn',
	21: 'OK links – Mittlerer Schneidezahn',    22: 'OK links – Seitlicher Schneidezahn',
	23: 'OK links – Eckzahn',                   24: 'OK links – 1. Prämolar',
	25: 'OK links – 2. Prämolar',               26: 'OK links – 1. Molar',
	27: 'OK links – 2. Molar',                  28: 'OK links – 3. Molar (Weisheitszahn)',
	38: 'UK links – 3. Molar (Weisheitszahn)',  37: 'UK links – 2. Molar', 36: 'UK links – 1. Molar',
	35: 'UK links – 2. Prämolar',               34: 'UK links – 1. Prämolar', 33: 'UK links – Eckzahn',
	32: 'UK links – Seitlicher Schneidezahn',   31: 'UK links – Mittlerer Schneidezahn',
	41: 'UK rechts – Mittlerer Schneidezahn',   42: 'UK rechts – Seitlicher Schneidezahn',
	43: 'UK rechts – Eckzahn',                  44: 'UK rechts – 1. Prämolar',
	45: 'UK rechts – 2. Prämolar',              46: 'UK rechts – 1. Molar',
	47: 'UK rechts – 2. Molar',                 48: 'UK rechts – 3. Molar (Weisheitszahn)',
	// Primary (deciduous) teeth
	55: 'OK rechts – 2. Milchmolar',            54: 'OK rechts – 1. Milchmolar',
	53: 'OK rechts – Milch-Eckzahn',            52: 'OK rechts – Seitl. Milchschneidezahn',
	51: 'OK rechts – Mittl. Milchschneidezahn',
	61: 'OK links – Mittl. Milchschneidezahn',  62: 'OK links – Seitl. Milchschneidezahn',
	63: 'OK links – Milch-Eckzahn',             64: 'OK links – 1. Milchmolar',
	65: 'OK links – 2. Milchmolar',
	75: 'UK links – 2. Milchmolar',             74: 'UK links – 1. Milchmolar',
	73: 'UK links – Milch-Eckzahn',             72: 'UK links – Seitl. Milchschneidezahn',
	71: 'UK links – Mittl. Milchschneidezahn',
	81: 'UK rechts – Mittl. Milchschneidezahn', 82: 'UK rechts – Seitl. Milchschneidezahn',
	83: 'UK rechts – Milch-Eckzahn',            84: 'UK rechts – 1. Milchmolar',
	85: 'UK rechts – 2. Milchmolar',
};

// ── FDI clinical charting order ────────────────────────────────────────────
// Universal tooth numbers traversed in FDI quadrant order:
// Q1: FDI 18→11 (upper right), Q2: FDI 21→28 (upper left),
// Q3: FDI 38→31 (lower left),  Q4: FDI 41→48 (lower right)
export const FDI_CHARTING_ORDER: readonly number[] = [
	1, 2, 3, 4, 5, 6, 7, 8,         // Q1: FDI 18→11
	9, 10, 11, 12, 13, 14, 15, 16,  // Q2: FDI 21→28
	17, 18, 19, 20, 21, 22, 23, 24, // Q3: FDI 38→31
	25, 26, 27, 28, 29, 30, 31, 32, // Q4: FDI 41→48
] as const;

/** Return the next tooth in FDI charting order, or null if at the end */
export function getNextTooth(universal: number): number | null {
	const idx = FDI_CHARTING_ORDER.indexOf(universal);
	if (idx === -1 || idx === FDI_CHARTING_ORDER.length - 1) return null;
	return FDI_CHARTING_ORDER[idx + 1];
}

/** Return the previous tooth in FDI charting order, or null if at the start */
export function getPrevTooth(universal: number): number | null {
	const idx = FDI_CHARTING_ORDER.indexOf(universal);
	if (idx <= 0) return null;
	return FDI_CHARTING_ORDER[idx - 1];
}

// ── Primary (deciduous) dentition ──────────────────────────────────────────
// FDI notation: Q5=51-55 (upper right), Q6=61-65 (upper left),
//               Q7=71-75 (lower left),  Q8=81-85 (lower right)

/** Returns true if the FDI number refers to a primary (baby) tooth */
export function isPrimaryTooth(n: number): boolean {
	return (n >= 51 && n <= 55) || (n >= 61 && n <= 65) ||
	       (n >= 71 && n <= 75) || (n >= 81 && n <= 85);
}

/** Maps a primary tooth FDI number to its permanent successor's FDI number.
 *  Primary molars (54/55 etc.) are replaced by premolars (14/15 etc.). */
const PRIMARY_TO_SUCCESSOR: Record<number, number> = {
	51:11, 52:12, 53:13, 54:14, 55:15,
	61:21, 62:22, 63:23, 64:24, 65:25,
	71:31, 72:32, 73:33, 74:34, 75:35,
	81:41, 82:42, 83:43, 84:44, 85:45,
};
export function primarySuccessorFDI(fdi: number): number | null {
	return PRIMARY_TO_SUCCESSOR[fdi] ?? null;
}

/**
 * Primary teeth mapped to the 16-slot SVG grid.
 * Null = no primary tooth for that slot (permanent molar positions 0-2 and 13-15).
 * Upper: Q5 (55→51) in slots 3-7, Q6 (61→65) in slots 8-12.
 */
export const UPPER_PRIMARY: readonly (number | null)[] = [
	null, null, null, 55, 54, 53, 52, 51, 61, 62, 63, 64, 65, null, null, null,
] as const;

/**
 * Lower: Q8 (85→81) in slots 3-7, Q7 (71→75) in slots 8-12.
 */
export const LOWER_PRIMARY: readonly (number | null)[] = [
	null, null, null, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75, null, null, null,
] as const;

export type DentitionType = 'permanent' | 'mixed' | 'primary';

/**
 * Returns all tooth identifiers (universal 1–32 for permanent, FDI 51–85 for primary)
 * for the given dentition type.
 */
export function getTeethForDentition(type: DentitionType): number[] {
	const permanent = Array.from({ length: 32 }, (_, i) => i + 1);
	const primary = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85];
	if (type === 'permanent') return permanent;
	if (type === 'primary')   return primary;
	return [...permanent, ...primary]; // mixed
}

// ── Root canal anatomy ─────────────────────────────────────────────────────
/**
 * Returns the root canal names for a given Universal tooth number.
 * Canals are ordered left-to-right as they appear in the SVG (matches makeRoots order).
 *
 * Upper right (Q1) / Lower right (Q4) slots: distal side is visually left.
 * Upper left (Q2) / Lower left (Q3) slots: mesial side is visually left.
 * Canal order follows this visual layout for consistent SVG mapping.
 */
export function getCanalsForTooth(universal: number): string[] {
	if (universal > 32) return ['single']; // primary teeth: 1 canal simplified
	// Upper molars: U1=18, U2=17, U3=16, U14=26, U15=27, U16=28 → 3 canals
	if ([1, 2, 3, 14, 15, 16].includes(universal)) return ['MB', 'DB', 'P'];
	// Lower molars: U17=38, U18=37, U19=36, U30=46, U31=47, U32=48 → 2 canals
	if ([17, 18, 19, 30, 31, 32].includes(universal)) return ['M', 'D'];
	// Upper premolars: U4=15, U5=14, U12=24, U13=25 → 2 canals
	if ([4, 5, 12, 13].includes(universal)) return ['B', 'P'];
	// All others (incisors, canines, lower premolars) → 1 canal
	return ['single'];
}

// Utility: debounce a function call
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
	fn: T,
	ms: number,
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn(...args), ms);
	};
}
