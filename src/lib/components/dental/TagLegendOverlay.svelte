<script lang="ts">
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { bridgeRoles } from '$lib/stores/bridgeRoles.svelte';
	import { i18n } from '$lib/i18n';

	let { onClose, ctrlHeld = false }: {
		onClose: () => void;
		ctrlHeld?: boolean;
	} = $props();

	const LEGEND_GROUPS = $derived([
		{ label: i18n.t.chart.tagGroups.general,          keys: ['healthy', 'watch', 'impacted', 'fractured'] },
		{ label: i18n.t.chart.tagGroups.restorative,      keys: ['decayed', 'filled'] },
		{ label: i18n.t.chart.tagGroups.endodontic,       keys: ['root_canal'] },
		{ label: i18n.t.chart.tagGroups.fixedProsthetics, keys: ['crowned', 'implant', 'bridge'] },
		{ label: i18n.t.chart.tagGroups.removable,        keys: ['prosthesis'] },
		{ label: i18n.t.chart.tagGroups.absent,           keys: ['missing', 'extracted'] },
		{ label: i18n.t.chart.tagGroups.primary,          keys: ['erupting', 'persistent_primary'] },
	]);

	const customTags = $derived(dentalTags.list.filter(t => t.key.startsWith('custom_')));

	function getDisplayColor(key: string, color: string) {
		if (key === 'bridge')     return bridgeRoles.getConfig('abutment').fillColor;
		if (key === 'prosthesis') return prosthesisTypes.getConfig('telescope').fillColor;
		return color;
	}
	function getDisplayStroke(key: string, strokeColor: string) {
		if (key === 'bridge')     return bridgeRoles.getConfig('abutment').color;
		if (key === 'prosthesis') return prosthesisTypes.getConfig('telescope').color;
		return strokeColor;
	}
</script>

<!--
	Floating legend overlay — positioned absolute inside chart container.
	Shown via button click (pinned) or Ctrl key (transient).
-->
<div
	class="absolute top-0 right-0 z-50 w-[360px] rounded-xl border border-border/60 bg-background/97 shadow-xl backdrop-blur-sm"
	style="max-height: calc(100% - 8px); overflow-y: auto;"
	role="dialog"
	aria-label={i18n.t.chart.legend}
>
	<!-- Header -->
	<div class="flex items-center justify-between px-4 py-3 border-b border-border/50 sticky top-0 bg-background/97 backdrop-blur-sm z-10">
		<div class="flex items-center gap-2">
			<!-- Tooth icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-muted-foreground/60 shrink-0">
				<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
			</svg>
			<span class="text-sm font-semibold text-foreground">{i18n.t.chart.legend}</span>
		</div>
		{#if !ctrlHeld}
			<button
				onclick={onClose}
				class="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
				aria-label={i18n.t.actions.close}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		{/if}
	</div>

	<!-- Tag groups — two columns -->
	<div class="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-3">
		{#each LEGEND_GROUPS as group}
			{@const groupTags = dentalTags.list.filter(t => group.keys.includes(t.key))}
			{#if groupTags.length > 0}
				<div class="flex flex-col gap-1.5">
					<span class="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 leading-none">{group.label}</span>
					<div class="flex flex-col gap-1">
						{#each groupTags as tag}
							{@const dc = getDisplayColor(tag.key, tag.color)}
							{@const ds = getDisplayStroke(tag.key, tag.strokeColor)}
							<div class="flex items-center gap-2">
								<!-- Divided-square tooth icon (16×16, slightly larger than the old 13px) -->
								<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
									<polygon points="0,0 16,0 12,4 4,4"   fill={dc}/>
									<polygon points="0,16 4,12 12,12 16,16" fill={dc}/>
									<polygon points="0,0 4,4 4,12 0,16"   fill={dc}/>
									<polygon points="16,0 16,16 12,12 12,4" fill={dc}/>
									<polygon points="4,4 12,4 12,12 4,12"  fill={dc}/>
									<rect x="0" y="0" width="16" height="16" fill="none" stroke={ds} stroke-width="1.2"/>
									<rect x="4" y="4" width="8"  height="8"  fill="none" stroke={ds} stroke-width="0.7" opacity="0.7"/>
									<line x1="0" y1="0"  x2="4"  y2="4"  stroke={ds} stroke-width="0.7" opacity="0.7"/>
									<line x1="16" y1="0" x2="12" y2="4"  stroke={ds} stroke-width="0.7" opacity="0.7"/>
									<line x1="16" y1="16" x2="12" y2="12" stroke={ds} stroke-width="0.7" opacity="0.7"/>
									<line x1="0" y1="16" x2="4"  y2="12" stroke={ds} stroke-width="0.7" opacity="0.7"/>
								</svg>
								<span class="text-xs text-foreground/80 leading-none">
									{dentalTags.getLabel(tag.key)}
								</span>
								{#if tag.shortcut}
									<kbd class="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground leading-none">{tag.shortcut}</kbd>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/each}

		{#if customTags.length > 0}
			<div class="col-span-2 flex flex-col gap-1.5 pt-1 border-t border-border/40">
				<span class="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 leading-none">{i18n.t.chart.tagGroups.custom}</span>
				<div class="flex flex-wrap gap-x-4 gap-y-1">
					{#each customTags as tag}
						<div class="flex items-center gap-2">
							<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
								<polygon points="0,0 16,0 12,4 4,4"   fill={tag.color}/>
								<polygon points="0,16 4,12 12,12 16,16" fill={tag.color}/>
								<polygon points="0,0 4,4 4,12 0,16"   fill={tag.color}/>
								<polygon points="16,0 16,16 12,12 12,4" fill={tag.color}/>
								<polygon points="4,4 12,4 12,12 4,12"  fill={tag.color}/>
								<rect x="0" y="0" width="16" height="16" fill="none" stroke={tag.strokeColor} stroke-width="1.2"/>
								<rect x="4" y="4" width="8"  height="8"  fill="none" stroke={tag.strokeColor} stroke-width="0.7" opacity="0.7"/>
								<line x1="0" y1="0"  x2="4"  y2="4"  stroke={tag.strokeColor} stroke-width="0.7" opacity="0.7"/>
								<line x1="16" y1="0" x2="12" y2="4"  stroke={tag.strokeColor} stroke-width="0.7" opacity="0.7"/>
								<line x1="16" y1="16" x2="12" y2="12" stroke={tag.strokeColor} stroke-width="0.7" opacity="0.7"/>
								<line x1="0" y1="16" x2="4"  y2="12" stroke={tag.strokeColor} stroke-width="0.7" opacity="0.7"/>
							</svg>
							<span class="text-xs text-foreground/80 leading-none">{dentalTags.getLabel(tag.key)}</span>
							{#if tag.shortcut}
								<kbd class="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground leading-none">{tag.shortcut}</kbd>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- Footer hint -->
	<div class="px-4 py-2.5 border-t border-border/40 flex items-center gap-2">
		<kbd class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Ctrl</kbd>
		<span class="text-[11px] text-muted-foreground">{i18n.t.chart.legendHint}</span>
	</div>
</div>
