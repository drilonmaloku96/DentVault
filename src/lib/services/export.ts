import type { ReportEntry } from '$lib/types';

/** RFC-4180 field escaping: quote when the value contains a comma, quote, or newline. */
function csvField(value: string | null | undefined): string {
	const s = value ?? '';
	if (/[",\n\r]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

/** Convert stored rich-text HTML to plain text for tabular export. */
function htmlToPlain(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

export function entriesToCSV(entries: ReportEntry[]): string {
	const headers = ['Date', 'Patient', 'Patient ID', 'Category', 'Title', 'Teeth', 'Provider', 'Outcome', 'Description'];
	const rows = entries.map(e => [
		csvField(e.entry_date),
		csvField(e.patient_name),
		csvField(e.patient_id),
		csvField(e.treatment_category),
		csvField(e.title),
		csvField(e.tooth_numbers),
		csvField(e.doctor_name),
		csvField(e.treatment_outcome),
		csvField(htmlToPlain(e.description || '')),
	].join(','));
	// UTF-8 BOM so Excel detects the encoding (umlauts in German clinical text)
	return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

export function downloadJson(obj: unknown, filename: string): void {
	const json = JSON.stringify(obj, null, 2);
	const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function downloadCSV(csvString: string, filename: string): void {
	const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
