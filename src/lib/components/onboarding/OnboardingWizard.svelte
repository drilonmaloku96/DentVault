<script lang="ts">
	import { fly } from 'svelte/transition';
	import { vault } from '$lib/stores/vault.svelte';
	import { resetDb, insertDoctor } from '$lib/services/db';
	import { pickDirectory } from '$lib/services/files';
	import { i18n, type LangCode } from '$lib/i18n';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffRoles } from '$lib/stores/staffRoles.svelte';
	import { textBlocks } from '$lib/stores/textBlocks.svelte';
	import { acuteTagOptions, medicalTagOptions } from '$lib/stores/clinicalTags.svelte';
	import { complicationTypes } from '$lib/stores/complicationTypes.svelte';

	let { onConfigured }: { onConfigured: () => void } = $props();

	// ── Step state ───────────────────────────────────────────────────
	// 0=welcome, 1=vault, 2=team, 3=defaults, 4=done
	let step = $state(0);
	let direction = $state(1); // 1=forward, -1=back (for fly transition)

	function goTo(target: number) {
		direction = target > step ? 1 : -1;
		step = target;
	}

	// ── Step 1 — Vault ───────────────────────────────────────────────
	let selectedPath = $state('');
	let vaultError = $state('');

	async function handlePickFolder() {
		vaultError = '';
		const path = await pickDirectory();
		if (path) selectedPath = path;
	}

	function handleVaultContinue() {
		if (!selectedPath.trim()) {
			vaultError = i18n.t.onboarding.vaultNone;
			return;
		}
		// Don't call vault.configure() yet — doing so makes vault.isConfigured true
		// which tears down this wizard. Defer to finish().
		goTo(2);
	}

	// ── Step 2 — Team ────────────────────────────────────────────────
	interface StaffDraft { id: number; name: string; role: string; }
	let staffList = $state<StaffDraft[]>([{ id: 1, name: '', role: 'doctor' }]);
	let nextId = $state(2);

	function addMember() {
		staffList.push({ id: nextId, name: '', role: 'doctor' });
		nextId += 1;
	}

	function removeMember(id: number) {
		staffList = staffList.filter(m => m.id !== id);
	}

	// Team is valid if at least one non-empty name; skip is always allowed
	const teamHasValidMember = $derived(staffList.some(m => m.name.trim().length > 0));

	// ── Step 4 — Done / Finish ───────────────────────────────────────
	let finishing = $state(false);

	async function finish() {
		finishing = true;
		try {
			// Configure vault now (deferred from step 1 to avoid unmounting the wizard)
			await vault.configure(selectedPath.trim());
			resetDb();
			// Persist the language choice (setLang failed earlier because vault was not ready)
			await i18n.setLang(i18n.code);
			// Save staff members
			const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#f97316','#06b6d4'];
			for (let i = 0; i < staffList.length; i++) {
				if (staffList[i].name.trim()) {
					await insertDoctor({
						name: staffList[i].name.trim(),
						role: staffList[i].role,
						color: COLORS[i % COLORS.length],
					});
				}
			}
			// Reload stores with the now-configured vault
			await Promise.all([
				docCategories.load(),
				doctors.load(),
				staffRoles.load(),
				textBlocks.load(),
				acuteTagOptions.load(),
				medicalTagOptions.load(),
				complicationTypes.load(),
			]);
			onConfigured();
		} catch {
			finishing = false;
		}
	}

	// ── Language switcher (step 0 only) ──────────────────────────────
	// On step 0, the vault may not be configured, so setSetting might fail.
	// We call setLang and silently ignore DB errors (it still updates i18n.code).
	async function switchLang(code: LangCode) {
		try {
			await i18n.setLang(code);
		} catch {
			// DB not available yet; update in-memory state only
			i18n.code = code;
		}
	}

	// ── Defaults preview data ─────────────────────────────────────────
	const defaultSections = $derived([
		{
			label: i18n.t.onboarding.defaultsSections.docCategories,
			icon: '📁',
			items: i18n.t.defaults.docCategories.map(d => d.label),
		},
		{
			label: i18n.t.onboarding.defaultsSections.acuteTags,
			icon: '🚨',
			items: i18n.t.defaults.acuteTags.map(d => d.label),
		},
		{
			label: i18n.t.onboarding.defaultsSections.medicalTags,
			icon: '🏥',
			items: i18n.t.defaults.medicalTags.map(d => d.label),
		},
		{
			label: i18n.t.onboarding.defaultsSections.textBlocks,
			icon: '📝',
			items: i18n.t.defaults.textBlocks.map(d => d.label),
		},
		{
			label: i18n.t.onboarding.defaultsSections.complicationTypes,
			icon: '⚠️',
			items: i18n.t.defaults.complicationTypes.map(d => d.label),
		},
	]);

	// ── Progress steps (1-indexed display, 1=vault, 2=team, 3=defaults) ──
	const progressLabels = $derived([
		i18n.t.onboarding.stepLabels.vault,
		i18n.t.onboarding.stepLabels.team,
		i18n.t.onboarding.stepLabels.defaults,
	]);
