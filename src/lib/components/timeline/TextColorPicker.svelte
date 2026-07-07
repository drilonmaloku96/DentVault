<script lang="ts">
	import { i18n } from '$lib/i18n';
	import { textHighlightColors } from '$lib/stores/textHighlightColors.svelte';

	let { containerEl }: { containerEl: HTMLElement | null } = $props();

	let popup: HTMLDivElement | null = null;

	function collapseSelection() {
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0) {
			const r = sel.getRangeAt(0);
			r.collapse(false);
			sel.removeAllRanges();
			sel.addRange(r);
		}
	}

	/** Notify the editor that its HTML changed (finds it explicitly — after the OS
	 *  color panel closes, document.activeElement is no longer the editor). */
	function notifyEditorInput() {
		const ed = containerEl?.querySelector('[contenteditable]');
		ed?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function applyColor(hex: string) {
		document.execCommand('foreColor', false, hex);
		collapseSelection();
		hidePopup();
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function applyHighlight(color: string) {
		document.execCommand('hiliteColor', false, color);
		collapseSelection();
		hidePopup();
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function clearFormatting() {
		// removeFormat strips the font/span wrappers (color, highlight) and b/i/strike
		// outright. The old approach — foreColor 'inherit' / hiliteColor 'transparent' —
		// could never work: execCommand nests the new wrapper INSIDE the colored span,
		// so 'inherit'/'transparent' resolve to the very color being removed.
		document.execCommand('removeFormat');
		// Some WebKit versions leave underline behind — toggle it off explicitly
		if (document.queryCommandState('underline')) document.execCommand('underline');
		collapseSelection();
		hidePopup();
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// Highlighter palette — semi-transparent tints so the theme's own text color
	// stays readable on top in BOTH light and dark mode (opaque marker colors
	// would need per-theme text-color juggling inside stored HTML).
	// `chip` is the opaque version shown on the swatch button itself.
	const HIGHLIGHTERS = [
		{ css: 'rgba(250, 204, 21, 0.40)', chip: '#facc15', key: 'yellow' as const },
		{ css: 'rgba(74, 222, 128, 0.35)', chip: '#4ade80', key: 'green' as const },
		{ css: 'rgba(244, 114, 182, 0.35)', chip: '#f472b6', key: 'pink' as const },
		{ css: 'rgba(251, 146, 60, 0.35)', chip: '#fb923c', key: 'orange' as const },
	];

	/** Apply a formatting command, keeping the selection so formats can be stacked. */
	function applyFormat(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') {
		document.execCommand(cmd);
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function buildPopup(): HTMLDivElement {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'position:absolute;z-index:60;pointer-events:none;';

		const inner = document.createElement('div');
		inner.style.cssText = [
			'display:flex;align-items:center;gap:5px;pointer-events:auto;',
			'background:var(--popover);border:1px solid var(--border);',
			'border-radius:8px;padding:5px 8px;',
			'box-shadow:0 4px 20px rgba(0,0,0,0.18);',
		].join('');

		// B / I / U / S buttons — same commands as ⌘B/I/U and ⌘⇧X, discoverable on selection
		const formats = [
			{ cmd: 'bold',          glyph: 'B', title: 'Bold (⌘B)' },
			{ cmd: 'italic',        glyph: 'I', title: 'Italic (⌘I)' },
			{ cmd: 'underline',     glyph: 'U', title: 'Underline (⌘U)' },
			{ cmd: 'strikeThrough', glyph: 'S', title: i18n.t.timeline.bar.formatting.strikethrough },
		] as const;
		formats.forEach(({ cmd, glyph, title }) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.title = title;
			btn.textContent = glyph;
			btn.style.cssText = 'width:18px;height:18px;border-radius:4px;border:none;cursor:pointer;' +
				'background:transparent;color:var(--foreground);font-size:11px;line-height:1;flex-shrink:0;' +
				`font-weight:${cmd === 'bold' ? '800' : '600'};` +
				`font-style:${cmd === 'italic' ? 'italic' : 'normal'};` +
				`text-decoration:${cmd === 'underline' ? 'underline' : cmd === 'strikeThrough' ? 'line-through' : 'none'};`;
			btn.addEventListener('mouseover', () => { btn.style.background = 'var(--muted)'; });
			btn.addEventListener('mouseout',  () => { btn.style.background = 'transparent'; });
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); applyFormat(cmd); });
			inner.appendChild(btn);
		});

		const fmtSep = document.createElement('div');
		fmtSep.style.cssText = 'width:1px;height:12px;background:var(--border);margin:0 1px;flex-shrink:0;';
		inner.appendChild(fmtSep);

		const colors = textHighlightColors.list;

		colors.forEach(({ hex, label }) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.title = label;
			btn.style.cssText = `width:15px;height:15px;border-radius:50%;background:${hex};` +
				`border:2px solid rgba(255,255,255,0.3);cursor:pointer;` +
				`transition:transform 120ms;box-shadow:0 1px 4px rgba(0,0,0,0.25);flex-shrink:0;`;
			btn.addEventListener('mouseover', () => { btn.style.transform = 'scale(1.3)'; });
			btn.addEventListener('mouseout',  () => { btn.style.transform = ''; });
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); applyColor(hex); });
			inner.appendChild(btn);
		});

		// Custom color — native OS color picker for any color beyond the presets.
		// The selection Range is snapshotted on mousedown: opening the panel moves
		// focus out of the editor, so it must be restored before applying.
		const custom = document.createElement('input');
		custom.type = 'color';
		custom.title = i18n.t.timeline.bar.formatting.custom;
		custom.value = '#dc2626';
		custom.style.cssText = 'width:17px;height:17px;padding:0;border:1.5px dashed var(--border);' +
			'border-radius:50%;cursor:pointer;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);' +
			'flex-shrink:0;appearance:none;-webkit-appearance:none;';
		let savedRange: Range | null = null;
		custom.addEventListener('mousedown', () => {
			const sel = window.getSelection();
			savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
		});
		custom.addEventListener('input', () => {
			if (!savedRange) return;
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(savedRange);
			document.execCommand('foreColor', false, custom.value);
			// Re-snapshot: execCommand may normalize the range — keep live preview working
			savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : savedRange;
			notifyEditorInput();
		});
		custom.addEventListener('change', () => {
			savedRange = null;
			hidePopup();
		});
		inner.appendChild(custom);

		// Divider
		const hlSep = document.createElement('div');
		hlSep.style.cssText = 'width:1px;height:12px;background:var(--border);margin:0 1px;flex-shrink:0;';
		inner.appendChild(hlSep);

		// Highlighter swatches — rounded squares to distinguish from the text-color circles
		HIGHLIGHTERS.forEach(({ css, chip, key }) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.title = i18n.t.timeline.bar.formatting.highlight[key];
			btn.style.cssText = `width:15px;height:15px;border-radius:4px;background:${chip};` +
				`border:2px solid rgba(255,255,255,0.3);cursor:pointer;` +
				`transition:transform 120ms;box-shadow:0 1px 4px rgba(0,0,0,0.25);flex-shrink:0;`;
			btn.addEventListener('mouseover', () => { btn.style.transform = 'scale(1.3)'; });
			btn.addEventListener('mouseout',  () => { btn.style.transform = ''; });
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); applyHighlight(css); });
			inner.appendChild(btn);
		});

		// Divider
		const sep = document.createElement('div');
		sep.style.cssText = 'width:1px;height:12px;background:var(--border);margin:0 1px;flex-shrink:0;';
		inner.appendChild(sep);

		// Clear color + highlight button
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.title = i18n.t.timeline.bar.formatting.clear;
		rm.style.cssText = 'width:15px;height:15px;border-radius:50%;background:transparent;' +
			'border:1.5px solid var(--border);cursor:pointer;' +
			'display:flex;align-items:center;justify-content:center;' +
			'flex-shrink:0;transition:border-color 120ms;color:var(--muted-foreground);';
		rm.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" ' +
			'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" ' +
			'stroke-linecap="round" stroke-linejoin="round">' +
			'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
		rm.addEventListener('mouseover', () => { rm.style.borderColor = 'var(--foreground)'; });
		rm.addEventListener('mouseout',  () => { rm.style.borderColor = ''; });
		rm.addEventListener('mousedown', (e) => { e.preventDefault(); clearFormatting(); });
		inner.appendChild(rm);

		wrap.appendChild(inner);
		return wrap;
	}

	function showPopup(rect: DOMRect) {
		const container = containerEl;
		if (!container) return;
		// Always rebuild so changes made in Settings are reflected immediately.
		popup?.remove();
		popup = buildPopup();
		// Mounted INSIDE the (position:relative) container, not document.body with
		// position:fixed — the uiScale root zoom makes fixed coords disagree with
		// getBoundingClientRect, drifting further off the lower on screen the
		// selection is (the composer lives at the very bottom → popup off-screen).
		// getBoundingClientRect coords are visual px = layout px × zoom, while
		// style.left/top on an element inside the zoomed root are layout px, so
		// all rect differences get divided by the zoom factor.
		container.appendChild(popup);
		const zoom = parseFloat(document.documentElement.style.zoom || '1') || 1;
		const contRect = container.getBoundingClientRect();
		const inner = popup.firstElementChild as HTMLElement;
		const w = inner.offsetWidth;
		const h = inner.offsetHeight;

		let x = (rect.left - contRect.left + rect.width / 2) / zoom - w / 2;
		x = Math.max(4, Math.min(x, contRect.width / zoom - w - 4));

		// Above the selection by default; below it if that would poke past the viewport top
		let y = (rect.top - contRect.top) / zoom - h - 6;
		if (rect.top / zoom - h - 6 < 4) y = (rect.bottom - contRect.top) / zoom + 6;

		popup.style.left = `${x}px`;
		popup.style.top  = `${y}px`;
	}

	function hidePopup() {
		popup?.remove();
		popup = null;
	}

	$effect(() => {
		const el = containerEl;
		if (!el) return;

		function check() {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || !sel.rangeCount) { hidePopup(); return; }
			if (!el!.contains(sel.anchorNode) && !el!.contains(sel.focusNode)) { hidePopup(); return; }
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			if (rect.width === 0) { hidePopup(); return; }
			showPopup(rect);
		}

		const onEditorMouseDown = () => hidePopup();

		function onDocMouseDown(e: MouseEvent) {
			if (!popup) return;
			if (popup.contains(e.target as Node)) return;
			if (el!.contains(e.target as Node)) return;
			hidePopup();
		}

		el.addEventListener('mouseup',   check);
		el.addEventListener('keyup',     check);
		el.addEventListener('mousedown', onEditorMouseDown);
		document.addEventListener('mousedown', onDocMouseDown);

		return () => {
			el.removeEventListener('mouseup',   check);
			el.removeEventListener('keyup',     check);
			el.removeEventListener('mousedown', onEditorMouseDown);
			document.removeEventListener('mousedown', onDocMouseDown);
			hidePopup();
		};
	});
</script>
