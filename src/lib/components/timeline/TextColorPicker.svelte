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

	function applyColor(hex: string) {
		document.execCommand('foreColor', false, hex);
		collapseSelection();
		hidePopup();
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function removeColor() {
		document.execCommand('foreColor', false, 'inherit');
		collapseSelection();
		hidePopup();
		(document.activeElement as HTMLElement)?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function buildPopup(): HTMLDivElement {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;';

		const inner = document.createElement('div');
		inner.style.cssText = [
			'display:flex;align-items:center;gap:5px;pointer-events:auto;',
			'background:var(--popover);border:1px solid var(--border);',
			'border-radius:8px;padding:5px 8px;',
			'box-shadow:0 4px 20px rgba(0,0,0,0.18);',
		].join('');

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

		// Divider
		const sep = document.createElement('div');
		sep.style.cssText = 'width:1px;height:12px;background:var(--border);margin:0 1px;flex-shrink:0;';
		inner.appendChild(sep);

		// Remove-color button
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.title = i18n.t.timeline.bar.formatting.remove;
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
		rm.addEventListener('mousedown', (e) => { e.preventDefault(); removeColor(); });
		inner.appendChild(rm);

		wrap.appendChild(inner);
		return wrap;
	}

	function showPopup(rect: DOMRect) {
		// Always rebuild so changes made in Settings are reflected immediately.
		popup?.remove();
		popup = buildPopup();
		document.body.appendChild(popup);
		popup.style.left      = `${rect.left + rect.width / 2}px`;
		popup.style.top       = `${rect.top}px`;
		popup.style.transform = 'translateX(-50%) translateY(calc(-100% - 6px))';
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
