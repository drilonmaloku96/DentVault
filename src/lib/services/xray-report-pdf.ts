import { jsPDF } from 'jspdf';

/** Input for generating a single-image X-ray report PDF. */
export interface XrayReportPdfInput {
	/** Full data: URL (e.g. data:image/png;base64,....) — png, jpeg, or other raster formats. */
	imageDataUrl: string;
	/** Natural pixel width of the image. */
	imageWidth: number;
	/** Natural pixel height of the image. */
	imageHeight: number;
	patientName: string;
	/** Already-formatted display date string. */
	dateStr: string;
	/** Plain text, may contain newlines, may be long. */
	reportText: string;
}

const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;
const MARGIN_MM = 14;
const HEADER_RULE_GAP_MM = 4;
const HEADER_TO_IMAGE_GAP_MM = 8;
const IMAGE_TO_TEXT_GAP_MM = 8;
const IMAGE_HEIGHT_BUDGET_RATIO = 0.6;
const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT_MM = 5.2;

/** Derives the jsPDF image format ('PNG' | 'JPEG') from a data: URL's mime type. */
function formatFromDataUrl(dataUrl: string): 'PNG' | 'JPEG' {
	const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
	const subtype = (match?.[1] ?? '').toLowerCase();
	if (subtype === 'jpeg' || subtype === 'jpg') return 'JPEG';
	// PNG and any other raster subtype (webp, gif, bmp, etc.) fall back to PNG —
	// jsPDF decodes via the data URL itself, the format flag mainly affects
	// internal handling of PNG transparency vs. JPEG compression.
	return 'PNG';
}

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

/**
 * Generates a landscape A4 X-ray report PDF: header (patient name + date),
 * the X-ray image sized to fit within the upper portion of the page, and the
 * report text below it (word-wrapped, spilling onto continuation pages as needed).
 *
 * Returns the PDF as a base64 string WITHOUT any data: prefix.
 */
export function generateXrayReportPdf(input: XrayReportPdfInput): string {
	const { imageDataUrl, imageWidth, imageHeight, patientName, dateStr, reportText } = input;

	if (!imageWidth || !imageHeight || Number.isNaN(imageWidth) || Number.isNaN(imageHeight)) {
		throw new Error(
			`generateXrayReportPdf: invalid image dimensions (${imageWidth}x${imageHeight})`
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
	cursorY += HEADER_TO_IMAGE_GAP_MM;

	// --- Image (fit to available width, capped to a height budget, centered horizontally) ---
	const imageFormat = formatFromDataUrl(imageDataUrl);
	const maxImageHeight = PAGE_HEIGHT_MM * IMAGE_HEIGHT_BUDGET_RATIO;
	const aspect = imageWidth / imageHeight;

	let drawWidth = contentWidth;
	let drawHeightMm = drawWidth / aspect;
	if (drawHeightMm > maxImageHeight) {
		drawHeightMm = maxImageHeight;
		drawWidth = drawHeightMm * aspect;
	}
	const imageX = MARGIN_MM + (contentWidth - drawWidth) / 2;
	doc.addImage(imageDataUrl, imageFormat, imageX, cursorY, drawWidth, drawHeightMm);
	cursorY += drawHeightMm + IMAGE_TO_TEXT_GAP_MM;

	// --- Report text (word-wrapped, honoring explicit newlines, spilling to new pages) ---
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(BODY_FONT_SIZE);

	const paragraphs = (reportText ?? '').split('\n');
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
		if (cursorY + BODY_LINE_HEIGHT_MM > contentBottom) {
			doc.addPage('a4', 'landscape');
			cursorY = MARGIN_MM;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(120, 120, 120);
			doc.text(`${patientName} — ${dateStr} (cont.)`, MARGIN_MM, cursorY);
			doc.setTextColor(0, 0, 0);
			cursorY = drawHeaderRule(doc, cursorY) + HEADER_TO_IMAGE_GAP_MM;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(BODY_FONT_SIZE);
		}
		if (line.length > 0) {
			doc.text(line, MARGIN_MM, cursorY);
		}
		cursorY += BODY_LINE_HEIGHT_MM;
	}

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
