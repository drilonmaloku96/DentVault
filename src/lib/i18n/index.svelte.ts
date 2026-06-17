import { en } from './en';
import { getSetting } from '$lib/services/db';

export type LangCode = 'en';
export type { Translations } from './types';

class I18nStore {
	code = $state<LangCode>('en');
	t    = en;

	async init(): Promise<void> {
		// Language is always English; persist 'en' in case legacy 'de' was stored
		try { await getSetting('app_locale'); } catch { /* ignore */ }
	}

	/** No-op — kept for call-site compatibility during migration */
	async setLang(_code: string): Promise<void> {}
}

export const i18n = new I18nStore();
