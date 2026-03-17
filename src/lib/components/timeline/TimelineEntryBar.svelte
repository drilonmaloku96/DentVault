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

	let entryDate        = $state(todayISO());
	let entryTitle       = $state('');
	let description      = $state('');
	let selectedDoctorId     = $state<number | null>(null);
	let selectedColleagueIds = $state<number[]>([]);
	let showColleaguePicker  = $state(false);
	let showMentionPalette   = $state(false);
	let mentionQuery         = $state('');
	let mentionStart         = $state(-1);
	let mentionPaletteRef    = $state<ReturnType<typeof StaffMentionPalette> | null>(null);
	let inputError           = $state('');

	// ── Text block palette ────────────────────────────────────────────────
	let showPalette  = $state(false);
	let paletteQuery = $state('');
	let slashStart   = $state(-1);
	let textareaEl   = $state<HTMLTextAreaElement | null>(null);
	let paletteRef   = $state<ReturnType<typeof TextBlockPalette> | null>(null);

	// ── Reset (called by parent after the form opens) ─────────────────────
	export function reset() {
		entryTitle           = '';
		description          = '';
		entryDate            = todayISO();
		selectedDoctorId     = null;
		selectedColleagueIds = [];
		showColleaguePicker  = false;
		showMentionPalette   = false;
		mentionStart         = -1;
		mentionQuery         = '';
		inputError           = '';
	}

	// ── Submit → open full form ───────────────────────────────────────────
	function autoTitle(desc: string, date: string): string {
		if (desc.trim()) {
			const first = desc.split('\n')[0].trim();
			return first.length > 80 ? first.slice(0, 77) + '…' : first;
		}
		const d = new Date(date);
		const ds = isNaN(d.getTime()) ? date : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
		return `Eintrag — ${ds}`;
	}

	function handleSubmit() {
		if (!description.trim() && !entryTitle.trim()) {
			inputError = 'Bitte Titel oder Beschreibung eingeben.';
			return;
		}
		inputError = '';
		onOpen({
			title:           entryTitle.trim() || autoTitle(description, entryDate),
			description:     description.trim(),
			entry_date:      entryDate,
			doctor_id:       selectedDoctorId,
			colleague_ids:   selectedColleagueIds,
		});
	}

	// ── Text block palette + mention palette ─────────────────────────────
	function handleDescriptionInput(e: Event) {
		const ta = e.target as HTMLTextAreaElement;
		const val = ta.value;
		const pos = ta.selectionStart ?? val.length;
		let wordStart = pos;
		while (wordStart > 0 && val[wordStart - 1] !== '\n' && val[wordStart - 1] !== ' ') wordStart--;
		const word = val.slice(wordStart, pos);
		if (word.startsWith('@')) {
			mentionStart = wordStart; mentionQuery = word.slice(1); showMentionPalette = true;
			showPalette = false; slashStart = -1;
		} else if (word.startsWith('/')) {
			slashStart = wordStart; paletteQuery = word.slice(1); showPalette = true;
			showMentionPalette = false; mentionStart = -1;
		} else {
			showPalette = false; slashStart = -1;
			showMentionPalette = false; mentionStart = -1;
		}
	}

	function insertMention(doc: Doctor) {
		if (!textareaEl) return;
		const pos    = textareaEl.selectionStart ?? description.length;
		const before = description.slice(0, mentionStart);
		const after  = description.slice(pos);
		const label  = `@${doc.name}`;
		description  = before + label + after;
		showMentionPalette = false; mentionStart = -1; mentionQuery = '';
		// Also add to selected colleagues
		if (!selectedColleagueIds.includes(doc.id)) {
			selectedColleagueIds = [...selectedColleagueIds, doc.id];
		}
		setTimeout(() => { textareaEl?.focus(); textareaEl?.setSelectionRange(before.length + label.length, before.length + label.length); }, 0);
	}

	function insertBlock(block: import('$lib/stores/textBlocks.svelte').TextBlock) {
		if (!textareaEl) return;
		const pos    = textareaEl.selectionStart ?? description.length;
		const before = description.slice(0, slashStart);
		const after  = description.slice(pos);
		const body   = block.body;
		description  = before + body + after;
		const pi     = body.indexOf('__');
		const base   = before.length;
		const nc     = pi >= 0 ? base + pi : base + body.length;
		const se     = pi >= 0 ? nc + 2 : nc;
		showPalette = false; slashStart = -1; paletteQuery = '';
		setTimeout(() => { textareaEl?.focus(); textareaEl?.setSelectionRange(nc, se); }, 0);
	}

	function handleDescriptionKeydown(e: KeyboardEvent) {
		if (showMentionPalette && mentionPaletteRef?.handleKeydown(e)) return;
		if (showPalette && paletteRef?.handleKeydown(e)) return;
		if (e.key === 'Escape' && showMentionPalette) { showMentionPalette = false; return; }
		if (e.key === 'Escape' && showPalette) { showPalette = false; return; }
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
	}


</script>

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

	<!-- ── Description textarea + palette ────────────────────────────── -->
	<div class="relative">
		<textarea
			bind:this={textareaEl}
			rows={3}
			placeholder="Dokumentation… (/ für Textbausteine)"
			bind:value={description}
			oninput={handleDescriptionInput}
			onkeydown={handleDescriptionKeydown}
			class="w-full resize-none rounded-xl border border-border bg-muted/30 px-4 py-2.5 pr-40 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-2 focus:ring-ring/20 focus:bg-background transition-all"
		></textarea>

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

		<!-- Text block palette — floats above textarea -->
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
		<kbd class="font-mono">/</kbd> für Textbausteine · <kbd class="font-mono">@</kbd> für Mitarbeiter · <kbd class="font-mono">⌘↵</kbd> zum Öffnen
	</p>
</div>
