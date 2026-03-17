<script lang="ts">
	import { dentalTags, DEFAULT_DENTAL_TAGS } from '$lib/stores/dentalTags.svelte';
	import type { DentalTag, PatternType } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Dialog, DialogContent, DialogHeader, DialogTitle,
		DialogFooter, DialogDescription,
	} from '$lib/components/ui/dialog';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const PATTERNS: { key: PatternType; label: string }[] = [
		{ key: 'solid',      label: 'Solid' },
		{ key: 'diagonal',   label: 'Diagonal' },
		{ key: 'crosshatch', label: 'Crosshatch' },
		{ key: 'horizontal', label: 'Horizontal' },
		{ key: 'vertical',   label: 'Vertical' },
		{ key: 'dots',       label: 'Dots' },
	];

	let draftTags      = $state<DentalTag[]>([]);
	let isSaving       = $state(false);
	let openPatternIdx = $state<number | null>(null);

	// Detect duplicate shortcuts across all draft tags
	const duplicateShortcuts = $derived.by(() => {
		const seen = new Map<string, number>();
		const dupes = new Set<string>();
		for (const t of draftTags) {
			if (!t.shortcut) continue;
			const key = t.shortcut.toLowerCase();
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		for (const [k, count] of seen) { if (count > 1) dupes.add(k); }
		return dupes;
	});

	// Sync draft when dialog opens
	$effect(() => {
		if (open) {
			draftTags      = dentalTags.list.map(t => ({ ...t }));
			openPatternIdx = null;
		}
	});

	function updateTag(i: number, field: keyof DentalTag, value: string) {
		draftTags = draftTags.map((t, idx) => {
			if (idx !== i) return t;
			// Store empty shortcut as absent rather than ''
			if (field === 'shortcut') {
				const { shortcut: _s, ...rest } = t;
				return value ? { ...rest, shortcut: value } : { ...rest };
			}
			return { ...t, [field]: value };
		});
	}

	function selectPattern(i: number, p: PatternType) {
		draftTags      = draftTags.map((t, idx) => idx === i ? { ...t, pattern: p } : t);
		openPatternIdx = null;
	}

	function addTag() {
		const key = `custom_${Date.now()}`;
		draftTags = [...draftTags, {
			key, label: 'New Tag',
			color: '#e0f2fe', strokeColor: '#0284c7',
			pattern: 'solid',
		}];
	}

	function removeTag(i: number) {
		draftTags      = draftTags.filter((_, idx) => idx !== i);
		openPatternIdx = null;
	}

	function resetDefaults() {
		draftTags      = DEFAULT_DENTAL_TAGS.map(t => ({ ...t }));
		openPatternIdx = null;
	}

	async function handleSave() {
		if (duplicateShortcuts.size > 0) return; // block save on conflicts
		isSaving = true;
		try {
			await dentalTags.save(draftTags);
			open = false;
		} finally {
			isSaving = false;
		}
	}
</script>

<!-- Small SVG preview for the pattern toggle button -->
{#snippet patIcon(pt: PatternType, color: string, stroke: string)}
	<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" class="shrink-0 rounded">
		<rect width="20" height="20" fill={color}/>
		{#if pt === 'diagonal'}
			<line x1="-1" y1="5"  x2="5"  y2="-1" stroke={stroke} stroke-width="1.2"/>
			<line x1="-1" y1="13" x2="13" y2="-1" stroke={stroke} stroke-width="1.2"/>
			<line x1="-1" y1="21" x2="21" y2="-1" stroke={stroke} stroke-width="1.2"/>
			<line x1="5"  y1="21" x2="21" y2="5"  stroke={stroke} stroke-width="1.2"/>
			<line x1="13" y1="21" x2="21" y2="13" stroke={stroke} stroke-width="1.2"/>
		{:else if pt === 'crosshatch'}
			<line x1="0" y1="6"  x2="20" y2="6"  stroke={stroke} stroke-width="1"/>
			<line x1="0" y1="14" x2="20" y2="14" stroke={stroke} stroke-width="1"/>
			<line x1="6"  y1="0" x2="6"  y2="20" stroke={stroke} stroke-width="1"/>
			<line x1="14" y1="0" x2="14" y2="20" stroke={stroke} stroke-width="1"/>
		{:else if pt === 'horizontal'}
			<line x1="0" y1="7"  x2="20" y2="7"  stroke={stroke} stroke-width="1.5"/>
			<line x1="0" y1="14" x2="20" y2="14" stroke={stroke} stroke-width="1.5"/>
		{:else if pt === 'vertical'}
			<line x1="7"  y1="0" x2="7"  y2="20" stroke={stroke} stroke-width="1.5"/>
			<line x1="14" y1="0" x2="14" y2="20" stroke={stroke} stroke-width="1.5"/>
		{:else if pt === 'dots'}
			<circle cx="5"  cy="5"  r="2" fill={stroke}/>
			<circle cx="15" cy="5"  r="2" fill={stroke}/>
			<circle cx="5"  cy="15" r="2" fill={stroke}/>
			<circle cx="15" cy="15" r="2" fill={stroke}/>
			<circle cx="10" cy="10" r="2" fill={stroke}/>
		{/if}
	</svg>
{/snippet}

<Dialog bind:open>
	<DialogContent class="max-w-2xl sm:max-w-2xl">
		<DialogHeader>
			<DialogTitle>{i18n.t.chart.editTagsDialog.title}</DialogTitle>
			<DialogDescription>
				{i18n.t.chart.editTagsDialog.tagName} · {i18n.t.chart.editTagsDialog.color} · {i18n.t.chart.editTagsDialog.pattern} · {i18n.t.chart.editTagsDialog.shortcut}
			</DialogDescription>
		</DialogHeader>

		<!-- Tag list — single-row per tag so all fit without scrolling -->
		<div class="flex flex-col gap-1.5">
			{#each draftTags as tag, i}
				<div class="rounded-md border bg-background">

					<!-- Single row: colour preview · label · shortcut · fill · border · pattern · delete -->
					<div class="flex items-center gap-2 px-3 py-2">

						<!-- Colour preview swatch (fill colour, non-interactive visual cue) -->
						<div class="h-7 w-2 rounded-full shrink-0" style="background:{tag.color};outline:2px solid {tag.strokeColor};outline-offset:1px"></div>

						<!-- Label: built-in tags show translated label (read-only); custom tags are editable -->
						{#if tag.key.startsWith('custom_')}
							<input
								type="text"
								value={tag.label ?? ''}
								oninput={(e) => updateTag(i, 'label', (e.target as HTMLInputElement).value)}
								class="border-input bg-transparent h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
								placeholder="Tag name"
							/>
						{:else}
							<span class="min-w-0 flex-1 truncate px-2 text-sm text-foreground/70">
								{i18n.t.chart.tags[tag.key as keyof typeof i18n.t.chart.tags]?.label ?? tag.key}
							</span>
						{/if}

						<!-- Shortcut key -->
						<input
							type="text"
							maxlength="1"
							value={tag.shortcut ?? ''}
							oninput={(e) => updateTag(i, 'shortcut', (e.target as HTMLInputElement).value.slice(-1))}
							class={[
								'h-8 w-9 shrink-0 rounded border text-center font-mono text-sm outline-none',
								tag.shortcut && duplicateShortcuts.has(tag.shortcut.toLowerCase())
									? 'border-destructive bg-destructive/10 text-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/50'
									: 'border-input bg-background focus:border-ring focus:ring-1 focus:ring-ring/50',
							].join(' ')}
							placeholder="—"
							title={tag.shortcut && duplicateShortcuts.has(tag.shortcut.toLowerCase()) ? i18n.t.chart.editTagsDialog.duplicateShortcut : i18n.t.chart.editTagsDialog.shortcut}
						/>

						<!-- Fill colour -->
						<label class="relative h-8 w-8 shrink-0 rounded border-2 border-border overflow-hidden cursor-pointer" style="background:{tag.color}" title="Fill colour">
							<input
								type="color"
								value={tag.color}
								oninput={(e) => updateTag(i, 'color', (e.target as HTMLInputElement).value)}
								class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"
							/>
						</label>

						<!-- Border colour -->
						<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{tag.strokeColor};border-color:{tag.strokeColor}" title="Border colour">
							<input
								type="color"
								value={tag.strokeColor}
								oninput={(e) => updateTag(i, 'strokeColor', (e.target as HTMLInputElement).value)}
								class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"
							/>
						</label>

						<!-- Pattern toggle -->
						<button
							type="button"
							onclick={() => { openPatternIdx = openPatternIdx === i ? null : i; }}
							class={[
								'flex items-center gap-1 rounded border px-1.5 h-8 shrink-0 transition-colors',
								openPatternIdx === i
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-foreground/40',
							].join(' ')}
							title="Change fill pattern"
						>
							{@render patIcon(tag.pattern, tag.color, tag.strokeColor)}
							<svg
								xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
								stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
								class={['h-3 w-3 text-muted-foreground transition-transform duration-150', openPatternIdx === i ? 'rotate-180' : ''].join(' ')}
							>
								<polyline points="6 9 12 15 18 9"/>
							</svg>
						</button>

						<!-- Delete -->
						<button
							type="button"
							onclick={() => removeTag(i)}
							class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							aria-label="Remove tag"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</div>

					<!-- Pattern picker panel (inline expansion) -->
					{#if openPatternIdx === i}
						<div class="border-t border-border/50 px-3 py-2.5 flex items-center gap-2 flex-wrap rounded-b-md bg-muted/30">
							<span class="text-[10px] font-medium text-muted-foreground w-full mb-0.5">Choose fill pattern:</span>
							{#each PATTERNS as p}
								<button
									type="button"
									onclick={() => selectPattern(i, p.key)}
									class={[
										'flex flex-col items-center gap-1 rounded border p-1.5 transition-all',
										tag.pattern === p.key
											? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1'
											: 'border-border hover:border-foreground/40 bg-background',
									].join(' ')}
									title={p.label}
								>
									{@render patIcon(p.key, tag.color, tag.strokeColor)}
									<span class="text-[9px] text-muted-foreground leading-none">{p.label}</span>
								</button>
							{/each}
						</div>
					{/if}

				</div>
			{/each}
		</div>

		<!-- Add tag -->
		<button
			type="button"
			onclick={addTag}
			class="flex items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full mt-1"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<path d="M12 5v14M5 12h14"/>
			</svg>
			{i18n.t.actions.add}
		</button>

		<Separator />

		<DialogFooter class="flex items-center justify-between gap-2 sm:justify-between">
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="sm" onclick={resetDefaults} class="text-muted-foreground">
					{i18n.t.actions.reset}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => dentalTags.resetShortcutsToLanguageDefaults().then(() => { draftTags = dentalTags.list.map(t => ({ ...t })); })} class="text-muted-foreground text-xs">
					{i18n.t.chart.resetShortcuts}
				</Button>
			</div>
			<div class="flex items-center gap-3">
				{#if duplicateShortcuts.size > 0}
					<span class="text-[11px] text-destructive">
						{i18n.t.chart.editTagsDialog.duplicateShortcut}
					</span>
				{/if}
				<Button variant="outline" onclick={() => (open = false)} disabled={isSaving}>{i18n.t.actions.cancel}</Button>
				<Button onclick={handleSave} disabled={isSaving || duplicateShortcuts.size > 0}>
					{isSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
			</div>
		</DialogFooter>
	</DialogContent>
</Dialog>
