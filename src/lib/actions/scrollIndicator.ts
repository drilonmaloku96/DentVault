/**
 * Svelte action that attaches a floating "scroll down" indicator to any
 * overflow scroll container. The pill appears when content extends below the
 * visible area and fades out once the user reaches the bottom.
 *
 * Usage:
 *   <div use:scrollIndicator class="overflow-auto">
 *   <div use:scrollIndicator={{ zIndex: 60 }} class="overflow-y-auto">
 */

let stylesInjected = false;

function ensureStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const el = document.createElement('style');
	el.id = 'scroll-indicator-css';
	el.textContent = `
		@keyframes _scroll-bounce {
			0%, 100% { transform: translateY(0); }
			50%       { transform: translateY(3px); }
		}
		._scroll-pill { animation: _scroll-bounce 2s ease-in-out infinite; }
	`;
	document.head.appendChild(el);
}

export interface ScrollIndicatorOptions {
	/**
	 * z-index for the fixed overlay pill.
	 * Default 40 — sits above sticky headers but below shadcn dialog overlays (z-50).
	 */
	zIndex?: number;
	/**
	 * Distance in px from the bottom edge of the scroll container.
	 * Default 20.
	 */
	offset?: number;
	/**
	 * How close to the bottom (in px) before the indicator starts fading out.
	 * Default 48.
	 */
	threshold?: number;
}

export function scrollIndicator(
	node: HTMLElement,
	opts: ScrollIndicatorOptions = {},
) {
	const { zIndex = 40, offset = 20, threshold = 48 } = opts;

	ensureStyles();

	// ── Build indicator DOM ────────────────────────────────────────────────
	const wrap = document.createElement('div');
	wrap.setAttribute('aria-hidden', 'true');
	wrap.style.cssText = [
		'position:fixed',
		`z-index:${zIndex}`,
		'pointer-events:none',
		'opacity:0',
		'transition:opacity 250ms ease',
		// horizontal centering is handled by left + translateX(-50%)
		'transform:translateX(-50%)',
	].join(';') + ';';

	const pill = document.createElement('div');
	pill.className = '_scroll-pill';
	pill.style.cssText = [
		'display:flex',
		'align-items:center',
		'justify-content:center',
		'width:28px',
		'height:28px',
		'border-radius:9999px',
		'background:var(--primary)',
		'border:1px solid var(--primary)',
		'box-shadow:0 2px 10px rgba(0,0,0,0.25)',
		'color:var(--primary-foreground)',
	].join(';') + ';';

	pill.innerHTML =
		'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" ' +
		'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
		'<polyline points="6 9 12 15 18 9"/></svg>';

	wrap.appendChild(pill);
	document.body.appendChild(wrap);

	// ── Update logic ───────────────────────────────────────────────────────
	let raf: number | null = null;

	function update() {
		// Check overflow and proximity to bottom
		const hasOverflow = node.scrollHeight > node.clientHeight + 4;
		const nearEnd =
			node.scrollTop + node.clientHeight >= node.scrollHeight - threshold;

		// Reposition the fixed element over the bottom-centre of the container
		const rect = node.getBoundingClientRect();
		wrap.style.left = `${rect.left + rect.width / 2}px`;
		wrap.style.bottom = `${window.innerHeight - rect.bottom + offset}px`;

		wrap.style.opacity = hasOverflow && !nearEnd ? '1' : '0';
	}

	function schedule() {
		// Deduplicate multiple triggers within the same frame
		if (raf !== null) return;
		raf = requestAnimationFrame(() => {
			raf = null;
			update();
		});
	}

	// ── Listeners ──────────────────────────────────────────────────────────

	// Scroll: primary trigger — rechecks nearEnd on every scroll tick
	node.addEventListener('scroll', schedule, { passive: true });

	// Resize: handles window resize + container dimension changes
	const ro = new ResizeObserver(schedule);
	ro.observe(node);

	// DOM mutations: catches navigation (route change replaces page children)
	// and dynamic content that changes the scrollable height.
	// attributes:false + characterData:false keeps this cheap — fires only
	// when elements are added/removed anywhere inside the container.
	const mo = new MutationObserver(schedule);
	mo.observe(node, {
		childList: true,
		subtree: true,
		attributes: false,
		characterData: false,
	});

	// Initial check + a deferred re-check for async content that renders
	// slightly after mount (e.g. timeline entries loading from DB)
	schedule();
	const initTimer = setTimeout(schedule, 250);

	// ── Cleanup ────────────────────────────────────────────────────────────
	return {
		destroy() {
			node.removeEventListener('scroll', schedule);
			ro.disconnect();
			mo.disconnect();
			clearTimeout(initTimer);
			if (raf !== null) cancelAnimationFrame(raf);
			wrap.remove();
		},
	};
}
