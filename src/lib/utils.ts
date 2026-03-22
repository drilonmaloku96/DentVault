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
