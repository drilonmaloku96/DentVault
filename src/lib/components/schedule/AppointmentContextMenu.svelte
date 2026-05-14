<script lang="ts">
	import type { Appointment } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { appointmentStatusLabels } from '$lib/stores/appointmentStatusLabels.svelte';

	interface Props {
		appointment: Appointment;
		x: number;
		y: number;
		onStatusChange: (id: string, status: string) => void;
		onClose: () => void;
	}

	let { appointment, x, y, onStatusChange, onClose }: Props = $props();

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	const statuses = $derived(appointmentStatusLabels.allStatuses());

	function pick(status: string) {
		onStatusChange(appointment.id, status);
		onClose();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function clampedX(): number {
		if (typeof window === 'undefined') return x;
		return Math.min(x, window.innerWidth - 200);
	}
	function clampedY(): number {
		if (typeof window === 'undefined') return y;
		// custom statuses can make the menu taller
		const menuH = 48 + statuses.length * 36;
		return Math.min(y, window.innerHeight - menuH);
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- Backdrop (invisible) to catch outside clicks -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div use:portal class="fixed inset-0 z-[9990]" onclick={onClose}></div>

<!-- Menu panel -->
<div
	use:portal
	class="fixed z-[9991] min-w-[180px] rounded-xl overflow-hidden"
	style="left: {clampedX()}px; top: {clampedY()}px; background: var(--popover); border: 1px solid var(--border); box-shadow: 0 8px 24px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.14);"
	role="menu"
>
	<div class="px-3 py-2 border-b border-border/60">
		<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.schedule.contextMenu.changeStatus}</p>
	</div>

	{#each statuses as s}
		{@const meta = appointmentStatusLabels.getMeta(s.key)}
		<button
			type="button"
			class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-muted/60
				{appointment.status === s.key ? 'bg-muted/40 font-semibold' : ''}"
			onclick={() => pick(s.key)}
			role="menuitem"
		>
			<span class="w-4 text-center shrink-0 {meta.colorClass}">{meta.icon}</span>
			<span class="{meta.colorClass}">{appointmentStatusLabels.getLabel(s.key)}</span>
			{#if appointment.status === s.key}
				<span class="ml-auto text-[10px] text-muted-foreground">✓</span>
			{/if}
		</button>
	{/each}
</div>
