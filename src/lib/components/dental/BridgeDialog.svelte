<script lang="ts">
	import { toFDI } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog, DialogContent, DialogHeader, DialogTitle,
		DialogFooter, DialogDescription,
	} from '$lib/components/ui/dialog';

	// ── Types ──────────────────────────────────────────────────────────
	export type BridgeRole = 'tooth' | 'implant' | 'pontic';
	export type ProsthesisRole = 'telescope' | 'replaced';
	export type AbutmentType = 'tooth' | 'implant';
	export type RestorationType = 'bridge' | 'prosthesis';

	export interface RestorationResult {
		type: RestorationType;
		// Bridge fields
		ponticTeeth: number[];
		implantAbutments: number[];
		// Prosthesis fields
		prosthesisRoles: Map<number, {
			prosthesis_type: ProsthesisRole;
			abutment_type: AbutmentType;
		}>;
	}

	let {
		teeth = $bindable<number[] | null>(null),
		onConfirm,
		onCancel,
		initialMode = undefined,
		initialBridgeRoles = undefined,
		initialProsthesisRoles = undefined,
		isExpand = false,
	}: {
		teeth?: number[] | null;
		onConfirm: (result: RestorationResult) => void;
		onCancel?: () => void;
		initialMode?: RestorationType;
		initialBridgeRoles?: Map<number, BridgeRole>;
		initialProsthesisRoles?: Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>;
		isExpand?: boolean;
	} = $props();

	const open = $derived(teeth !== null && teeth.length > 0);

	// ── Visual display order (left-to-right as seen in the chart) ──────
	// Upper: Universal 1–16 (FDI 18→11, 21→28)
	// Lower: Universal 32→17 (FDI 48→41, 31→38)
	const VISUAL_ORDER: readonly number[] = [
		1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,   // upper
		32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17, // lower
	];
	const sortedTeeth = $derived(
		teeth ? [...teeth].sort((a, b) => VISUAL_ORDER.indexOf(a) - VISUAL_ORDER.indexOf(b)) : []
	);

	// ── Mode toggle ────────────────────────────────────────────────────
	let mode = $state<RestorationType>('bridge');

	// ── Bridge: per-tooth role map ─────────────────────────────────────
	let bridgeRoleMap = $state<Map<number, BridgeRole>>(new Map());

	// ── Prosthesis: per-tooth role + abutment map ─────────────────────
	let prosthesisRoleMap = $state<Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>>(new Map());

	$effect(() => {
		if (sortedTeeth.length > 0) {
			initBridgeRoles(sortedTeeth);
			initProsthesisRoles(sortedTeeth);
			mode = initialMode ?? 'bridge';
		}
	});

	function initBridgeRoles(ts: number[]) {
		const m = new Map<number, BridgeRole>();
		for (let i = 0; i < ts.length; i++) {
			const t = ts[i];
			m.set(t, initialBridgeRoles?.get(t) ?? ((i === 0 || i === ts.length - 1) ? 'tooth' : 'pontic'));
		}
		bridgeRoleMap = m;
	}

	function initProsthesisRoles(ts: number[]) {
		const m = new Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>();
		for (let i = 0; i < ts.length; i++) {
			const t = ts[i];
			const isEndpoint = i === 0 || i === ts.length - 1;
			m.set(t, initialProsthesisRoles?.get(t) ?? {
				prosthesis_type: isEndpoint ? 'telescope' : 'replaced',
				abutment_type: 'tooth',
			});
		}
		prosthesisRoleMap = m;
	}

	function switchMode(newMode: RestorationType) {
		if (newMode === mode) return;
		mode = newMode;
		if (sortedTeeth.length > 0) {
			if (newMode === 'bridge') initBridgeRoles(sortedTeeth);
			else initProsthesisRoles(sortedTeeth);
		}
	}

	// ── Bridge cycle ───────────────────────────────────────────────────
	function cycleBridgeRole(tooth: number) {
		const current = bridgeRoleMap.get(tooth) ?? 'tooth';
		const next: BridgeRole = current === 'tooth' ? 'implant' : current === 'implant' ? 'pontic' : 'tooth';
		const m = new Map(bridgeRoleMap);
		m.set(tooth, next);
		bridgeRoleMap = m;
	}

	// ── Prosthesis cycle ───────────────────────────────────────────────
	const PROSTHESIS_CYCLE: ProsthesisRole[] = ['telescope', 'replaced'];

	function cycleProsthesisRole(tooth: number) {
		const current = prosthesisRoleMap.get(tooth) ?? { prosthesis_type: 'telescope' as ProsthesisRole, abutment_type: 'tooth' as AbutmentType };
		const idx = PROSTHESIS_CYCLE.indexOf(current.prosthesis_type);
		const next = PROSTHESIS_CYCLE[(idx + 1) % PROSTHESIS_CYCLE.length];
		const m = new Map(prosthesisRoleMap);
		m.set(tooth, { ...current, prosthesis_type: next });
		prosthesisRoleMap = m;
	}

	function toggleAbutmentType(tooth: number) {
		const current = prosthesisRoleMap.get(tooth);
		if (!current) return;
		const m = new Map(prosthesisRoleMap);
		m.set(tooth, { ...current, abutment_type: current.abutment_type === 'tooth' ? 'implant' : 'tooth' });
		prosthesisRoleMap = m;
	}

	// ── Confirm / Cancel ───────────────────────────────────────────────
	function handleConfirm() {
		if (!teeth) return;
		if (mode === 'bridge') {
			const ponticTeeth      = teeth.filter(t => bridgeRoleMap.get(t) === 'pontic');
			const implantAbutments = teeth.filter(t => bridgeRoleMap.get(t) === 'implant');
			onConfirm({
				type: 'bridge',
				ponticTeeth,
				implantAbutments,
				prosthesisRoles: new Map(),
			});
		} else {
			onConfirm({
				type: 'prosthesis',
				ponticTeeth: [],
				implantAbutments: [],
				prosthesisRoles: new Map(prosthesisRoleMap),
			});
		}
		teeth = null;
	}

	function handleCancel() {
		teeth = null;
		onCancel?.();
	}

	// ── Labels & colors ────────────────────────────────────────────────
	const BRIDGE_ROLE_LABEL: Record<BridgeRole, string> = {
		tooth:   'Zahn',
		implant: 'Implantat',
		pontic:  'Pontic',
	};
	const BRIDGE_ROLE_COLOR: Record<BridgeRole, string> = {
		tooth:   'border-border bg-background text-foreground hover:border-foreground/40',
		implant: 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
		pontic:  'border-primary bg-primary/10 text-primary',
	};

	const PROSTHESIS_ROLE_LABEL: Record<ProsthesisRole, string> = {
		telescope:  'Teleskop',
		replaced:   'Ersetzt',
	};
	const PROSTHESIS_ROLE_COLOR: Record<ProsthesisRole, string> = {
		telescope:  'border-sky-400 bg-sky-500 text-white',
		replaced:   'border-blue-500 bg-blue-500 text-white',
	};

	function isAnchorRole(r: ProsthesisRole): boolean {
		return r === 'telescope';
	}
