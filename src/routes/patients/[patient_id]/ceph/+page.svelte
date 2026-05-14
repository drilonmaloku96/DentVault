<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { i18n } from '$lib/i18n';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { writeTextFile, writeBase64File } from '$lib/services/files';
	import { getPatient } from '$lib/services/db';
	import { isCephFileType } from '$lib/stores/cephSelection.svelte';

	const patientId  = $derived(page.params.patient_id ?? '');
	const filePath   = $derived(page.url.searchParams.get('filePath') ?? '');
	const fileName   = $derived(page.url.searchParams.get('fileName') ?? '');
	const isLoadingCephFile = $derived(isCephFileType(fileName));

	let iframeEl    = $state<HTMLIFrameElement | null>(null);
	let patientName = $state('');

	$effect(() => {
		const id = patientId;
		getPatient(id).then(p => {
			if (p) patientName = `${p.firstname} ${p.lastname}`;
		}).catch(() => {});
	});

	// Listen for messages from Cephalyzer iframe
	$effect(() => {
		const id = patientId;
		const handleMessage = async (event: MessageEvent) => {
			if (event.data?.type === 'NAVIGATE_BACK') {
				goto(`/patients/${id}`);
				return;
			}

			const normalized = filePath.replace(/\\/g, '/');
			const dir = normalized.substring(0, normalized.lastIndexOf('/'));

			if (event.data?.type === 'SAVE_CEPH') {
				const { content, filename } = event.data as { content: string; filename: string };
				if (!content || !filename || !filePath) return;
				const savePath = `${dir}/${filename}`;
				try {
					await writeTextFile(savePath, content);
					iframeEl?.contentWindow?.postMessage({ type: 'SAVE_CEPH_RESULT', success: true, path: savePath }, '*');
				} catch (err) {
					console.error('SAVE_CEPH write failed:', err);
					iframeEl?.contentWindow?.postMessage({ type: 'SAVE_CEPH_RESULT', success: false }, '*');
				}
				return;
			}

			if (event.data?.type === 'SAVE_PDF') {
				const { base64, filename } = event.data as { base64: string; filename: string };
				if (!base64 || !filename || !filePath) return;
				const savePath = `${dir}/${filename}`;
				try {
					await writeBase64File(savePath, base64);
					iframeEl?.contentWindow?.postMessage({ type: 'SAVE_PDF_RESULT', success: true, path: savePath }, '*');
				} catch (err) {
					console.error('SAVE_PDF write failed:', err);
					iframeEl?.contentWindow?.postMessage({ type: 'SAVE_PDF_RESULT', success: false }, '*');
				}
				return;
			}
		};

		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	});

	async function onIframeLoad() {
		if (!filePath || !fileName || !iframeEl?.contentWindow) return;

		if (isLoadingCephFile) {
			// Fetch .ceph file content and send to iframe
			try {
				const assetUrl = convertFileSrc(filePath);
				const response = await fetch(assetUrl);
				const content = await response.text();
				iframeEl.contentWindow.postMessage({ type: 'LOAD_CEPH', content, patientName }, '*');
			} catch (err) {
				console.error('LOAD_CEPH fetch failed:', err);
			}
		} else {
			// Send image URL to iframe
			const url = convertFileSrc(filePath);
			iframeEl.contentWindow.postMessage(
				{ type: 'LOAD_IMAGE', url, name: fileName, patientName },
				'*'
			);
		}
	}
</script>

<div class="flex flex-col h-full">
	<!-- Thin back bar -->
	<div class="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 bg-background shrink-0 z-10">
		<a
			href="/patients/{patientId}"
			class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<path d="M19 12H5M12 5l-7 7 7 7"/>
			</svg>
			{i18n.t.ceph.backToPatient}
		</a>
		<span class="text-muted-foreground/30">·</span>
		<span class="text-xs font-semibold text-foreground">{i18n.t.ceph.title}</span>
		{#if fileName}
			<span class="text-muted-foreground/30">·</span>
			<span class="text-xs text-muted-foreground truncate max-w-[240px]" title={fileName}>{fileName}</span>
		{/if}
	</div>

	<!-- Cephalyzer app fills remaining space -->
	<iframe
		bind:this={iframeEl}
		src="/cephalyzer/index.html"
		title={i18n.t.ceph.title}
		class="flex-1 w-full border-none"
		allow="clipboard-read; clipboard-write"
		onload={onIframeLoad}
	></iframe>
</div>
