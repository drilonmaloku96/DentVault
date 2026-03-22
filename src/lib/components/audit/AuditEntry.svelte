<script lang="ts">
	import type { AuditRecord } from '$lib/types';
	import { formatDateTime } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let { record }: { record: AuditRecord } = $props();

	function formatTimestamp(ts: string): string {
		return formatDateTime(ts);
	}

	function formatFieldKey(key: string): string {
		return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function formatFieldValue(val: unknown): string {
		if (val === null || val === undefined || val === '') return '(empty)';
		return String(val);
	}

	// Compute the diff: fields that changed (for updates) or all fields (for deletes)
	const diffFields = $derived((): { key: string; before: unknown; after: unknown }[] => {
		if (record.action === 'delete') {
			// Show all fields from before snapshot
			if (!record.before) return [];
			return Object.entries(record.before).map(([key, val]) => ({
				key,
				before: val,
				after: null,
			}));
		}
		// update: show only changed fields
		if (!record.before && !record.after) return [];
		const keys = new Set([
			...Object.keys(record.before ?? {}),
			...Object.keys(record.after ?? {}),
		]);
		return Array.from(keys).map((key) => ({
			key,
			before: (record.before as Record<string, unknown>)?.[key] ?? null,
			after: (record.after as Record<string, unknown>)?.[key] ?? null,
		}));
	});

	let expanded = $state(false);
</script>

<div class="rounded-lg border bg-card shadow-xs overflow-hidden">
	<!-- Header row — always visible, clickable to expand -->
	<button
		type="button"
		class="flex w-full items-start gap-3 p-3.5 text-left hover:bg-muted/40 transition-colors"
		onclick={() => (expanded = !expanded)}
	>
		<!-- Action icon -->
		<div class={[
			'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm',
			record.action === 'delete'
				? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
				: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
		].join(' ')}>
			{#if record.action === 'delete'}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
				</svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
				</svg>
			{/if}
		</div>

		<!-- Content -->
		<div class="flex-1 min-w-0">
			<p class="text-sm font-medium leading-tight">{record.summary}</p>
			<div class="flex flex-wrap items-center gap-x-2 mt-0.5 text-xs text-muted-foreground">
				<span>{formatTimestamp(record.timestamp)}</span>
				<span>·</span>
				<span>{record.user}</span>
				<span>·</span>
				<span class={[
					'rounded px-1.5 py-0.5 font-medium',
					record.action === 'delete'
						? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
						: 'bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400',
				].join(' ')}>
					{record.action === 'delete' ? 'Deleted' : 'Edited'}
				</span>
				{#if record.entity_type !== 'timeline_entry'}
					<span>· {(i18n.t.audit.entityTypes as Record<string, string>)[record.entity_type] ?? record.entity_type}</span>
				{/if}
			</div>
		</div>

		<!-- Expand chevron -->
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			class={['h-4 w-4 shrink-0 text-muted-foreground transition-transform mt-0.5', expanded ? 'rotate-180' : ''].join(' ')}
		>
			<path d="M6 9l6 6 6-6"/>
		</svg>
	</button>

	<!-- Expanded diff -->
	{#if expanded}
		<div class="border-t px-4 pb-3 pt-2.5">
			{#if diffFields().length === 0}
				<p class="text-xs text-muted-foreground italic">No field details recorded.</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each diffFields() as field (field.key)}
						<div class="text-xs">
							<span class="font-medium text-muted-foreground">{formatFieldKey(field.key)}:</span>
							{#if record.action === 'delete'}
								<div class="mt-0.5 rounded bg-red-50 dark:bg-red-950/20 px-2 py-1 text-red-700 dark:text-red-400 font-mono text-[11px] whitespace-pre-wrap break-all">
									{formatFieldValue(field.before)}
								</div>
							{:else}
								{#if field.before !== null}
									<div class="mt-0.5 rounded bg-red-50 dark:bg-red-950/20 px-2 py-1 text-red-700 dark:text-red-400 font-mono text-[11px] whitespace-pre-wrap break-all">
										− {formatFieldValue(field.before)}
									</div>
								{/if}
								{#if field.after !== null}
									<div class="mt-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 text-emerald-700 dark:text-emerald-400 font-mono text-[11px] whitespace-pre-wrap break-all">
										+ {formatFieldValue(field.after)}
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