</script>

<Dialog {open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
	<DialogContent class="max-w-sm sm:max-w-sm">
		<DialogHeader>
			<DialogTitle>
				{isExpand ? 'Restauration bearbeiten' : 'Restauration erstellen'}
				{#if sortedTeeth.length > 0}
					— FDI {sortedTeeth.map(t => toFDI(t)).join('–')}
					({sortedTeeth.length} Zähne)
				{/if}
			</DialogTitle>
			<DialogDescription>
				{#if mode === 'bridge'}
					Klicke auf jeden Zahn um die Rolle zuzuweisen: <strong>Zahn</strong> (Pfeiler mit Wurzel), <strong>Implantat</strong> (Pfeiler mit Implantat) oder <strong>Pontic</strong> (Brückenglied, keine Wurzel).
				{:else}
					Klicke auf jeden Zahn um die Prothesenrolle zuzuweisen. Ankerzähne können auf Zahn oder Implantat umgeschaltet werden.
				{/if}
			</DialogDescription>
		</DialogHeader>

		<!-- Mode toggle -->
		<div class="flex rounded-md border border-border overflow-hidden text-sm font-medium">
			<button
				type="button"
				onclick={() => switchMode('bridge')}
				class={[
					'flex-1 px-3 py-1.5 transition-colors',
					mode === 'bridge'
						? 'bg-primary text-primary-foreground'
						: 'bg-background text-muted-foreground hover:bg-muted',
				].join(' ')}
			>
				🔗 Brücke
			</button>
			<button
				type="button"
				onclick={() => switchMode('prosthesis')}
				class={[
					'flex-1 px-3 py-1.5 transition-colors border-l border-border',
					mode === 'prosthesis'
						? 'bg-primary text-primary-foreground'
						: 'bg-background text-muted-foreground hover:bg-muted',
				].join(' ')}
			>
				🦷 Prothese
			</button>
		</div>

		{#if sortedTeeth.length > 0}
			{#if mode === 'bridge'}
				<!-- Bridge role chips -->
				<div class="flex flex-wrap gap-2 py-2">
					{#each sortedTeeth as tooth}
						{@const role = bridgeRoleMap.get(tooth) ?? 'tooth'}
						<button
							type="button"
							onclick={() => cycleBridgeRole(tooth)}
							class={[
								'flex flex-col items-center gap-0.5 rounded-md border px-3 py-2 text-sm transition-all font-medium',
								BRIDGE_ROLE_COLOR[role],
							].join(' ')}
							title="Klicken zum Wechseln: Zahn → Implantat → Pontic"
						>
							<span class="text-base font-semibold leading-none">{toFDI(tooth)}</span>
							<span class="text-[9px] leading-none mt-0.5 opacity-80">
								{BRIDGE_ROLE_LABEL[role]}
							</span>
						</button>
					{/each}
				</div>
				<p class="text-[11px] text-muted-foreground">
					Klicken zum Wechseln der Rolle. Pontics werden gestrichelt ohne Wurzel dargestellt.
				</p>
			{:else}
				<!-- Prosthesis role chips -->
				<div class="flex flex-wrap gap-2 py-2">
					{#each sortedTeeth as tooth}
						{@const roleData = prosthesisRoleMap.get(tooth) ?? { prosthesis_type: 'telescope' as ProsthesisRole, abutment_type: 'tooth' as AbutmentType }}
						{@const isAnchor = isAnchorRole(roleData.prosthesis_type)}
						<div class="flex flex-col items-center gap-1">
							<button
								type="button"
								onclick={() => cycleProsthesisRole(tooth)}
								class={[
									'flex flex-col items-center gap-0.5 rounded-md border px-3 py-2 text-sm transition-all font-medium',
									PROSTHESIS_ROLE_COLOR[roleData.prosthesis_type],
								].join(' ')}
								title="Klicken zum Wechseln der Rolle"
							>
								<span class="text-base font-semibold leading-none">{toFDI(tooth)}</span>
								<span class="text-[9px] leading-none mt-0.5 opacity-90">
									{PROSTHESIS_ROLE_LABEL[roleData.prosthesis_type]}
								</span>
							</button>
							{#if isAnchor}
								<button
									type="button"
									onclick={() => toggleAbutmentType(tooth)}
									class="text-[10px] rounded border border-border px-1.5 py-0.5 bg-background text-muted-foreground hover:bg-muted transition-colors"
									title="Zahn/Implantat umschalten"
								>
									{roleData.abutment_type === 'implant' ? '🔩 Impl.' : '🦷 Zahn'}
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<div class="text-[11px] text-muted-foreground space-y-0.5">
					<p><strong>Teleskop</strong> = Doppelkrone auf Zahn/Implantat</p>
					<p><strong>Klammer</strong> = Klammerverankerung</p>
					<p><strong>Attachment</strong> = Implantat-Attachment</p>
					<p><strong>Ersetzt</strong> = Zahn wird durch Prothese ersetzt</p>
				</div>
			{/if}
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={handleCancel}>Abbrechen</Button>
			<Button onclick={handleConfirm} disabled={!teeth || teeth.length === 0}>
				{#if isExpand}Speichern{:else if mode === 'bridge'}Brücke anlegen{:else}Prothese anlegen{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
