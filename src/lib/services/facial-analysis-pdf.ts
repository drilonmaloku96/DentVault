import { jsPDF } from 'jspdf';
import type { FacialMeasurementResult } from '$lib/types';

/** Input for generating a facial analysis (extraoral photo evaluation) report PDF. */
export interface FacialAnalysisPdfInput {
	/** data: URL of a canvas-flattened image WITH the landmark overlay already drawn onto it by the caller. */
	annotatedImageDataUrl: string;
	/** Natural pixel width of the annotated image. */
	imageWidth: number;
	/** Natural pixel height of the annotated image. */
	imageHeight: number;
	patientName: string;
	/** Already-formatted display date string. */
	dateStr: string;
	measurements: FacialMeasurementResult[];
	/** Measurement id -> display name (FacialMeasurementResult only carries id/value/unit/standard*). */
	measurementNames: Record<string, string>;
	/** Plain text, may contain newlines, may be long or empty. */
	notes: string;
}

const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;
const MARGIN_MM = 14;
const HEADER_RULE_GAP_MM = 4;
const HEADER_TO_BODY_GAP_MM = 8;
const COLUMN_GAP_MM = 10;
const IMAGE_HEIGHT_BUDGET_RATIO = 0.85;
const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT_MM = 5.2;
const TABLE_HEADING_FONT_SIZE = 11;
const TABLE_ROW_FONT_SIZE = 9.5;
const TABLE_ROW_HEIGHT_MM = 9;
const TABLE_SUBLINE_OFFSET_MM = 4.2;

/** Converts an ArrayBuffer to a base64 string without any data: prefix. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/** Draws the subtle horizontal rule under a header line; returns the rule's y position. */
function drawHeaderRule(doc: jsPDF, y: number): number {
	doc.setDrawColor(180, 180, 180);
	doc.setLineWidth(0.3);
	doc.line(MARGIN_MM, y + HEADER_RULE_GAP_MM, PAGE_WIDTH_MM - MARGIN_MM, y + HEADER_RULE_GAP_MM);
	return y + HEADER_RULE_GAP_MM;
}

/** Formats a measurement's value with its unit suffix, rounded to 1 decimal place. */
function formatValue(value: number, unit: FacialMeasurementResult['unit']): string {
	const rounded = Math.round(value * 10) / 10;
	switch (unit) {
		case 'deg':
			return `${rounded}°`;
		case '%':
			return `${rounded}%`;
		case 'mm':
			return `${rounded} mm`;
		case 'ratio':
		default:
			return `${rounded}`;
	}
}

/** Formats the norm-comparison text for a measurement, or null if no standard is available. */
function formatNormText(m: FacialMeasurementResult): string | null {
	if (m.standardValue === undefined || m.standardDeviation === undefined) return null;
	const stdText = formatValue(m.standardValue, m.unit);
	const sdSuffix = m.standardDeviation !== 0 ? ` ± ${Math.round(m.standardDeviation * 10) / 10}` : '';
	const normLabel = `norm ${stdText}${sdSuffix}`;
	if (m.standardDeviation === 0) return normLabel;
	const sdCount = Math.abs(m.value - m.standardValue) / m.standardDeviation;
	const sdRounded = Math.round(sdCount * 10) / 10;
	const deviationLabel = sdCount <= 1 ? 'within norm' : `${sdRounded} SD from norm`;
	return `${normLabel} — ${deviationLabel}`;
}

/** Classifies a measurement's deviation from its standard for the indicator dot's fill. */
function normSeverity(m: FacialMeasurementResult): 'ok' | 'warn' | 'bad' | null {
	if (m.standardValue === undefined || m.standardDeviation === undefined || m.standardDeviation === 0) {
		return null;
	}
	const sdCount = Math.abs(m.value - m.standardValue) / m.standardDeviation;
	if (sdCount <= 1) return 'ok';
	if (sdCount <= 2) return 'warn';
	return 'bad';
}

/**
 * Generates a landscape A4 facial analysis report PDF: header (patient name + date),
 * the annotated extraoral photo fit to the left half of the page, a measurement table
 * to the right (name, value, norm comparison), and a clinical notes section below both
 * (word-wrapped, spilling onto continuation pages as needed).
 *
 * Returns the PDF as a base64 string WITHOUT any data: prefix.
 */
