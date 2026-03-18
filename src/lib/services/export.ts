import type { ReportEntry } from '$lib/types';

export function entriesToCSV(entries: ReportEntry[]): string {
	const headers = ['Date', 'Patient', 'Patient ID', 'Category', 'Title', 'Teeth', 'Provider', 'Outcome', 'Description'];
	const rows = entries.map(e => [
		e.entry_date,
		e.patient_name,
		e.patient_id,
		e.treatment_category,
		`"${e.title.replace(/"/g, '""')}"`,
		e.tooth_numbers,
		e.doctor_name,
		e.treatment_outcome,
		`"${(e.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
	].join(','));
	return [headers.join(','), ...rows].join('\n');
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
