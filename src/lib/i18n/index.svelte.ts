import { en } from './en';
import { sq } from './sq';
import type { Translations } from './types';

export type { Translations } from './types';

/**
 * Supported UI languages. To add one: create `xx.ts` exporting a full
 * `Translations` object (the type makes a missing key a compile error),
 * then add an entry here. Nothing else needs to change.
 *
 * `name` is the language's own name (shown in pickers regardless of the
 * current UI language); `intl` is the BCP 47 tag for dates/numbers.
 */
export const LANGUAGES = [
	{ code: 'en', name: 'English', intl: 'en-GB', dict: en },
	{ code: 'sq', name: 'Shqip',   intl: 'sq-AL', dict: sq },
] as const satisfies ReadonlyArray<{ code: string; name: string; intl: string; dict: Translations }>;

export type LangCode = (typeof LANGUAGES)[number]['code'];

// Per-device preference (like sidebar width): it must be readable before a
// vault exists, since the language is chosen on the first onboarding screen.
const STORAGE_KEY = 'dentvault.lang';

function find(code: string | null | undefined) {
	return LANGUAGES.find(l => l.code === code);
}

function readStored(): LangCode | null {
	try { return find(localStorage.getItem(STORAGE_KEY))?.code ?? null; } catch { return null; }
}

class I18nStore {
	code = $state<LangCode>(readStored() ?? 'en');
	/** Swapped wholesale on language change — every `i18n.t.*` read re-renders. */
	t = $state.raw<Translations>(find(readStored())?.dict ?? en);

	/** True once the user has picked a language on this device. */
	get chosen(): boolean { return readStored() !== null; }

	/** BCP 47 locale for `toLocaleDateString` / `Intl.*`. */
	get locale(): string { return find(this.code)!.intl; }

	readonly languages = LANGUAGES;

	async init(): Promise<void> {
		this.apply(this.code);
	}

	async setLang(code: string): Promise<void> {
		const lang = find(code);
		if (!lang) return;
		try { localStorage.setItem(STORAGE_KEY, lang.code); } catch { /* storage unavailable */ }
		this.apply(lang.code);
	}

	private apply(code: LangCode) {
		const lang = find(code)!;
		this.code = lang.code;
		this.t = lang.dict;
		if (typeof document !== 'undefined') document.documentElement.lang = lang.intl;
	}
}

export const i18n = new I18nStore();
