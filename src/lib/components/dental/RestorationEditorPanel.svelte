<script lang="ts">
	import { toFDI } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';

	// ── Types ──────────────────────────────────────────────────────────
	export type BridgeRole = 'tooth' | 'implant' | 'pontic';
	export type ProsthesisRole = 'telescope' | 'clasp' | 'attachment' | 'replaced';
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
		teeth,
		onConfirm,
		onCancel,
		initialMode = undefined,
		initialBridgeRoles = undefined,
		initialProsthesisRoles = undefined,
		isExpand = false,
	}: {
		teeth: number[];
		onConfirm: (result: RestorationResult) => void;
		onCancel: () => void;
		initialMode?: RestorationType;
		initialBridgeRoles?: Map<number, BridgeRole>;
		initialProsthesisRoles?: Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>;
		isExpand?: boolean;
	} = $props();

	// ── Mode toggle ────────────────────────────────────────────────────
	let mode = $state<RestorationType>('bridge');

	// ── Bridge: per-tooth role map ─────────────────────────────────────
	let bridgeRoleMap = $state<Map<number, BridgeRole>>(new Map());

	// ── Prosthesis: per-tooth role + abutment map ─────────────────────
	let prosthesisRoleMap = $state<Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>>(new Map());

	$effect(() => {
		if (teeth && teeth.length > 0) {
			initBridgeRoles(teeth);
			initProsthesisRoles(teeth);
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
		if (teeth && teeth.length > 0) {
			if (newMode === 'bridge') initBridgeRoles(teeth);
			else initProsthesisRoles(teeth);
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
	const PROSTHESIS_CYCLE: ProsthesisRole[] = ['telescope', 'clasp', 'attachment', 'replaced'];

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

	// ── Confirm ────────────────────────────────────────────────────────
	function handleConfirm() {
		if (!teeth || teeth.length === 0) return;
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
		// Parent handles clearing teeth / closing the panel
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
		clasp:      'Klammer',
		attachment: 'Attachment',
		replaced:   'Ersetzt',
	};
	const PROSTHESIS_ROLE_COLOR: Record<ProsthesisRole, string> = {
		telescope:  'border-sky-400 bg-sky-500 text-white',
		clasp:      'border-indigo-500 bg-indigo-500 text-white',
		attachment: 'border-violet-500 bg-violet-500 text-white',
		replaced:   'border-blue-500 bg-blue-500 text-white',
	};

	function isAnchorRole(r: ProsthesisRole): boolean {
		return r === 'telescope' || r === 'clasp' || r === 'attachment';
	}
</script>

<div class="flex flex-col gap-4 overflow-y-auto h-full">
	<!-- Header -->
	<div class="flex items-center justify-between gap-2">
		<div>
			<h3 class="font-semibold text-sm">
				{isExpand ? 'Restauration bearbeiten' : 'Neue Restauration'}
			</h3>
			{#if teeth.length > 0}
				<p class="text-xs text-muted-foreground mt-0.5">
					FDI {teeth.map(t => toFDI(t)).join(', ')} ({teeth.length} Zähne)
				</p>
			{/if}
		</div>
	</div>

	<!-- Mode tabs -->
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

	{#if teeth.length > 0}
		{#if mode === 'bridge'}
			<!-- Bridge role chips -->
			<div class="flex flex-wrap gap-2 py-1">
				{#each teeth as tooth}
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
			<div class="flex flex-wrap gap-2 py-1">
				{#each teeth as tooth}
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

	<!-- Save button -->
	<div class="mt-auto pt-2">
		<Button
			class="w-full"
			onclick={handleConfirm}
			disabled={!teeth || teeth.length === 0}
		>
			{#if isExpand}
				Speichern
			{:else if mode === 'bridge'}
				Brücke anlegen
			{:else}
				Prothese anlegen
			{/if}
		</Button>
	</div>
</div>
