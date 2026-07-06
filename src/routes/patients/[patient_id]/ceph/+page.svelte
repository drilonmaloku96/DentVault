<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { getPatient } from '$lib/services/db';
	import { vault } from '$lib/stores/vault.svelte';
	import { toAbsPath, getMimeType, writeTextFile } from '$lib/services/files';
	import { i18n } from '$lib/i18n';

	const patientId = $derived(page.params.patient_id ?? '');
	/** Vault-relative path of the file to analyze (an image, or a saved .ceph). */
	const relPath = $derived(page.url.searchParams.get('file') ?? '');
	/** Directory of the source file, vault-relative — analyses and PDFs are saved next to it. */
	const relDir = $derived(relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '');

	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let patientName = $state('');
	let patientLoaded = $state(false);
	let loadError = $state('');

	// Busts the webview's cache of the embed's index.html once per app session;
	// the JS bundle it references is content-hashed, so both layers stay fresh
	const cacheBust = Date.now();

	// The load message must be sent exactly once, after BOTH the patient name is
	// known and the iframe app is listening. The iframe posts CEPH_READY when its
	// message listener mounts; a timer after the iframe load event is the fallback.
	let loadSent = false;
	let iframeReady = $state(false);

	function backToPatient() {
		goto(`/patients/${patientId}`);
	}

	async function trySendLoad() {
		if (loadSent || !iframeReady || !patientLoaded) return;
		const target = iframeEl?.contentWindow;
		if (!target || !vault.path || !relPath) return;
		loadSent = true;

		try {
			const fileName = relPath.split('/').pop() ?? relPath;

			if (relPath.toLowerCase().endsWith('.ceph')) {
				const content = await invoke<string>('read_text_file', {
					path: toAbsPath(relPath, vault.path),
				});
				target.postMessage({ type: 'LOAD_CEPH', content, patientName }, '*');
				return;
			}

			// If a sibling .ceph with the same basename exists, continue that analysis
			const base = fileName.replace(/\.[^.]+$/, '');
			const cephRel = relDir ? `${relDir}/${base}.ceph` : `${base}.ceph`;
			if (await invoke<boolean>('file_exists', { path: toAbsPath(cephRel, vault.path) })) {
				const content = await invoke<string>('read_text_file', {
					path: toAbsPath(cephRel, vault.path),
				});
				target.postMessage({ type: 'LOAD_CEPH', content, patientName }, '*');
				return;
			}

			// Hand the image over as a data: URL — fetch()ing an asset:// URL from
			// inside the iframe is blocked cross-scheme, so the bytes go via Rust
			const base64 = await invoke<string>('read_base64_file', {
				path: toAbsPath(relPath, vault.path),
			});
			target.postMessage(
				{
					type: 'LOAD_IMAGE',
					url: `data:${getMimeType(fileName)};base64,${base64}`,
					name: fileName,
					patientName,
				},
				'*',
			);
		} catch (e) {
			// alert() is a no-op in WKWebView — surface the failure in the page
			console.error('Ceph load failed:', e);
			loadError = String(e);
		}
	}

	function handleIframeLoad() {
		// Fallback for builds without CEPH_READY: the React message listener mounts
		// within a frame or two of the load event
		setTimeout(() => {
			iframeReady = true;
			trySendLoad();
		}, 1200);
	}

	async function handleMessage(e: MessageEvent) {
		const data = e.data;
		if (!data?.type || !iframeEl?.contentWindow || e.source !== iframeEl.contentWindow) return;
		const target = iframeEl.contentWindow;

		if (data.type === 'CEPH_READY') {
			iframeReady = true;
			trySendLoad();
		} else if (data.type === 'SAVE_CEPH') {
			try {
				const destRel = relDir ? `${relDir}/${data.filename}` : data.filename;
				await writeTextFile(toAbsPath(destRel, vault.path ?? ''), data.content);
				target.postMessage({ type: 'SAVE_CEPH_RESULT', success: true, path: destRel }, '*');
			} catch (err) {
				console.error('SAVE_CEPH failed:', err);
				target.postMessage({ type: 'SAVE_CEPH_RESULT', success: false, error: String(err) }, '*');
			}
		} else if (data.type === 'SAVE_PDF') {
			try {
				const destRel = relDir ? `${relDir}/${data.filename}` : data.filename;
				await invoke<void>('write_base64_file', {
					destPath: toAbsPath(destRel, vault.path ?? ''),
					base64Data: data.base64,
				});
				target.postMessage({ type: 'SAVE_PDF_RESULT', success: true, path: destRel }, '*');
			} catch (err) {
				console.error('SAVE_PDF failed:', err);
				target.postMessage({ type: 'SAVE_PDF_RESULT', success: false, error: String(err) }, '*');
			}
		} else if (data.type === 'NAVIGATE_BACK') {
			backToPatient();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !e.defaultPrevented) backToPatient();
	}

	onMount(() => {
		// DentVault's UI-scale zoom on <html> breaks the full-window iframe geometry
		// (content renders larger than the window and gets clipped) — neutralize it
		// while the analyzer is open; Cephalyzer has its own fixed proportions.
		const prevZoom = document.documentElement.style.zoom;
		document.documentElement.style.zoom = '1';

		window.addEventListener('message', handleMessage);

		getPatient(patientId)
			.then((p) => {
				patientName = p ? `${p.firstname} ${p.lastname}`.trim() : '';
			})
			.catch((e) => console.error('Patient lookup failed:', e))
			.finally(() => {
				patientLoaded = true;
				trySendLoad();
			});

		return () => {
			window.removeEventListener('message', handleMessage);
			document.documentElement.style.zoom = prevZoom;
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Full-window surface, no header bar — Cephalyzer's logo is the back button
     (it posts NAVIGATE_BACK over the bridge); Escape works too -->
<div class="fixed inset-0 z-[45] bg-background" role="region" aria-label={i18n.t.ceph.title}>
	<iframe
		bind:this={iframeEl}
		src="/cephalyzer/index.html?v={cacheBust}"
		title={i18n.t.ceph.title}
		class="block h-full w-full border-0"
		onload={handleIframeLoad}
	></iframe>

	{#if loadError}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-background/90">
			<div class="max-w-md rounded-lg border border-destructive/50 bg-card p-6 text-center space-y-4">
				<p class="text-sm font-medium text-destructive">{i18n.t.ceph.loadFailed}</p>
				<p class="text-xs text-muted-foreground break-all">{loadError}</p>
				<button
					type="button"
					onclick={backToPatient}
					class="rounded-md border border-border bg-muted/40 hover:bg-muted px-4 py-2 text-xs font-medium transition-colors"
				>
					← {i18n.t.actions.back}
				</button>
			</div>
		</div>
	{/if}
</div>
