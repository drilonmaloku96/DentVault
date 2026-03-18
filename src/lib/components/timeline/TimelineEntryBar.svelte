<script lang="ts">
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import TextBlockPalette from '$lib/components/ui/TextBlockPalette.svelte';
	import StaffMentionPalette from '$lib/components/ui/StaffMentionPalette.svelte';
	import type { Doctor } from '$lib/types';

	export interface BarDraft {
		title: string;
		description: string;
		entry_date: string;
		doctor_id: number | null;
		colleague_ids: number[];
	}

	let {
		patientId,
		onOpen,
	}: {
		patientId: string;
		/** Called when the user clicks Add — parent opens the full form pre-filled. */
		onOpen: (draft: BarDraft) => void;
	} = $props();

	// ── State ─────────────────────────────────────────────────────────────
	function todayISO() { return new Date().toISOString().slice(0, 10); }

	let entryDate            = $state(todayISO());
	let entryTitle           = $state('');
	let description          = $state('');  // stores innerHTML via bind:innerHTML
	let selectedDoctorId     = $state<number | null>(null);
	let selectedColleagueIds = $state<number[]>([]);
	let showColleaguePicker  = $state(false);
	let showMentionPalette   = $state(false);
	let mentionQuery         = $state('');
	let mentionPaletteRef    = $state<ReturnType<typeof StaffMentionPalette> | null>(null);
	let inputError           = $state('');

	// ── Text block palette ────────────────────────────────────────────────
	let showPalette  = $state(false);
	let paletteQuery = $state('');
	let paletteRef   = $state<ReturnType<typeof TextBlockPalette> | null>(null);
	let editorEl     = $state<HTMLDivElement | null>(null);

	// ── Reset (called by parent after the form opens) ─────────────────────
	export function reset() {
		entryTitle           = '';
		description          = '';
		entryDate            = todayISO();
		selectedDoctorId     = null;
		selectedColleagueIds = [];
		showColleaguePicker  = false;
		showMentionPalette   = false;
		mentionQuery         = '';
		inputError           = '';
		showPalette          = false;
		paletteQuery         = '';
	}

	// ── Submit → open full form ───────────────────────────────────────────
	function autoTitle(plain: string, date: string): string {
		if (plain.trim()) {
			const first = plain.split('\n')[0].trim();
			return first.length > 80 ? first.slice(0, 77) + '…' : first;
		}
		const d = new Date(date);
		const ds = isNaN(d.getTime()) ? date : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
		return `Eintrag — ${ds}`;
	}

	function handleSubmit() {
		const plainText = editorEl?.innerText?.trim() ?? '';
		const html = description;
		if (!plainText && !entryTitle.trim()) {
			inputError = 'Bitte Titel oder Beschreibung eingeben.';
			return;
		}
		inputError = '';
		onOpen({
			title:         entryTitle.trim() || autoTitle(plainText, entryDate),
			description:   html,
			entry_date:    entryDate,
			doctor_id:     selectedDoctorId,
			colleague_ids: selectedColleagueIds,
		});
	}

	// ── Selection / caret helpers ─────────────────────────────────────────
	function getTextBeforeCaret(): string {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !editorEl) return '';
		const range = sel.getRangeAt(0);
		const preRange = document.createRange();
		preRange.selectNodeContents(editorEl);
		preRange.setEnd(range.startContainer, range.startOffset);
		return preRange.toString();
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
			if (!startNode && charIndex + len >= start) {
				startNode = node; startOff = start - charIndex;
			}
			if (!endNode && charIndex + len >= end) {
				endNode = node; endOff = end - charIndex;
			}
			charIndex += len;
		}
		if (startNode && endNode) {
			range.setStart(startNode, startOff);
			range.setEnd(endNode, endOff);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
		}
	}

	function getCurrentWord(): { word: string; start: number; end: number } {
		const textBefore = getTextBeforeCaret();
		const end = textBefore.length;
		let start = end;
		while (start > 0 && textBefore[start - 1] !== '\n' && textBefore[start - 1] !== ' ') start--;
		return { word: textBefore.slice(start), start, end };
	}

	// ── Formatting ────────────────────────────────────────────────────────
	function applyFormat(format: 'bold' | 'italic' | 'underline') {
		editorEl?.focus();
		document.execCommand(format, false);
		description = editorEl?.innerHTML ?? description;
	}

	// ── Text block palette + mention palette ─────────────────────────────
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
		}
	}

	function insertMention(doc: Doctor) {
		if (!editorEl) return;
		editorEl.focus();
		const { start, end } = getCurrentWord();
		selectTextRange(start, end);
		document.execCommand('insertText', false, `@${doc.name}`);
		description = editorEl.innerHTML;
		showMentionPalette = false; mentionQuery = '';
		if (!selectedColleagueIds.includes(doc.id)) {
			selectedColleagueIds = [...selectedColleagueIds, doc.id];
		}
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

	function handleDescriptionKeydown(e: KeyboardEvent) {
		if (showMentionPalette && mentionPaletteRef?.handleKeydown(e)) return;
		if (showPalette && paletteRef?.handleKeydown(e)) return;
		if (e.key === 'Escape' && showMentionPalette) { showMentionPalette = false; return; }
		if (e.key === 'Escape' && showPalette) { showPalette = false; return; }
		if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); applyFormat('bold'); return; }
		if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); applyFormat('italic'); return; }
		if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); applyFormat('underline'); return; }
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
	}
