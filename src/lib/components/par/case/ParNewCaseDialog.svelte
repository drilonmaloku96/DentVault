<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { createParCase } from '$lib/services/db';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { i18n } from '$lib/i18n';

	let {
		open = $bindable(false),
		patientId,
		onCreated,
	}: {
		open: boolean;
		patientId: string;
		onCreated: (caseId: number) => void;
	} = $props();

	let planType  = $state<'kasse' | 'privat'>('kasse');
	let doctorId  = $state<number | null>(null);
	let sgb22     = $state(false);
	let isTransfer = $state(false);
	let transferFrom = $state('');
	let saving    = $state(false);
	let error     = $state('');

	function reset() {
		planType     = 'kasse';
		doctorId     = null;
		sgb22        = false;
		isTransfer   = false;
		transferFrom = '';
		error        = '';
	}

	$effect(() => { if (open) reset(); });

	async function handleCreate() {
		saving = true;
		error  = '';
		try {
			const id = await createParCase(patientId, {
				plan_type: planType,
				sgb22,
				is_transfer: isTransfer,
				transfer_from: isTransfer ? transferFrom : '',
				doctor_id: doctorId,
			});
			open = false;
			onCreated(id);
		} catch (e) {
			error = String(e);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[440px] sm:max-w-[440px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.par.newCaseDialog.title}</DialogTitle>
		</DialogHeader>

		<div class="flex flex-col gap-4 py-2">
			<!-- Plan type -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newCaseDialog.planTypeLabel}</label>
				<div class="flex gap-2">
					{#each (['kasse', 'privat'] as const) as pt}
						<button
							type="button"
							onclick={() => planType = pt}
							class={[
								'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
								planType === pt
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border bg-muted/30 text-muted-foreground hover:bg-muted',
							].join(' ')}
						>
							{i18n.t.par.planType[pt]}
						</button>
					{/each}
				</div>
			</div>

			<!-- Doctor -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newCaseDialog.doctorLabel}</label>
				<select
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value;
						doctorId = v ? Number(v) : null;
					}}
				>
					<option value="">{i18n.t.common.none}</option>
					{#each doctors.list as doc}
						<option value={doc.id} selected={doctorId === doc.id}>{staffLabel(doc)}</option>
					{/each}
				</select>
			</div>

			<!-- § 22 SGB V -->
			<label class="flex items-center gap-2.5 cursor-pointer">
				<input
					type="checkbox"
					bind:checked={sgb22}
					class="h-4 w-4 rounded border-input accent-primary"
				/>
				<span class="text-sm">{i18n.t.par.sgb22}</span>
			</label>

			<!-- Transfer case -->
			<div class="flex flex-col gap-2">
				<label class="flex items-center gap-2.5 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={isTransfer}
						class="h-4 w-4 rounded border-input accent-primary"
					/>
					<span class="text-sm">{i18n.t.par.transferCase}</span>
				</label>
				<p class="text-[11px] text-muted-foreground">{i18n.t.par.newCaseDialog.transferHint}</p>
				{#if isTransfer}
					<input
						type="text"
						bind:value={transferFrom}
						placeholder={i18n.t.par.transferFrom}
						class="rounded-md border border-input bg-background px-3 py-2 text-sm"
					/>
				{/if}
			</div>

			<!-- Grade hint -->
			<p class="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
				{i18n.t.par.newCaseDialog.gradeHint}
			</p>

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => open = false}>{i18n.t.actions.cancel}</Button>
			<Button onclick={handleCreate} disabled={saving}>
				{saving ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
