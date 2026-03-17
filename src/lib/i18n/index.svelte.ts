import { en } from './en';
import { de } from './de';
import type { LangCode } from './types';
import { getSetting, setSetting } from '$lib/services/db';

export type { LangCode };
export type { Translations } from './types';

const LANGS = { en, de } as const;

class I18nStore {
	code = $state<LangCode>('de');
	t    = $derived(LANGS[this.code]);

	async init(): Promise<void> {
		try {
			const saved = await getSetting('app_locale');
			if (saved === 'en' || saved === 'de') this.code = saved;
		} catch { /* keep default */ }
	}

	async setLang(code: LangCode): Promise<void> {
		this.code = code;
		await setSetting('app_locale', code);
	}
}

export const i18n = new I18nStore();