export function generateFacialAnalysisPdf(input: FacialAnalysisPdfInput): string {
	const {
		annotatedImageDataUrl,
		imageWidth,
		imageHeight,
		patientName,
		dateStr,
		measurements,
		measurementNames,
		notes
	} = input;

	if (!imageWidth || !imageHeight || Number.isNaN(imageWidth) || Number.isNaN(imageHeight)) {
		throw new Error(
			`generateFacialAnalysisPdf: invalid image dimensions (${imageWidth}x${imageHeight})`
		);
	}

	const doc = new jsPDF({
		orientation: 'landscape',
		unit: 'mm',
		format: 'a4'
	});

	const contentWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
	const contentBottom = PAGE_HEIGHT_MM - MARGIN_MM;

	// --- Header (page 1) ---
	let cursorY = MARGIN_MM;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(13);
	doc.text(patientName || '', MARGIN_MM, cursorY);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(11);
	doc.text(dateStr || '', PAGE_WIDTH_MM - MARGIN_MM, cursorY, { align: 'right' });
	cursorY = drawHeaderRule(doc, cursorY);
	cursorY += HEADER_TO_BODY_GAP_MM;

	const bodyTopY = cursorY;

	// --- Image (left half of content width, capped to available height, centered in its column) ---
	const columnWidth = (contentWidth - COLUMN_GAP_MM) / 2;
	const maxImageHeight = (contentBottom - bodyTopY) * IMAGE_HEIGHT_BUDGET_RATIO;
	const aspect = imageWidth / imageHeight;

	let drawWidth = columnWidth;
	let drawHeightMm = drawWidth / aspect;
	if (drawHeightMm > maxImageHeight) {
		drawHeightMm = maxImageHeight;
		drawWidth = drawHeightMm * aspect;
	}
	const imageX = MARGIN_MM + (columnWidth - drawWidth) / 2;
	doc.addImage(annotatedImageDataUrl, 'PNG', imageX, bodyTopY, drawWidth, drawHeightMm);

	// --- Measurement table (right half) ---
	const tableX = MARGIN_MM + columnWidth + COLUMN_GAP_MM;
	const tableWidth = columnWidth;
	let tableY = bodyTopY;

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(TABLE_HEADING_FONT_SIZE);
	doc.text('Measurements', tableX, tableY);
	tableY += TABLE_HEADING_FONT_SIZE * 0.4 + 3;

	doc.setDrawColor(210, 210, 210);
	doc.setLineWidth(0.2);
	doc.line(tableX, tableY, tableX + tableWidth, tableY);
	tableY += 5;

	if (measurements.length === 0) {
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(TABLE_ROW_FONT_SIZE);
		doc.setTextColor(120, 120, 120);
		doc.text('No measurements recorded.', tableX, tableY);
		doc.setTextColor(0, 0, 0);
	} else {
		const nameColX = tableX;
		const valueColX = tableX + tableWidth * 0.62;
		const dotColX = tableX + tableWidth - 3;

		for (const m of measurements) {
			const name = measurementNames[m.id] ?? m.id;
			const valueText = formatValue(m.value, m.unit);
			const normText = formatNormText(m);
			const severity = normSeverity(m);

			doc.setFont('helvetica', 'normal');
			doc.setFontSize(TABLE_ROW_FONT_SIZE);
			doc.setTextColor(0, 0, 0);
			doc.text(name, nameColX, tableY, { maxWidth: tableWidth * 0.6 });
			doc.setFont('helvetica', 'bold');
			doc.text(valueText, valueColX, tableY);

			if (severity) {
				const rgb: [number, number, number] =
					severity === 'ok' ? [70, 150, 90] : severity === 'warn' ? [200, 150, 40] : [190, 70, 60];
				doc.setFillColor(rgb[0], rgb[1], rgb[2]);
				doc.circle(dotColX, tableY - 1.2, 1.2, 'F');
			}

			if (normText) {
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(TABLE_ROW_FONT_SIZE - 1.5);
				doc.setTextColor(120, 120, 120);
				doc.text(normText, nameColX, tableY + TABLE_SUBLINE_OFFSET_MM, {
					maxWidth: tableWidth - 5
				});
				doc.setTextColor(0, 0, 0);
			}

			tableY += TABLE_ROW_HEIGHT_MM;
		}
	}

	// --- Clinical Notes (below both columns, full content width) ---
	const imageBottomY = bodyTopY + drawHeightMm;
	let notesY = Math.max(imageBottomY, tableY) + HEADER_TO_BODY_GAP_MM;

	const trimmedNotes = (notes ?? '').trim();
	if (trimmedNotes.length > 0) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(TABLE_HEADING_FONT_SIZE);
		if (notesY + BODY_LINE_HEIGHT_MM > contentBottom) {
			doc.addPage('a4', 'landscape');
			notesY = MARGIN_MM;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(120, 120, 120);
			doc.text(`${patientName} — ${dateStr} (cont.)`, MARGIN_MM, notesY);
			doc.setTextColor(0, 0, 0);
			notesY = drawHeaderRule(doc, notesY) + HEADER_TO_BODY_GAP_MM;
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(TABLE_HEADING_FONT_SIZE);
		}
		doc.text('Clinical Notes', MARGIN_MM, notesY);
		notesY += TABLE_HEADING_FONT_SIZE * 0.4 + 3;

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(BODY_FONT_SIZE);

		const paragraphs = notes.split('\n');
		const lines: string[] = [];
		for (const paragraph of paragraphs) {
			if (paragraph.length === 0) {
				lines.push('');
				continue;
			}
			const wrapped = doc.splitTextToSize(paragraph, contentWidth) as string[];
			lines.push(...wrapped);
		}

		for (const line of lines) {
			if (notesY + BODY_LINE_HEIGHT_MM > contentBottom) {
				doc.addPage('a4', 'landscape');
				notesY = MARGIN_MM;
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(9);
				doc.setTextColor(120, 120, 120);
				doc.text(`${patientName} — ${dateStr} (cont.)`, MARGIN_MM, notesY);
				doc.setTextColor(0, 0, 0);
				notesY = drawHeaderRule(doc, notesY) + HEADER_TO_BODY_GAP_MM;
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(BODY_FONT_SIZE);
			}
			if (line.length > 0) {
				doc.text(line, MARGIN_MM, notesY);
			}
			notesY += BODY_LINE_HEIGHT_MM;
		}
	}

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
