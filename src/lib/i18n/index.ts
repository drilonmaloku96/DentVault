// Re-export everything from the rune-enabled store module.
// This file exists so that `import { i18n } from '$lib/i18n'` resolves correctly —
// TypeScript recognises index.ts (not index.svelte.ts) for directory imports.
export { i18n } from './index.svelte';
export type { LangCode, Translations } from './index.svelte';
