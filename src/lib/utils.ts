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

/**
 * Format a Date as YYYY-MM-DD using the LOCAL clock (not UTC).
 * Use this instead of `toISOString().slice(0, 10)` — the UTC version rolls
 * over to the next day during late-evening documentation (UTC+1/+2).
 */
export function toLocalISODate(d: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Types used by shadcn-svelte components
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
export type WithoutChildren<T> = Omit<T, 'children'>;
export type WithoutChild<T> = Omit<T, 'child'>;
export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>;

// ── FDI tooth notation (quadrant/tooth, e.g. 14 = quadrant 1, tooth 4) ─────
// The dental chart tables store Universal 1–32 internally; FDI is display-only.
// Timeline entries and entry_teeth store FDI directly.
const U_TO_FDI: Record<number, number> = {
	 1:18,  2:17,  3:16,  4:15,  5:14,  6:13,  7:12,  8:11,
	 9:21, 10:22, 11:23, 12:24, 13:25, 14:26, 15:27, 16:28,
	17:38, 18:37, 19:36, 20:35, 21:34, 22:33, 23:32, 24:31,
	25:41, 26:42, 27:43, 28:44, 29:45, 30:46, 31:47, 32:48,
};

/** Convert Universal tooth number (1–32) → FDI two-digit number */
export function toFDI(universal: number): number {
	return U_TO_FDI[universal] ?? universal;
}

export const FDI_TOOTH_NAMES: Record<number, string> = {
	18: 'Upper right – 3rd molar (wisdom tooth)', 17: 'Upper right – 2nd molar', 16: 'Upper right – 1st molar',
	15: 'Upper right – 2nd premolar',             14: 'Upper right – 1st premolar', 13: 'Upper right – canine',
	12: 'Upper right – lateral incisor',          11: 'Upper right – central incisor',
	21: 'Upper left – central incisor',           22: 'Upper left – lateral incisor',
	23: 'Upper left – canine',                    24: 'Upper left – 1st premolar',
	25: 'Upper left – 2nd premolar',              26: 'Upper left – 1st molar',
	27: 'Upper left – 2nd molar',                 28: 'Upper left – 3rd molar (wisdom tooth)',
	38: 'Lower left – 3rd molar (wisdom tooth)',  37: 'Lower left – 2nd molar', 36: 'Lower left – 1st molar',
	35: 'Lower left – 2nd premolar',              34: 'Lower left – 1st premolar', 33: 'Lower left – canine',
	32: 'Lower left – lateral incisor',           31: 'Lower left – central incisor',
	41: 'Lower right – central incisor',          42: 'Lower right – lateral incisor',
	43: 'Lower right – canine',                   44: 'Lower right – 1st premolar',
	45: 'Lower right – 2nd premolar',             46: 'Lower right – 1st molar',
	47: 'Lower right – 2nd molar',                48: 'Lower right – 3rd molar (wisdom tooth)',
	// Primary (deciduous) teeth
	55: 'Upper right – 2nd primary molar',        54: 'Upper right – 1st primary molar',
	53: 'Upper right – primary canine',           52: 'Upper right – lateral primary incisor',
	51: 'Upper right – central primary incisor',
	61: 'Upper left – central primary incisor',   62: 'Upper left – lateral primary incisor',
	63: 'Upper left – primary canine',            64: 'Upper left – 1st primary molar',
	65: 'Upper left – 2nd primary molar',
	75: 'Lower left – 2nd primary molar',         74: 'Lower left – 1st primary molar',
	73: 'Lower left – primary canine',            72: 'Lower left – lateral primary incisor',
	71: 'Lower left – central primary incisor',
	81: 'Lower right – central primary incisor',  82: 'Lower right – lateral primary incisor',
	83: 'Lower right – primary canine',           84: 'Lower right – 1st primary molar',
	85: 'Lower right – 2nd primary molar',
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
	// Lower molars: U17=38, U18=37, U19=36, U30=46, U31=47, U32=48 → 2 roots
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