</script>

<!-- ── Full-screen wrapper ──────────────────────────────────────────── -->
<div class="flex min-h-screen items-center justify-center bg-background p-6">

	{#key step}
		<div
			class="w-full"
			in:fly={{ x: direction * 40, duration: 220, delay: 30 }}
		>

		<!-- ═══════════════════════════════════════════════════════════ -->
		<!-- STEP 0 — Welcome                                           -->
		<!-- ═══════════════════════════════════════════════════════════ -->
		{#if step === 0}
			<div class="flex flex-col items-center gap-6 text-center max-w-md mx-auto">
				<!-- Logo -->
				<div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-11 w-11 text-primary"
					>
						<path d="M12 2C8 2 6 5 6 8c0 2 .5 3.5 1 5 .5 1.5 1 3.5 1 6 0 1.5 1 3 2 3s2-1.5 2-3v-2c0-1 1-1 1-1s1 0 1 1v2c0 1.5 1 3 2 3s2-1.5 2-3c0-2.5.5-4.5 1-6s1-3 1-5c0-3-2-6-6-6z" />
					</svg>
				</div>

				<!-- Title + subtitle -->
				<div>
					<h1 class="text-3xl font-bold tracking-tight text-foreground">
						{i18n.t.onboarding.welcomeTitle}
					</h1>
					<p class="mt-2 text-base text-muted-foreground leading-relaxed">
						{i18n.t.onboarding.welcomeSubtitle}
					</p>
				</div>

				<!-- Language switcher -->
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => switchLang('de')}
						class={[
							'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
							i18n.code === 'de'
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-input hover:bg-muted',
						].join(' ')}
					>
						<span>🇩🇪</span> Deutsch
					</button>
					<button
						type="button"
						onclick={() => switchLang('en')}
						class={[
							'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
							i18n.code === 'en'
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-input hover:bg-muted',
						].join(' ')}
					>
						<span>🇬🇧</span> English
					</button>
				</div>

				<!-- Get started button -->
				<button
					type="button"
					onclick={() => goTo(1)}
					class="mt-2 rounded-xl bg-primary px-10 py-3 text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
				>
					{i18n.t.onboarding.getStarted}
				</button>
			</div>

		<!-- ═══════════════════════════════════════════════════════════ -->
		<!-- STEPS 1–3 — Card wrapper                                   -->
		<!-- ═══════════════════════════════════════════════════════════ -->
		{:else if step >= 1 && step <= 3}
			<div class="mx-auto w-full max-w-[540px]">

				<!-- Progress indicator -->
				<div class="mb-6">
					<!-- Step label -->
					<p class="mb-3 text-center text-xs font-medium text-muted-foreground">
						{i18n.t.onboarding.step} {step} / 3 — {progressLabels[step - 1]}
					</p>
					<!-- Dots + lines -->
					<div class="flex items-center justify-center gap-0">
						{#each progressLabels as label, i}
							{@const stepNum = i + 1}
							{@const isCompleted = step > stepNum}
							{@const isCurrent = step === stepNum}
							<!-- Dot -->
							<div
								class={[
									'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
									isCompleted || isCurrent
										? 'bg-primary text-primary-foreground'
										: 'border-2 border-muted text-muted-foreground',
								].join(' ')}
							>
								{#if isCompleted}
									<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="20 6 9 17 4 12" />
									</svg>
								{:else}
									{stepNum}
								{/if}
							</div>
							<!-- Connector line (not after last) -->
							{#if i < progressLabels.length - 1}
								<div class={['h-px w-16 mx-1', isCompleted ? 'bg-primary' : 'bg-muted'].join(' ')}></div>
							{/if}
						{/each}
					</div>
					<!-- Labels below dots -->
					<div class="mt-1.5 flex items-center justify-center gap-0">
						{#each progressLabels as label, i}
							{@const stepNum = i + 1}
							<div class="w-7 text-center">
								<span class={[
									'text-[10px]',
									step === stepNum ? 'font-semibold text-foreground' : 'text-muted-foreground',
								].join(' ')}>
									{label}
								</span>
							</div>
							{#if i < progressLabels.length - 1}
								<div class="w-[66px]"></div>
							{/if}
						{/each}
					</div>
				</div>

				<!-- Card -->
				<div class="rounded-2xl border bg-card p-8 shadow-sm">

					<!-- ─────────────────────────────────────────────── -->
					<!-- STEP 1 — Vault Location                        -->
					<!-- ─────────────────────────────────────────────── -->
					{#if step === 1}
						<h2 class="text-xl font-bold text-foreground">{i18n.t.onboarding.vaultTitle}</h2>
						<p class="mt-2 text-sm text-muted-foreground leading-relaxed">
							{i18n.t.onboarding.vaultDesc}
						</p>

						<!-- Vault structure preview -->
						<div class="my-5 rounded-xl border bg-muted/40 p-4 font-mono text-xs text-muted-foreground">
							<p class="font-semibold text-foreground mb-1">{i18n.t.onboarding.vaultStructureLabel}</p>
							<p>📦 YourVaultFolder/</p>
							<p class="ml-4">📄 dentvault.db</p>
							<p class="ml-4">📁 Smith_John_PT-ABC/</p>
							<p class="ml-8">📁 xrays/</p>
							<p class="ml-8">📁 photos/</p>
							<p class="ml-8">📁 documents/</p>
							<p class="ml-8">📁 lab_results/</p>
							<p class="ml-4">📁 Doe_Jane_PT-DEF/ …</p>
						</div>

						<!-- Folder picker -->
						<div class="flex flex-col gap-2">
							<div class="flex gap-2">
								<div
									class="flex-1 truncate rounded-lg border bg-background px-3 py-2.5 text-sm text-muted-foreground"
									title={selectedPath}
								>
									{selectedPath || i18n.t.onboarding.vaultNone}
								</div>
								<button
									type="button"
									onclick={handlePickFolder}
									class="shrink-0 rounded-lg border bg-muted px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/80"
								>
									{i18n.t.onboarding.vaultChoose}
								</button>
							</div>
							<p class="text-xs text-muted-foreground">{i18n.t.onboarding.vaultHint}</p>
						</div>

						{#if vaultError}
							<p class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
								{vaultError}
							</p>
						{/if}

						<!-- Nav buttons -->
						<div class="mt-6 flex items-center justify-between">
							<button
								type="button"
								onclick={() => goTo(0)}
								class="text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								← {i18n.t.onboarding.back}
							</button>
							<button
								type="button"
								onclick={handleVaultContinue}
								disabled={!selectedPath}
								class="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{i18n.t.onboarding.continueBtn}
							</button>
						</div>

					<!-- ─────────────────────────────────────────────── -->
					<!-- STEP 2 — Team                                   -->
					<!-- ─────────────────────────────────────────────── -->
					{:else if step === 2}
						<h2 class="text-xl font-bold text-foreground">{i18n.t.onboarding.teamTitle}</h2>
						<p class="mt-2 text-sm text-muted-foreground leading-relaxed">
							{i18n.t.onboarding.teamDesc}
						</p>

						<div class="mt-5 flex flex-col gap-2">
							{#each staffList as member (member.id)}
								<div class="flex items-center gap-2">
									<input
										type="text"
										placeholder={i18n.t.onboarding.teamNamePlaceholder}
										bind:value={member.name}
										class="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
									/>
									<select
										bind:value={member.role}
										aria-label={i18n.t.onboarding.teamRoleLabel}
										class="rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
									>
										{#each i18n.t.defaults.staffRoles as roleOption}
											<option value={roleOption.key}>{roleOption.label}</option>
										{/each}
									</select>
									<button
										type="button"
										onclick={() => removeMember(member.id)}
										aria-label="Remove"
										class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
									>
										<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<line x1="18" y1="6" x2="6" y2="18" />
											<line x1="6" y1="6" x2="18" y2="18" />
										</svg>
									</button>
								</div>
							{/each}
						</div>

						<button
							type="button"
							onclick={addMember}
							class="mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
						>
							{i18n.t.onboarding.teamAddMember}
						</button>

						<!-- Nav buttons -->
						<div class="mt-6 flex items-center justify-between">
							<button
								type="button"
								onclick={() => goTo(1)}
								class="text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								← {i18n.t.onboarding.back}
							</button>
							<div class="flex items-center gap-3">
								{#if !teamHasValidMember}
									<button
										type="button"
										onclick={() => goTo(3)}
										class="text-sm text-muted-foreground hover:text-foreground transition-colors"
									>
										{i18n.t.onboarding.skip}
									</button>
								{/if}
								<button
									type="button"
									onclick={() => goTo(3)}
									disabled={!teamHasValidMember}
									class="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{i18n.t.onboarding.continueBtn}
								</button>
							</div>
						</div>

					<!-- ─────────────────────────────────────────────── -->
					<!-- STEP 3 — Default Configuration                 -->
					<!-- ─────────────────────────────────────────────── -->
					{:else if step === 3}
						<h2 class="text-xl font-bold text-foreground">{i18n.t.onboarding.defaultsTitle}</h2>
						<p class="mt-2 text-sm text-muted-foreground leading-relaxed">
							{i18n.t.onboarding.defaultsDesc}
						</p>

						<div class="mt-5 flex flex-col gap-3">
							{#each defaultSections as section}
								<div class="rounded-xl border bg-muted/20 p-3.5">
									<div class="flex items-center justify-between mb-2">
										<div class="flex items-center gap-2">
											<span class="text-base">{section.icon}</span>
											<span class="text-sm font-semibold text-foreground">{section.label}</span>
										</div>
										<span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
											{section.items.length}
										</span>
									</div>
									<div class="flex flex-wrap gap-1.5">
										{#each section.items.slice(0, 4) as item}
											<span class="rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground">
												{item}
											</span>
										{/each}
										{#if section.items.length > 4}
											<span class="rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground">
												+{section.items.length - 4}
											</span>
										{/if}
									</div>
									{#if section.label === i18n.t.onboarding.defaultsSections.textBlocks}
										<p class="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
											<kbd class="rounded border border-border bg-muted px-1 py-px font-mono text-[11px] text-foreground">/</kbd>
											{i18n.t.onboarding.textBlocksHint}
										</p>
									{/if}
								</div>
							{/each}
						</div>

						<p class="mt-4 text-xs text-muted-foreground/70 text-center">
							{i18n.t.onboarding.defaultsNote}
						</p>

						<!-- Nav buttons -->
						<div class="mt-6 flex items-center justify-between">
							<button
								type="button"
								onclick={() => goTo(2)}
								class="text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								← {i18n.t.onboarding.back}
							</button>
							<button
								type="button"
								onclick={() => goTo(4)}
								class="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
							>
								{i18n.t.onboarding.continueBtn} →
							</button>
						</div>
					{/if}

				</div><!-- /card -->
			</div><!-- /max-w wrapper -->

		<!-- ═══════════════════════════════════════════════════════════ -->
		<!-- STEP 4 — All Done                                          -->
		<!-- ═══════════════════════════════════════════════════════════ -->
		{:else if step === 4}
			<div class="flex flex-col items-center gap-6 text-center max-w-md mx-auto">
				<!-- Animated checkmark -->
				<div class="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10">
					<svg class="h-14 w-14" viewBox="0 0 52 52" fill="none">
						<circle
							cx="26"
							cy="26"
							r="24"
							stroke="#10b981"
							stroke-width="3"
							fill="none"
							stroke-dasharray="150.8"
							stroke-dashoffset="150.8"
							style="animation: draw-circle 0.5s ease-out 0.1s forwards;"
						/>
						<polyline
							points="14,26 22,34 38,18"
							stroke="#10b981"
							stroke-width="3.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							fill="none"
							stroke-dasharray="34"
							stroke-dashoffset="34"
							style="animation: draw-check 0.35s ease-out 0.55s forwards;"
						/>
					</svg>
				</div>

				<div>
					<h1 class="text-3xl font-bold tracking-tight text-foreground">
						{i18n.t.onboarding.doneTitle}
					</h1>
					<p class="mt-2 text-base text-muted-foreground leading-relaxed">
						{i18n.t.onboarding.doneSubtitle}
					</p>
				</div>

				<button
					type="button"
					onclick={finish}
					disabled={finishing}
					class="mt-2 rounded-xl bg-primary px-10 py-3 text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
				>
					{finishing ? '…' : i18n.t.onboarding.doneButton}
				</button>
			</div>
		{/if}

		</div>
	{/key}

</div>

<style>
	@keyframes draw-circle {
		to { stroke-dashoffset: 0; }
	}
	@keyframes draw-check {
		to { stroke-dashoffset: 0; }
	}
</style>
