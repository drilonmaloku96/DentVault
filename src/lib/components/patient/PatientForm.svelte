<script lang="ts">
	import type { PatientFormData } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { cn } from '$lib/utils';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';

	let {
		initialData = undefined,
		onSubmit,
		submitLabel = 'Save Patient',
	}: {
		initialData?: PatientFormData;
		onSubmit: (data: PatientFormData) => Promise<void>;
		submitLabel?: string;
	} = $props();

	// Form state — snapshot the prop once on mount (untrack prevents reactive warning)
	let firstname = $state(untrack(() => initialData?.firstname ?? ''));
	let lastname = $state(untrack(() => initialData?.lastname ?? ''));
	let dob = $state(untrack(() => initialData?.dob ?? ''));
	let gender = $state(untrack(() => initialData?.gender ?? ''));
	let phone = $state(untrack(() => initialData?.phone ?? ''));
	let email = $state(untrack(() => initialData?.email ?? ''));
	let insurance_provider = $state(untrack(() => initialData?.insurance_provider ?? ''));
	let insurance_id = $state(untrack(() => initialData?.insurance_id ?? ''));
	let referral_source = $state(untrack(() => initialData?.referral_source ?? ''));
	let smoking_status = $state(untrack(() => initialData?.smoking_status ?? ''));
	let occupation = $state(untrack(() => initialData?.occupation ?? ''));
	let showAdditionalDemographics = $state(false);

	let errors = $state<Record<string, string>>({});
	let isLoading = $state(false);
	let submitError = $state('');

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!firstname.trim()) errs.firstname = i18n.t.common.required;
		if (!lastname.trim()) errs.lastname = i18n.t.common.required;
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			errs.email = i18n.t.common.required;
		}
		errors = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		submitError = '';
		if (!validate()) return;
		isLoading = true;
		try {
			await onSubmit({
				firstname: firstname.trim(),
				lastname: lastname.trim(),
				dob: dob || undefined,
				gender: gender || undefined,
				phone: phone.trim() || undefined,
				email: email.trim() || undefined,
				insurance_provider: insurance_provider.trim() || undefined,
				insurance_id: insurance_id.trim() || undefined,
				referral_source: referral_source.trim() || undefined,
				smoking_status: smoking_status || undefined,
				occupation: occupation.trim() || undefined,
			});
		} catch (err) {
			submitError = err instanceof Error ? err.message : i18n.t.common.unknown;
		} finally {
			isLoading = false;
		}
	}

	const selectClass =
		'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-6 max-w-2xl">
	{#if submitError}
		<Alert variant="destructive">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-4 w-4"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<AlertDescription>{submitError}</AlertDescription>
		</Alert>
	{/if}

	<!-- Personal Information -->
	<Card>
		<CardHeader>
			<CardTitle class="text-base">Personal Information</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="firstname">{i18n.t.patients.fields.firstName} <span class="text-destructive">*</span></Label>
					<Input
						id="firstname"
						placeholder="Jane"
						bind:value={firstname}
						aria-invalid={!!errors.firstname}
					/>
					{#if errors.firstname}
						<p class="text-destructive text-xs">{errors.firstname}</p>
					{/if}
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="lastname">{i18n.t.patients.fields.lastName} <span class="text-destructive">*</span></Label>
					<Input
						id="lastname"
						placeholder="Doe"
						bind:value={lastname}
						aria-invalid={!!errors.lastname}
					/>
					{#if errors.lastname}
						<p class="text-destructive text-xs">{errors.lastname}</p>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="dob">{i18n.t.patients.fields.dob}</Label>
					<Input id="dob" type="date" bind:value={dob} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="gender">{i18n.t.patients.fields.gender}</Label>
					<select id="gender" class={selectClass} bind:value={gender}>
						<option value="">Select…</option>
						<option value="male">{i18n.t.patients.gender.male}</option>
						<option value="female">{i18n.t.patients.gender.female}</option>
						<option value="other">{i18n.t.patients.gender.other}</option>
						<option value="prefer_not_to_say">{i18n.t.patients.gender.unknown}</option>
					</select>
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Contact Information -->
	<Card>
		<CardHeader>
			<CardTitle class="text-base">Contact Information</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="phone">{i18n.t.patients.fields.phone}</Label>
				<Input id="phone" type="tel" placeholder="+1 (555) 000-0000" bind:value={phone} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="email">{i18n.t.patients.fields.email}</Label>
				<Input
					id="email"
					type="email"
					placeholder="jane.doe@example.com"
					bind:value={email}
					aria-invalid={!!errors.email}
				/>
				{#if errors.email}
					<p class="text-destructive text-xs">{errors.email}</p>
				{/if}
			</div>
		</CardContent>
	</Card>

	<!-- Insurance -->
	<Card>
		<CardHeader>
			<CardTitle class="text-base">Insurance</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="insurance_provider">Insurance Provider</Label>
				<Input id="insurance_provider" placeholder="Blue Cross Blue Shield" bind:value={insurance_provider} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="insurance_id">Member / Policy ID</Label>
				<Input id="insurance_id" placeholder="ABC-123456" bind:value={insurance_id} />
			</div>
		</CardContent>
	</Card>

	<!-- Additional Demographics (collapsible) -->
	<Card>
		<CardHeader>
			<button
				type="button"
				class="flex w-full items-center justify-between text-left"
				onclick={() => (showAdditionalDemographics = !showAdditionalDemographics)}
			>
				<CardTitle class="text-base">Additional Demographics</CardTitle>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class={`h-4 w-4 text-muted-foreground transition-transform ${showAdditionalDemographics ? 'rotate-180' : ''}`}
				>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
		</CardHeader>
		{#if showAdditionalDemographics}
			<CardContent class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="referral_source">{i18n.t.patients.fields.referralSource}</Label>
					<Input id="referral_source" placeholder="e.g. Dr. Smith, Google, Walk-in" bind:value={referral_source} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="smoking_status">{i18n.t.patients.fields.smokingStatus}</Label>
					<select id="smoking_status" class={selectClass} bind:value={smoking_status}>
						<option value="">Select…</option>
						<option value="never">Never</option>
						<option value="former">Former smoker</option>
						<option value="current_light">Current — Light (&lt;10/day)</option>
						<option value="current_heavy">Current — Heavy (≥10/day)</option>
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="occupation">{i18n.t.patients.fields.occupation}</Label>
					<Input id="occupation" placeholder="e.g. Teacher, Engineer" bind:value={occupation} />
				</div>
			</CardContent>
		{/if}
	</Card>

	<!-- Actions -->
	<div class="flex items-center gap-3">
		<Button type="submit" disabled={isLoading}>
			{#if isLoading}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="mr-2 h-4 w-4 animate-spin"
				>
					<path d="M21 12a9 9 0 11-6.219-8.56" />
				</svg>
				{i18n.t.common.loading}
			{:else}
				{submitLabel}
			{/if}
		</Button>
		<Button type="button" variant="outline" onclick={() => goto('/patients')}>{i18n.t.actions.cancel}</Button>
	</div>
</form>
