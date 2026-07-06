<script lang="ts">
	/**
	 * FullScreenView — the app-wide pattern for large working surfaces
	 * (dental chart, ortho assessment, therapy planning, PAR, snapshots).
	 *
	 * Replaces nested dialogs ("window within a window"): the surface covers the
	 * entire window with a header bar carrying a ← Back button, title, and
	 * optional right-side actions. Escape backs out unless a real modal dialog
	 * is open on top.
	 *
	 * z-index contract: z-[45] — above the fixed timeline bars (z-40), below
	 * shadcn dialogs (z-50) and chart popovers (z-[60]), so confirm dialogs and
	 * pickers opened from inside a full-screen view stack correctly on top.
	 */

	import type { Snippet } from 'svelte';
	import { i18n } from '$lib/i18n';

	let {
		open = $bindable(false),
		title = '',
		scroll = true,
		maxWidth = '',
		onClose,
		actions,
		children,
	}: {
		open?: boolean;
		title?: string;
		/** false → children manage their own scrolling inside a full-height flex column */
		scroll?: boolean;
		/** optional Tailwind max-w-* class; content is centered when set */
		maxWidth?: string;
		/** when provided, closing calls this instead of writing `open` (for non-bindable open expressions) */
		onClose?: () => void;
		actions?: Snippet;
		children?: Snippet;
	} = $props();

	function close() {
		if (onClose) onClose();
		else open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
		// A real modal (shadcn dialog, chart popover) is open on top — let it take Escape
		if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
		close();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="fixed inset-0 z-[45] bg-background flex flex-col" role="region" aria-label={title}>
		<!-- Header bar -->
		<header class="flex items-center gap-3 h-12 px-4 border-b border-border shrink-0 bg-background">
			<button
				type="button"
				onclick={close}
				class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors shrink-0"
				title="{i18n.t.actions.back} (Esc)"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M19 12H5M12 19l-7-7 7-7"/>
				</svg>
				{i18n.t.actions.back}
			</button>
			<div class="h-5 w-px bg-border shrink-0"></div>
			<h1 class="text-sm font-semibold truncate">{title}</h1>
			<div class="flex-1"></div>
			{#if actions}
				<div class="flex items-center gap-2 shrink-0">
					{@render actions()}
				</div>
			{/if}
		</header>

		<!-- Content -->
		{#if scroll}
			<div class="flex-1 min-h-0 overflow-y-auto">
				<div class={['w-full p-6', maxWidth ? `${maxWidth} mx-auto` : ''].join(' ')}>
					{@render children?.()}
				</div>
			</div>
		{:else}
			<div class="flex-1 min-h-0 flex flex-col">
				{@render children?.()}
			</div>
		{/if}
	</div>
{/if}