</script>

<style>
	.editor-content:empty::before {
		content: attr(data-placeholder);
		color: hsl(var(--muted-foreground) / 0.5);
		pointer-events: none;
		position: absolute;
		top: 0.625rem;
		left: 1rem;
	}
	.editor-content {
		position: relative;
	}
	.editor-content :global(b), .editor-content :global(strong) { font-weight: 600; }
	.editor-content :global(i), .editor-content :global(em) { font-style: italic; }
	.editor-content :global(u) { text-decoration: underline; }
</style>

<!-- ── Fixed chatbox bar ──────────────────────────────────────────────── -->
<div class="fixed bottom-0 left-56 right-0 z-40 px-6 pt-3 pb-4 bg-background/98 backdrop-blur-sm border-t border-border shadow-[0_-4px_20px_-4px_hsl(var(--foreground)/0.08)]">

	<!-- ── Metadata row ──────────────────────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-2 mb-2">

		<!-- Date -->
		<input
			type="date"
			bind:value={entryDate}
			class="h-7 rounded-full border border-border bg-muted/60 px-3 text-xs font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 transition-colors cursor-pointer"
		/>

		<span class="h-5 w-px bg-border shrink-0 hidden sm:block"></span>

		<!-- Doctor chips -->
		<div class="flex flex-wrap items-center gap-1">
			{#each doctors.list as doc (doc.id)}
				<button
					type="button"
					onclick={() => (selectedDoctorId = selectedDoctorId === doc.id ? null : doc.id)}
					style="--doc-color: {doc.color}"
					class={[
						'h-7 rounded-full border px-2.5 text-xs font-medium transition-all',
						selectedDoctorId === doc.id
							? 'border-[var(--doc-color)] bg-[var(--doc-color)] text-white shadow-sm'
							: 'border-border bg-transparent text-muted-foreground hover:border-[var(--doc-color)] hover:text-foreground',
					].join(' ')}
				>
					{staffLabel(doc)}{#if doc.specialty}<span class="opacity-70 ml-0.5 text-[10px]"> · {doc.specialty}</span>{/if}
				</button>
			{/each}
		</div>

		<span class="h-5 w-px bg-border shrink-0 hidden sm:block"></span>

		<!-- Colleague chips -->
		<div class="flex flex-wrap items-center gap-1">
			{#each selectedColleagueIds as colId}
				{#if doctors.map.get(colId)}
					{@const col = doctors.map.get(colId)!}
					<span
						style="--col-color: {col.color}"
						class="flex items-center gap-1 h-7 rounded-full border border-[var(--col-color)] bg-[var(--col-color)]/10 text-[var(--col-color)] px-2.5 text-xs font-medium"
					>
						{staffLabel(col)}
						<button
							type="button"
							onclick={() => { selectedColleagueIds = selectedColleagueIds.filter(id => id !== colId); }}
							class="ml-0.5 opacity-60 hover:opacity-100"
							aria-label="Remove"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-2.5 w-2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</span>
				{/if}
			{/each}

			<!-- Colleague picker button -->
			{#if showColleaguePicker}
				<div class="relative">
					<div class="absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden" style="min-width:200px; max-width:280px;">
						<div class="border-b border-border px-3 py-1.5">
							<span class="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Kollegen hinzufügen</span>
						</div>
						<div class="flex flex-col overflow-y-auto" style="max-height:180px;">
							{#each [...doctors.list].filter(d => d.show_in_doc_bar !== 0).sort((a, b) => { const aIsDoc = a.role === 'doctor'; const bIsDoc = b.role === 'doctor'; if (aIsDoc !== bIsDoc) return aIsDoc ? 1 : -1; return a.name.localeCompare(b.name); }) as doc}
								<button
									type="button"
									onclick={() => {
										if (!selectedColleagueIds.includes(doc.id)) selectedColleagueIds = [...selectedColleagueIds, doc.id];
										showColleaguePicker = false;
									}}
									class={[
										'flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left border-t border-border/50 first:border-t-0',
										selectedColleagueIds.includes(doc.id) ? 'opacity-50' : '',
									].join(' ')}
								>
									<span class="h-2 w-2 rounded-full shrink-0" style="background:{doc.color}"></span>
									<span class="font-medium truncate">{staffLabel(doc)}</span>
								</button>
							{/each}
						</div>
					</div>
					<button type="button" onclick={() => (showColleaguePicker = false)}
						class="h-7 rounded-full border border-border px-2.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors bg-background">
						Schließen
					</button>
				</div>
			{:else}
				<button type="button" onclick={() => (showColleaguePicker = true)}
					class="h-7 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors">
					+ Kollege
				</button>
			{/if}
		</div>
	</div>

	<!-- ── Title input ────────────────────────────────────────────────── -->
	<input
		type="text"
		placeholder="Titel (optional — wird aus Dokumentation abgeleitet)"
		bind:value={entryTitle}
		onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); } }}
		class="w-full mb-1.5 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-border focus:bg-muted/20 transition-all"
	/>

	<!-- ── Description editor + palette ──────────────────────────────── -->
	<div class="relative">

		<!-- Formatting toolbar -->
		<div class="flex items-center gap-0.5 mb-1">
			<button
				type="button"
				onmousedown={(e) => { e.preventDefault(); applyFormat('bold'); }}
				class="h-6 w-6 rounded text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-center select-none"
				title="Fett (⌘B)"
			>B</button>
			<button
				type="button"
				onmousedown={(e) => { e.preventDefault(); applyFormat('italic'); }}
				class="h-6 w-6 rounded text-xs italic text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-center select-none"
				title="Kursiv (⌘I)"
			>I</button>
			<button
				type="button"
				onmousedown={(e) => { e.preventDefault(); applyFormat('underline'); }}
				class="h-6 w-6 rounded text-xs underline text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-center select-none"
				title="Unterstrichen (⌘U)"
			>U</button>
		</div>

		<!-- Contenteditable editor -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={editorEl}
			bind:innerHTML={description}
			contenteditable="true"
			role="textbox"
			aria-multiline="true"
			data-placeholder="Dokumentation… (/ für Textbausteine)"
			oninput={handleDescriptionInput}
			onkeydown={handleDescriptionKeydown}
			class="editor-content w-full min-h-[72px] rounded-xl border border-border bg-muted/30 px-4 py-2.5 pr-40 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 focus:bg-background transition-all"
		></div>

		<!-- Add button -->
		<div class="absolute right-2 bottom-2 flex items-center gap-1.5">
			<button
				type="button"
				onclick={handleSubmit}
				class="h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
				title="Eintrag hinzufügen (⌘↵)"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<path d="M12 5v14M5 12h14"/>
				</svg>
				Hinzufügen
			</button>
		</div>

		<!-- Text block palette — floats above editor -->
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

	<p class="mt-1 text-[10px] text-muted-foreground/40 text-right">
		<kbd class="font-mono">/</kbd> für Textbausteine · <kbd class="font-mono">@</kbd> für Mitarbeiter · <kbd class="font-mono">⌘B/I/U</kbd> Formatierung · <kbd class="font-mono">⌘↵</kbd> zum Öffnen
	</p>
</div>
