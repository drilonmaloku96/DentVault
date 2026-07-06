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
