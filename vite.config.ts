import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	clearScreen: false,
	server: {
		port: 5173,
		strictPort: true,
		fs: {
			// SvelteKit's dev server restricts fs.allow to src/node_modules/.svelte-kit by
			// default — shared/ (schema-statements.json, read by both db-local.ts and
			// dentvault-server) sits outside that boundary on purpose (it's not TS-only),
			// so it needs an explicit allow. Project root only, not '..' — don't widen this
			// to sibling directories. Doesn't affect `npm run build` (no dev middleware).
			allow: ['.'],
		},
	},
});
