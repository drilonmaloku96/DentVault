<script lang="ts">
	import { doctors } from '$lib/stores/doctors.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { formatDate } from '$lib/utils';
	import TextBlockPalette from '$lib/components/ui/TextBlockPalette.svelte';
	import StaffMentionPalette from '$lib/components/ui/StaffMentionPalette.svelte';
	import TextColorPicker from '$lib/components/timeline/TextColorPicker.svelte';
	import type { Doctor } from '$lib/types';
	import type { TimelineFormData, TimelineEntryType } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		patientId,
		onSave,
	}: {
		patientId: string;
		onSave: (data: TimelineFormData) => Promise<void>;
	} = $props();

	// ── Helpers ───────────────────────────────────────────────────────────
	function todayISO() { return new Date().toISOString().slice(0, 10); }

	function isoToDisplay(iso: string): string {
		if (!iso || iso.length !== 10) return iso;
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function stripHtml(html: string): string {
		return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
	}

	// ── Tooth highlighting ─────────────────────────────────────────────────
	// FDI permanent teeth: 11-18, 21-28, 31-38, 41-48
	// FDI milk teeth:      51-55, 61-65, 71-75, 81-85
	const TOOTH_PATTERN = /\b(d(?:[1-4][1-8]|[5-8][1-5]))\b/gi;

	function getCaretOffset(el: HTMLElement): number {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount) return 0;
		const range = sel.getRangeAt(0);
		const pre = document.createRange();
		pre.selectNodeContents(el);
		pre.setEnd(range.startContainer, range.startOffset);
		return pre.toString().length;
	}

	function setCaretOffset(el: HTMLElement, offset: number) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let charCount = 0;
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = (node as Text).length;
			if (charCount + len >= offset) {
				const range = document.createRange();
				range.setStart(node, offset - charCount);
				range.collapse(true);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
				return;
			}
			charCount += len;
		}
		// Fallback: place cursor at end
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(false);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
	}

	function applyToothHighlighting(el: HTMLElement | null) {
		if (!el) return;
		const hasFocus = el === document.activeElement || el.contains(document.activeElement);
		const offset = hasFocus ? getCaretOffset(el) : -1;

		// 1. Unwrap existing tooth-ref spans back to plain text
		const existing = el.querySelectorAll('span.tooth-ref');
		for (const span of existing) {
			span.replaceWith(document.createTextNode(span.textContent ?? ''));
		}
		el.normalize();

		// 2. Walk text nodes and wrap tooth patterns
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		let node: Node | null;
		while ((node = walker.nextNode())) {
			TOOTH_PATTERN.lastIndex = 0;
			if (TOOTH_PATTERN.test((node as Text).data)) textNodes.push(node as Text);
		}

		for (const textNode of textNodes) {
			TOOTH_PATTERN.lastIndex = 0;
			const text = textNode.data;
			const parent = textNode.parentNode;
			if (!parent) continue;
			const frag = document.createDocumentFragment();
			let last = 0;
			let m: RegExpExecArray | null;
			while ((m = TOOTH_PATTERN.exec(text)) !== null) {
				if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
				const span = document.createElement('span');
				span.className = 'tooth-ref';
				span.textContent = m[0];
				frag.appendChild(span);
				last = m.index + m[0].length;
			}
			if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
			parent.replaceChild(frag, textNode);
		}

		// 3. Restore cursor
		if (hasFocus && offset >= 0) setCaretOffset(el, offset);
	}

	// ── State ─────────────────────────────────────────────────────────────
	let titleContent         = $state('');
	let docBoxEl             = $state<HTMLDivElement | null>(null);
	let titleEl              = $state<HTMLDivElement | null>(null);
	let description          = $state('');
	let entryDate            = $state(todayISO());
	let entryType            = $state<string>('');
	let selectedIds          = $state<number[]>([]);
	let showMentionPalette   = $state(false);
	let mentionQuery         = $state('');
	let mentionPaletteRef    = $state<ReturnType<typeof StaffMentionPalette> | null>(null);
	let inputError           = $state('');
	let isSaving             = $state(false);
	let showPalette          = $state(false);
	let paletteQuery         = $state('');
	let paletteRef           = $state<ReturnType<typeof TextBlockPalette> | null>(null);
	let editorEl             = $state<HTMLDivElement | null>(null);

	// ── Staff dropdown ────────────────────────────────────────────────────
	let staffDropdownOpen    = $state(false);
	let staffSearchQuery     = $state('');
	let staffSearchEl        = $state<HTMLInputElement | null>(null);
	let staffListEl          = $state<HTMLDivElement | null>(null);
	let highlightedStaffIdx  = $state(0);

	const filteredStaff = $derived.by(() => {
		const q = staffSearchQuery.trim().toLowerCase();
		const list = doctors.list.filter(d => d.show_in_doc_bar !== 0);
		if (!q) return list;
		return list.filter(d =>
			d.name.toLowerCase().includes(q) ||
			(d.specialty ?? '').toLowerCase().includes(q),
		);
	});

	// Reset highlight when query or list changes
	$effect(() => {
		filteredStaff; // depend on list
		highlightedStaffIdx = 0;
	});

	function openStaffDropdown() {
		staffSearchQuery    = '';
		highlightedStaffIdx = 0;
		staffDropdownOpen   = true;
		requestAnimationFrame(() => staffSearchEl?.focus());
	}

	function toggleStaff(id: number) {
		if (selectedIds.includes(id)) {
			selectedIds = selectedIds.filter(x => x !== id);
		} else {
			selectedIds = [...selectedIds, id];
		}
		// Keep dropdown open for next selection
	}

	function handleStaffSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { staffDropdownOpen = false; return; }
		if (filteredStaff.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightedStaffIdx = (highlightedStaffIdx + 1) % filteredStaff.length;
			scrollHighlightedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedStaffIdx = (highlightedStaffIdx - 1 + filteredStaff.length) % filteredStaff.length;
			scrollHighlightedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const doc = filteredStaff[highlightedStaffIdx];
			if (doc) { toggleStaff(doc.id); staffSearchQuery = ''; }
		}
	}

	function scrollHighlightedIntoView() {
		requestAnimationFrame(() => {
			staffListEl?.querySelector<HTMLElement>(`[data-idx="${highlightedStaffIdx}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	}

	$effect(() => {
		if (staffDropdownOpen) {
			requestAnimationFrame(() => staffSearchEl?.focus());
		}
	});

	// Detected teeth — reactive on the HTML state (spans already stripped from text by stripHtml)
	const detectedTeeth = $derived.by(() => {
		const text = stripHtml(titleContent) + ' ' + stripHtml(description);
		const matches = [...text.matchAll(/\bd([1-4][1-8]|[5-8][1-5])\b/gi)];
		return [...new Set(matches.map(m => parseInt(m[1])))].sort((a, b) => a - b);
	});

	// ── Reset ──────────────────────────────────────────────────────────────
	export function reset() {
		titleContent       = '';
		description        = '';
		entryDate          = todayISO();
		entryType          = '';
		selectedIds        = [];
		showMentionPalette = false;
		mentionQuery       = '';
		inputError         = '';
		showPalette        = false;
		paletteQuery       = '';
		staffDropdownOpen  = false;
		staffSearchQuery   = '';
		if (titleEl)  titleEl.innerHTML  = '';
		if (editorEl) editorEl.innerHTML = '';
	}

	// ── Submit ──────────────────────────────────────────────────────────────
	function autoTitle(plain: string, date: string): string {
		if (plain.trim()) {
			const first = plain.split('\n')[0].trim();
			return first.length > 80 ? first.slice(0, 77) + '…' : first;
		}
		const d = new Date(date);
		const ds = isNaN(d.getTime()) ? date : formatDate(d);
		return `${i18n.t.timeline.bar.entryFallback} — ${ds}`;
	}

	async function handleSubmit() {
		const titleText = titleEl?.innerText?.trim() ?? '';
		const bodyText  = editorEl?.innerText?.trim() ?? '';
		if (!titleText && !bodyText) {
			inputError = i18n.t.timeline.bar.errorEmpty;
			return;
		}
		inputError = '';
		isSaving = true;
		try {
			// Strip tooth-ref spans and zero-width spaces (line-break placeholders) before saving
			const cleanDesc = description
				.replace(/<span[^>]*class="tooth-ref"[^>]*>(.*?)<\/span>/g, '$1')
				.replace(/​/g, '')
				.trim();
			await onSave({
				entry_date:    entryDate,
				entry_type:    entryType as TimelineEntryType,
				title:         titleText || autoTitle(bodyText, entryDate),
				description:   cleanDesc || undefined,
				tooth_numbers: detectedTeeth.length > 0 ? detectedTeeth.join(', ') : undefined,
				doctor_id:     selectedIds[0] ?? null,
				colleague_ids: JSON.stringify(selectedIds.slice(1)),
			});
			reset();
		} catch (err) {
			inputError = err instanceof Error ? err.message : i18n.t.timeline.bar.errorSave;
		} finally {
			isSaving = false;
		}
	}

	// ── Caret / selection helpers (body editor) ────────────────────────────
	function getTextBeforeCaret(): string {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !editorEl) return '';
		const range = sel.getRangeAt(0);
		const pre = document.createRange();
		pre.selectNodeContents(editorEl);
		pre.setEnd(range.startContainer, range.startOffset);
		return pre.toString();
	}

	function selectTextRange(start: number, end: number) {
		if (!editorEl) return;
		const range = document.createRange();
		let charIndex = 0;
		let startNode: Node | null = null, startOff = 0;
		let endNode: Node | null = null, endOff = 0;
		const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = (node as Text).length;
			if (!startNode && charIndex + len >= start) { startNode = node; startOff = start - charIndex; }
			if (!endNode && charIndex + len >= end) { endNode = node; endOff = end - charIndex; }
			charIndex += len;
		}
		if (startNode && endNode) {
			range.setStart(startNode, startOff);
			range.setEnd(endNode, endOff);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);
		}
	}

	function getCurrentWord(): { word: string; start: number; end: number } {
		const textBefore = getTextBeforeCaret();
		const end = textBefore.length;
		let start = end;
		while (start > 0 && textBefore[start - 1] !== '\n' && textBefore[start - 1] !== ' ') start--;
		return { word: textBefore.slice(start), start, end };
	}

	// ── Title input ─────────────────────────────────────────────────────────
	function handleTitleInput() {
		titleContent = titleEl?.innerHTML ?? '';
		applyToothHighlighting(titleEl);
		titleContent = titleEl?.innerHTML ?? '';
	}

	// ── Body input + palettes ───────────────────────────────────────────────
	function handleDescriptionInput() {
		description = editorEl?.innerHTML ?? '';
		const { word } = getCurrentWord();
		if (word.startsWith('@')) {
			mentionQuery = word.slice(1); showMentionPalette = true;
			showPalette = false;
		} else if (word.startsWith('/')) {
			paletteQuery = word.slice(1); showPalette = true;
			showMentionPalette = false;
		} else {
			showPalette = false;
			showMentionPalette = false;
			applyToothHighlighting(editorEl);
			description = editorEl?.innerHTML ?? '';
		}
	}

	function insertMention(doc: Doctor) {
		if (!editorEl) return;
		editorEl.focus();
		const { start, end } = getCurrentWord();
		selectTextRange(start, end);
		document.execCommand('insertText', false, '');
		description = editorEl.innerHTML;
		showMentionPalette = false; mentionQuery = '';
		if (!selectedIds.includes(doc.id)) selectedIds = [...selectedIds, doc.id];
	}

	function insertBlock(block: import('$lib/stores/textBlocks.svelte').TextBlock) {
		if (!editorEl) return;
		editorEl.focus();
		const { start, end } = getCurrentWord();
		selectTextRange(start, end);
		document.execCommand('insertText', false, block.body);
		description = editorEl.innerHTML;
		showPalette = false; paletteQuery = '';
	}

	// ── Title keydown ───────────────────────────────────────────────────────
	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); return; }
		if (e.key === 'Enter') {
			e.preventDefault();
			editorEl?.focus();
			if (editorEl && !editorEl.innerText.trim()) {
				const range = document.createRange();
				range.setStart(editorEl, 0);
				range.collapse(true);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
			}
		}
	}

	// ── Line break insertion ─────────────────────────────────────────────────
	// WebKit won't reliably render the cursor on a new line when it is
	// positioned between two <br> elements or after a lone <br> with no
	// following text node. The fix: use insertHTML to insert <br> + a
	// zero-width space (​). WebKit places the cursor inside the ​
	// text node — definitively on the new line. The ​ is invisible and
	// is stripped from the stored description on submit.
	// Bypassing the 'input' dispatch avoids applyToothHighlighting(), which
	// saves/restores the cursor as a plain text-char offset and would snap it
	// back to the previous line (it cannot see <br> elements).
	function insertBodyLineBreak() {
		if (!editorEl) return;
		document.execCommand('insertHTML', false, '<br>​');
		description = editorEl.innerHTML;
	}

	// ── Body keydown ────────────────────────────────────────────────────────
	function handleDescriptionKeydown(e: KeyboardEvent) {
		if (showMentionPalette && mentionPaletteRef?.handleKeydown(e)) return;
		if (showPalette && paletteRef?.handleKeydown(e)) return;
		if (e.key === 'Escape' && showMentionPalette) { showMentionPalette = false; return; }
		if (e.key === 'Escape' && showPalette) { showPalette = false; return; }
		if (e.key === 'Enter' && (showMentionPalette || showPalette)) { e.preventDefault(); return; }
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); return; }
		if (e.key === 'Enter') { e.preventDefault(); insertBodyLineBreak(); return; }
		// Backspace at empty body → return focus to title
		if (e.key === 'Backspace' && !(editorEl?.innerText?.trim())) {
			e.preventDefault();
			titleEl?.focus();
			const range = document.createRange();
			if (titleEl && titleEl.childNodes.length > 0) {
				const last = titleEl.childNodes[titleEl.childNodes.length - 1];
				range.setStartAfter(last);
				range.collapse(true);
			} else if (titleEl) {
				range.setStart(titleEl, 0);
			}
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);
		}
	}
</script>

<style>
	.title-editor:empty::before {
		content: attr(data-placeholder);
		color: hsl(var(--muted-foreground) / 0.4);
		pointer-events: none;
		position: absolute;
		top: 0; left: 0;
	}
	.title-editor { position: relative; }
	.title-editor :global(b), .title-editor :global(strong) { font-weight: 700; }

	.body-editor:empty::before {
		content: attr(data-placeholder);
		color: hsl(var(--muted-foreground) / 0.45);
		pointer-events: none;
		position: absolute;
		top: 0; left: 0;
	}
	.body-editor { position: relative; }

	/* Inline tooth reference highlighting — light & dark */
	:global(span.tooth-ref) {
		color: hsl(38 85% 38%);
		background: hsl(45 95% 54% / 0.15);
		border-radius: 3px;
		padding: 0 2px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	:global(.dark span.tooth-ref) {
		color: hsl(38 90% 62%);
		background: hsl(38 75% 45% / 0.22);
	}
</style>

<!-- ── Fixed chatbox bar ──────────────────────────────────────────────── -->
<div class="fixed bottom-0 left-56 right-0 z-40 px-6 pt-3 pb-4 bg-background/98 backdrop-blur-sm border-t border-border shadow-[0_-4px_20px_-4px_hsl(var(--foreground)/0.08)]">

	<!-- ── Metadata row ──────────────────────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-2 mb-2">

		<!-- Date — always today, not editable -->
		<span class="h-7 flex items-center rounded-full border border-border bg-muted/60 px-3 text-xs font-medium text-foreground select-none">
			{isoToDisplay(entryDate)}
		</span>

		<span class="h-5 w-px bg-border shrink-0 hidden sm:block"></span>

		<!-- Entry type select -->
		<select
			bind:value={entryType}
			class="h-7 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 transition-colors cursor-pointer"
		>
			<option value="">{i18n.t.timeline.bar.typeSelect}</option>
			{#each entryTypes.list as t}
				<option value={t.key}>{t.label}</option>
			{/each}
		</select>

		<span class="h-5 w-px bg-border shrink-0 hidden sm:block"></span>

		<!-- Selected staff chips (removable) -->
		{#each selectedIds as id, idx (id)}
			{@const doc = doctors.list.find(d => d.id === id)}
			{#if doc}
				<span
					style="--doc-color: {doc.color}"
					class="h-7 rounded-full border border-[var(--doc-color)] bg-[var(--doc-color)] text-white px-2.5 text-xs font-medium flex items-center gap-1.5 shadow-sm"
				>
					{#if idx > 0}<span class="opacity-70 text-[9px] font-bold leading-none">+</span>{/if}
					{staffLabel(doc)}{#if doc.specialty}<span class="opacity-75 text-[10px] ml-0.5"> · {doc.specialty}</span>{/if}
					<button
						type="button"
						onclick={() => toggleStaff(id)}
						class="opacity-70 hover:opacity-100 transition-opacity leading-none ml-0.5 text-[11px] font-bold"
						title={i18n.t.actions.remove}
					>×</button>
				</span>
			{/if}
		{/each}

		<!-- Staff picker dropdown -->
		<div class="relative">
			<button
				type="button"
				onclick={openStaffDropdown}
				class="h-7 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<path d="M12 5v14M5 12h14"/>
				</svg>
				{i18n.t.timeline.bar.staffButton}
			</button>

			{#if staffDropdownOpen}
				<!-- Backdrop -->
				<div
					class="fixed inset-0 z-40"
					role="presentation"
					onclick={() => { staffDropdownOpen = false; }}
				></div>

				<!-- Dropdown panel — opens upward from the bar -->
				<div class="absolute bottom-full mb-2 left-0 z-50 w-56 rounded-lg border border-border bg-background shadow-xl overflow-hidden">
					<!-- Search input -->
					<div class="p-2 border-b border-border/60">
						<input
							bind:this={staffSearchEl}
							bind:value={staffSearchQuery}
							type="text"
							placeholder={i18n.t.timeline.bar.staffSearch}
							onkeydown={handleStaffSearchKeydown}
							class="w-full rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-xs outline-none focus:border-ring focus:bg-background transition-colors"
						/>
					</div>

					<!-- Staff list -->
					<div bind:this={staffListEl} class="max-h-52 overflow-y-auto py-1">
						{#each filteredStaff as doc, idx (doc.id)}
							{@const isSelected = selectedIds.includes(doc.id)}
							{@const isHighlighted = idx === highlightedStaffIdx}
							<button
								type="button"
								data-idx={idx}
								onclick={() => toggleStaff(doc.id)}
								onmouseenter={() => { highlightedStaffIdx = idx; }}
								class={[
									'flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left',
									isHighlighted ? 'bg-muted/70' : 'hover:bg-muted/40',
								].join(' ')}
							>
								<!-- Color dot -->
								<span
									style="background: {doc.color}"
									class="h-2 w-2 rounded-full shrink-0"
								></span>
								<!-- Name -->
								<span class="flex-1 truncate font-medium">{staffLabel(doc)}{#if doc.specialty}<span class="text-muted-foreground font-normal"> · {doc.specialty}</span>{/if}</span>
								<!-- Checkmark if selected -->
								{#if isSelected}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-primary">
										<polyline points="20 6 9 17 4 12"/>
									</svg>
								{/if}
							</button>
						{/each}
						{#if filteredStaff.length === 0}
							<p class="px-3 py-2 text-xs text-muted-foreground/60">{i18n.t.timeline.bar.noResults}</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Detected tooth tags -->
		{#if detectedTeeth.length > 0}
			<span class="h-5 w-px bg-border shrink-0 hidden sm:block"></span>
			<div class="flex items-center gap-1">
				<span class="text-[10px] text-muted-foreground/50 font-medium">{i18n.t.timeline.bar.detectedTeeth}</span>
				{#each detectedTeeth as tooth}
					<span class="h-5 rounded px-1.5 text-[10px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center">
						{tooth}
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ── Unified documentation box ─────────────────────────────────── -->
	<div bind:this={docBoxEl} class="relative rounded-xl border border-border bg-muted/30 px-4 pt-2.5 pb-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 focus-within:bg-background transition-all">

		<!-- Title editor (first block — bold + larger) -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={titleEl}
			contenteditable="true"
			role="textbox"
			aria-label={i18n.t.timeline.bar.titleAriaLabel}
			data-placeholder={i18n.t.timeline.bar.titlePlaceholder}
			oninput={handleTitleInput}
			onkeydown={handleTitleKeydown}
			class="title-editor w-full text-[15px] font-semibold text-foreground outline-none leading-snug"
		></div>

		<!-- Subtle separator -->
		<div class="h-px bg-border/40 my-2 -mx-4"></div>

		<!-- Body editor -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={editorEl}
			contenteditable="true"
			role="textbox"
			aria-multiline="true"
			data-placeholder={i18n.t.timeline.bar.bodyPlaceholder}
			oninput={handleDescriptionInput}
			onkeydown={handleDescriptionKeydown}
			class="body-editor w-full min-h-[52px] max-h-[140px] overflow-y-auto text-sm text-foreground/90 outline-none leading-relaxed pr-32"
		></div>

		<!-- Add button -->
		<div class="absolute right-2 bottom-2 flex items-center gap-1.5">
			<button
				type="button"
				onclick={handleSubmit}
				disabled={isSaving}
				class="h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-60"
				title={i18n.t.timeline.bar.saveTitle}
			>
				{#if isSaving}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 animate-spin">
						<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
					</svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
						<path d="M12 5v14M5 12h14"/>
					</svg>
				{/if}
				{i18n.t.timeline.bar.saveButton}
			</button>
		</div>

		<!-- Text block palette -->
		{#if showPalette}
			<div class="absolute bottom-full left-0 mb-1.5 z-50">
				<TextBlockPalette
					bind:this={paletteRef}
					query={paletteQuery}
					onSelect={insertBlock}
					onDismiss={() => { showPalette = false; }}
				/>
			</div>
		{/if}

		<!-- Staff mention palette -->
		{#if showMentionPalette}
			<div class="absolute bottom-full left-0 mb-1.5 z-50">
				<StaffMentionPalette
					bind:this={mentionPaletteRef}
					query={mentionQuery}
					onSelect={insertMention}
					onDismiss={() => { showMentionPalette = false; }}
				/>
			</div>
		{/if}
	</div>

	{#if inputError}
		<p class="mt-1.5 text-xs text-destructive">{inputError}</p>
	{/if}

	<p class="mt-1 text-[10px] text-muted-foreground/40 text-right">{i18n.t.timeline.bar.hintLine}</p>
</div>

<TextColorPicker containerEl={docBoxEl} />
