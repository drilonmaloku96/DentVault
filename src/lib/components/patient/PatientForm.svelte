<script lang="ts">
	import type { PatientFormData } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import ArrayFieldEditor from './ArrayFieldEditor.svelte';
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

	// ── Form state ────────────────────────────────────────────────────
	let firstname = $state(untrack(() => initialData?.firstname ?? ''));
	let lastname  = $state(untrack(() => initialData?.lastname  ?? ''));
	let dob       = $state(untrack(() => initialData?.dob       ?? ''));
	let gender    = $state(untrack(() => initialData?.gender    ?? ''));
	let marital_status = $state(untrack(() => initialData?.marital_status ?? ''));
	let blood_group    = $state(untrack(() => initialData?.blood_group    ?? ''));

	let phone = $state(untrack(() => initialData?.phone ?? ''));
	let email = $state(untrack(() => initialData?.email ?? ''));

	let address     = $state(untrack(() => initialData?.address     ?? ''));
	let city        = $state(untrack(() => initialData?.city        ?? ''));
	let postal_code = $state(untrack(() => initialData?.postal_code ?? ''));
	let country     = $state(untrack(() => initialData?.country     ?? ''));

	let emergency_contact_name     = $state(untrack(() => initialData?.emergency_contact_name     ?? ''));
	let emergency_contact_phone    = $state(untrack(() => initialData?.emergency_contact_phone    ?? ''));
	let emergency_contact_relation = $state(untrack(() => initialData?.emergency_contact_relation ?? ''));

	let insurance_provider = $state(untrack(() => initialData?.insurance_provider ?? ''));
	let insurance_id       = $state(untrack(() => initialData?.insurance_id       ?? ''));

	let primary_physician = $state(untrack(() => initialData?.primary_physician ?? ''));
	let allergies = $state<string[]>(untrack(() => {
		try { return JSON.parse(initialData?.allergies ?? '[]'); } catch { return []; }
	}));

	let referral_source  = $state(untrack(() => initialData?.referral_source  ?? ''));
	let smoking_status   = $state(untrack(() => initialData?.smoking_status   ?? ''));
	let occupation       = $state(untrack(() => initialData?.occupation       ?? ''));

	let showDemographics = $state(false);

	let errors      = $state<Record<string, string>>({});
	let isLoading   = $state(false);
	let submitError = $state('');

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!firstname.trim()) errs.firstname = i18n.t.common.required;
		if (!lastname.trim())  errs.lastname  = i18n.t.common.required;
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = i18n.t.common.required;
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
				lastname:  lastname.trim(),
				dob:    dob    || undefined,
				gender: gender || undefined,
				marital_status: marital_status || undefined,
				blood_group:    blood_group    || undefined,
				phone: phone.trim() || undefined,
				email: email.trim() || undefined,
				address:     address.trim()     || undefined,
				city:        city.trim()        || undefined,
				postal_code: postal_code.trim() || undefined,
				country:     country.trim()     || undefined,
				emergency_contact_name:     emergency_contact_name.trim()     || undefined,
				emergency_contact_phone:    emergency_contact_phone.trim()    || undefined,
				emergency_contact_relation: emergency_contact_relation.trim() || undefined,
				insurance_provider: insurance_provider.trim() || undefined,
				insurance_id:       insurance_id.trim()       || undefined,
				primary_physician:  primary_physician.trim()  || undefined,
				allergies: JSON.stringify(allergies),
				referral_source:  referral_source.trim()  || undefined,
				smoking_status:   smoking_status           || undefined,
				occupation:       occupation.trim()        || undefined,
			});
		} catch (err) {
			submitError = err instanceof Error ? err.message : i18n.t.common.unknown;
		} finally {
			isLoading = false;
		}
	}

	const sel = 'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-5 max-w-2xl">
	{#if submitError}
		<Alert variant="destructive">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
				<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
			</svg>
			<AlertDescription>{submitError}</AlertDescription>
		</Alert>
	{/if}

	<!-- ── Personal Information ─────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.personal}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="firstname">{i18n.t.patients.fields.firstName} <span class="text-destructive">*</span></Label>
					<Input id="firstname" placeholder="Jane" bind:value={firstname} aria-invalid={!!errors.firstname} />
					{#if errors.firstname}<p class="text-destructive text-xs">{errors.firstname}</p>{/if}
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="lastname">{i18n.t.patients.fields.lastName} <span class="text-destructive">*</span></Label>
					<Input id="lastname" placeholder="Doe" bind:value={lastname} aria-invalid={!!errors.lastname} />
					{#if errors.lastname}<p class="text-destructive text-xs">{errors.lastname}</p>{/if}
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="dob">{i18n.t.patients.fields.dob}</Label>
					<Input id="dob" type="date" bind:value={dob} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="gender">{i18n.t.patients.fields.gender}</Label>
					<select id="gender" class={sel} bind:value={gender}>
						<option value="">—</option>
						<option value="male">{i18n.t.patients.gender.male}</option>
						<option value="female">{i18n.t.patients.gender.female}</option>
						<option value="other">{i18n.t.patients.gender.other}</option>
						<option value="unknown">{i18n.t.patients.gender.unknown}</option>
					</select>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="marital_status">{i18n.t.patients.fields.maritalStatus}</Label>
					<select id="marital_status" class={sel} bind:value={marital_status}>
						<option value="">—</option>
						<option value="single">{i18n.t.patients.maritalStatus.single}</option>
						<option value="married">{i18n.t.patients.maritalStatus.married}</option>
						<option value="divorced">{i18n.t.patients.maritalStatus.divorced}</option>
						<option value="widowed">{i18n.t.patients.maritalStatus.widowed}</option>
						<option value="partnered">{i18n.t.patients.maritalStatus.partnered}</option>
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="blood_group">{i18n.t.patients.fields.bloodGroup}</Label>
					<select id="blood_group" class={sel} bind:value={blood_group}>
						<option value="">—</option>
						{#each ['A+','A−','B+','B−','AB+','AB−','0+','0−'] as bg}
							<option value={bg}>{bg}</option>
						{/each}
					</select>
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- ── Contact Information ──────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.contact}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="phone">{i18n.t.patients.fields.phone}</Label>
					<Input id="phone" type="tel" placeholder="+1 (555) 000-0000" bind:value={phone} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="email">{i18n.t.patients.fields.email}</Label>
					<Input id="email" type="email" placeholder="jane.doe@example.com" bind:value={email} aria-invalid={!!errors.email} />
					{#if errors.email}<p class="text-destructive text-xs">{errors.email}</p>{/if}
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- ── Address ──────────────────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.address}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="address">{i18n.t.patients.fields.address}</Label>
				<Input id="address" placeholder="123 Main St" bind:value={address} />
			</div>
			<div class="grid grid-cols-3 gap-4">
				<div class="flex flex-col gap-1.5 col-span-1">
					<Label for="postal_code">{i18n.t.patients.fields.postalCode}</Label>
					<Input id="postal_code" placeholder="12345" bind:value={postal_code} />
				</div>
				<div class="flex flex-col gap-1.5 col-span-1">
					<Label for="city">{i18n.t.patients.fields.city}</Label>
					<Input id="city" placeholder="Vienna" bind:value={city} />
				</div>
				<div class="flex flex-col gap-1.5 col-span-1">
					<Label for="country">{i18n.t.patients.fields.country}</Label>
					<Input id="country" placeholder="Austria" bind:value={country} />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- ── Emergency Contact ────────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.emergencyContact}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="ec_name">{i18n.t.patients.fields.emergencyContactName}</Label>
					<Input id="ec_name" placeholder="Anna Doe" bind:value={emergency_contact_name} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="ec_relation">{i18n.t.patients.fields.emergencyContactRelation}</Label>
					<Input id="ec_relation" placeholder="Spouse" bind:value={emergency_contact_relation} />
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="ec_phone">{i18n.t.patients.fields.emergencyContactPhone}</Label>
				<Input id="ec_phone" type="tel" placeholder="+1 (555) 000-0001" bind:value={emergency_contact_phone} />
			</div>
		</CardContent>
	</Card>

	<!-- ── Insurance ────────────────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.insurance}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="insurance_provider">Insurance Provider</Label>
					<Input id="insurance_provider" placeholder="Blue Cross Blue Shield" bind:value={insurance_provider} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="insurance_id">Member / Policy ID</Label>
					<Input id="insurance_id" placeholder="ABC-123456" bind:value={insurance_id} />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- ── Clinical Background ──────────────────────────────────────── -->
	<Card>
		<CardHeader><CardTitle class="text-base">{i18n.t.patients.formSections.clinical}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="primary_physician">{i18n.t.patients.fields.primaryPhysician}</Label>
				<Input id="primary_physician" placeholder="Dr. Smith" bind:value={primary_physician} />
			</div>
			<ArrayFieldEditor
				items={allergies}
				label={i18n.t.patients.fields.allergies}
				placeholder="e.g. Penicillin, Latex"
				variant="danger"
				onUpdate={(items) => (allergies = items)}
			/>
		</CardContent>
	</Card>

	<!-- ── Additional Demographics (collapsible) ────────────────────── -->
	<Card>
		<CardHeader>
			<button type="button" class="flex w-full items-center justify-between text-left" onclick={() => (showDemographics = !showDemographics)}>
				<CardTitle class="text-base">{i18n.t.patients.formSections.demographics}</CardTitle>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={`h-4 w-4 text-muted-foreground transition-transform ${showDemographics ? 'rotate-180' : ''}`}>
					<path d="M6 9l6 6 6-6"/>
				</svg>
			</button>
		</CardHeader>
		{#if showDemographics}
			<CardContent class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="referral_source">{i18n.t.patients.fields.referralSource}</Label>
					<Input id="referral_source" placeholder="e.g. Dr. Smith, Google, Walk-in" bind:value={referral_source} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="smoking_status">{i18n.t.patients.fields.smokingStatus}</Label>
					<select id="smoking_status" class={sel} bind:value={smoking_status}>
						<option value="">—</option>
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

	<!-- ── Actions ──────────────────────────────────────────────────── -->
	<div class="flex items-center gap-3">
		<Button type="submit" disabled={isLoading}>
			{#if isLoading}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2 h-4 w-4 animate-spin">
					<path d="M21 12a9 9 0 11-6.219-8.56"/>
				</svg>
				{i18n.t.common.loading}
			{:else}
				{submitLabel}
			{/if}
		</Button>
		<Button type="button" variant="outline" onclick={() => goto('/patients')}>{i18n.t.actions.cancel}</Button>
	</div>
</form>
