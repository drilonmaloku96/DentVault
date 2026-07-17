<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { i18n } from '$lib/i18n';
	import { cephSelection } from '$lib/stores/cephSelection.svelte';

	/**
	 * Shared "which analysis?" menu (Cephalometric / Facial / X-ray Report) used by both
	 * the toolbar's combined button and the sidebar's popup-on-select. Always reflects
	 * cephSelection.file — callers only render this while a file is selected.
	 */
	let {
		onClose,
		showHeader = false,
		panelClass = '',
	}: {
		onClose: () => void;
		/** Sidebar popup shows a small "Analyze as" header; the toolbar dropdown doesn't need one. */
		showHeader?: boolean;
		/** Extra positioning classes supplied by the caller (e.g. "top-full mt-1 right-0"). */
		panelClass?: string;
	} = $props();

	let rootEl = $state<HTMLDivElement | null>(null);

	const items = $derived([
		{
			key: 'ceph',
			label: i18n.t.ceph.button,
			route: 'ceph',
			enabled: cephSelection.isAnalyzable,
			iconClass: 'text-violet-600 dark:text-violet-400',
			hoverClass: 'hover:bg-violet-50 dark:hover:bg-violet-950/30',
		},
		{
			key: 'facial',
			label: i18n.t.facialAnalysis.button,
			route: 'facial-analysis',
			enabled: cephSelection.isImage,
			iconClass: 'text-amber-600 dark:text-amber-400',
			hoverClass: 'hover:bg-amber-50 dark:hover:bg-amber-950/30',
		},
		{
			key: 'xray',
			label: i18n.t.xrayReport.button,
			route: 'xray-report',
			enabled: cephSelection.isImage,
			iconClass: 'text-teal-600 dark:text-teal-400',
			hoverClass: 'hover:bg-teal-50 dark:hover:bg-teal-950/30',
		},
	] as const);

	function pick(route: string, enabled: boolean) {
		if (!enabled) return;
		const sel = cephSelection.file;
		if (!sel) return;
		goto(`/patients/${sel.patientId}/${route}?file=${encodeURIComponent(sel.relPath)}`);
		onClose();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	// Deferred registration: the click that opened this menu is still bubbling to
	// `document` at mount time, so an immediately-registered listener would see that
	// same click and close itself instantly.
	onMount(() => {
		const handleOutside = (e: MouseEvent) => {
			if (rootEl && !rootEl.contains(e.target as Node)) onClose();
		};
		const timer = setTimeout(() => document.addEventListener('click', handleOutside), 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('click', handleOutside);
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div
	bind:this={rootEl}
	class="absolute z-50 min-w-[190px] rounded-md border border-border bg-popover shadow-lg overflow-hidden py-1 {panelClass}"
>
	{#if showHeader}
		<p class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/60">
			{i18n.t.imaging.analyzeAs}
		</p>
	{/if}
	{#each items as item (item.key)}
		<button
			type="button"
			disabled={!item.enabled}
			onclick={() => pick(item.route, item.enabled)}
			class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed {item.enabled ? item.hoverClass : ''}"
		>
			{#if item.key === 'ceph'}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 {item.iconClass}">
					<circle cx="12" cy="5" r="2"/>
					<path d="m3 21 8.02-14.26"/>
					<path d="m12.99 6.74 1.93 3.44"/>
					<path d="M19 12c-3.87 4-7.74 8.61-16 4.61"/>
					<path d="m21 21-2.16-3.84"/>
				</svg>
			{:else if item.key === 'facial'}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 {item.iconClass}">
					<circle cx="12" cy="12" r="9"/>
					<line x1="12" y1="7" x2="12" y2="17"/>
					<line x1="7" y1="12" x2="17" y2="12"/>
				</svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 {item.iconClass}">
					<path d="M3 7V5a2 2 0 0 1 2-2h2"/>
					<path d="M17 3h2a2 2 0 0 1 2 2v2"/>
					<path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
					<path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
					<line x1="7" y1="12" x2="17" y2="12"/>
				</svg>
			{/if}
			<span class="text-foreground truncate">{item.label}</span>
		</button>
	{/each}
</div>
