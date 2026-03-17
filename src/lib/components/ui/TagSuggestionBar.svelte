<script lang="ts">
	import { scanText, type TagSuggestion } from '$lib/services/keyword-engine';
	import { i18n } from '$lib/i18n';

	let {
		text,
		onAccept,
		onRelatedEntryAccept,
	}: {
		/** The combined free-text to scan (title + description) */
		text: string;
		/** Called when user clicks ✓ on a chip */
		onAccept: (suggestion: TagSuggestion) => void;
		/** Called when user accepts a related_entry suggestion — opens the link picker */
		onRelatedEntryAccept?: () => void;
	} = $props();

	// Track dismissed keys per scan round
	let dismissed = $state<Set<string>>(new Set());
	// Length of text the last time we cleared dismissals (used for "big change" detection)
	let prevDismissLen = $state(0);

	// Pure derived — no side effects
	const allSuggestions = $derived(scanText(text));

	const visibleSuggestions = $derived(
		allSuggestions.filter((s) => !dismissed.has(s.key))
	);

	// Clear dismissals when text changes substantially or is fully cleared
	$effect(() => {
		const len = text.length;
		if (len === 0 || Math.abs(len - prevDismissLen) > 20) {
			dismissed = new Set();
			prevDismissLen = len;
		}
	});

	function accept(s: TagSuggestion) {
		dismissed = new Set([...dismissed, s.key]);
		prevDismissLen = text.length;
		if (s.field === 'related_entry') {
			onRelatedEntryAccept?.();
		} else {
			onAccept(s);
		}
	}

	function dismiss(s: TagSuggestion) {
		dismissed = new Set([...dismissed, s.key]);
		prevDismissLen = text.length;
	}
</script>

{#if visibleSuggestions.length > 0}
	<div class="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/20">
		<span class="text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
			💡 {i18n.t.timeline.tagSuggestion.title}
		</span>

		{#each visibleSuggestions as s (s.key)}
			<span
				class={[
					'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-all',
					s.confidence === 'high'
						? 'border-primary/40 bg-primary/8 text-primary'
						: 'border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground',
				].join(' ')}
				title={s.confidence === 'low' ? 'Possible match — hedging language detected near keyword' : ''}
			>
				{s.icon}
				{#if s.confidence === 'low'}<em class="not-italic opacity-70">Possible:</em>{/if}
				{s.displayLabel}

				<!-- Accept -->
				<button
					type="button"
					class="ml-0.5 rounded-full p-0.5 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
					onclick={() => accept(s)}
					title={i18n.t.timeline.tagSuggestion.accept}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</button>

				<!-- Dismiss -->
				<button
					type="button"
					class="rounded-full p-0.5 text-muted-foreground hover:bg-muted transition-colors"
					onclick={() => dismiss(s)}
					title={i18n.t.timeline.tagSuggestion.dismiss}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</span>
		{/each}
	</div>
{/if}
