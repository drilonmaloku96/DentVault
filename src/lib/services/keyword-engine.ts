/**
 * keyword-engine.ts
 * Client-side regex-based scanner that maps clinical free-text to structured tag suggestions.
 * NEVER auto-applies tags — only produces suggestions for human approval.
 */

import type { TreatmentCategory, TreatmentOutcome } from '$lib/types';

export type TagField = 'treatment_category' | 'tooth_numbers' | 'treatment_outcome' | 'related_entry';
export type ConfidenceLevel = 'high' | 'low';

export interface TagSuggestion {
	/** Stable key for deduplication: field + value */
	key: string;
	field: TagField;
	value: string;
	/** Human-readable label shown on the chip */
	displayLabel: string;
	/** Emoji icon for the chip */
	icon: string;
	/** High = solid styling; Low = dashed + "Possible:" prefix (hedging language detected) */
	confidence: ConfidenceLevel;
}

// ── Negation patterns — suppress suggestion entirely ───────────────────
const NEGATION_WINDOW = 70; // chars before the keyword match to scan
const NEGATION_PATTERNS: RegExp[] = [
	/\bno\s+(signs?|evidence|indication|need|history)\s+(of|for)\b/i,
	/\bruled?\s*out\b/i,
	/\bnot\s+indicated\b/i,
	/\bnot\s+needed\b/i,
	/\bnot\s+required\b/i,
	/\bno\s+need\s+for\b/i,
	/\bdenies?\b/i,
	/\bavoiding?\b/i,
	/\bwithout\b/i,
	/\bexcluding?\b/i,
	/\bcontraindicated\b/i,
];

// ── Hedging patterns — reduce to low confidence ────────────────────────
const HEDGING_WINDOW = 90; // chars before the keyword match to scan
const HEDGING_PATTERNS: RegExp[] = [
	/\b(might|may|could|possibly|perhaps|potentially|possible)\b/i,
	/\b(consider|discussed?|discussing|option|options|alternative)\b/i,
	/\b(future|near\s+future|upcoming|eventually|someday)\b/i,
	/\bif\s+(symptoms?|pain|discomfort|it|the\s+tooth|they|needed?)\b/i,
	/\bwould\s+(need|require|benefit)\b/i,
	/\bin\s+case\b/i,
	/\bseems?\s+(like|to)\b/i,
	/\bappears?\s+(to|like)\b/i,
	/\bmonitor(ing)?\b/i,
	/\bwatch\s+and\s+wait\b/i,
	/\bfollow[- ]?up\b/i,
	/\breview\b/i,
	/\bnot\s+yet\b/i,
	/\bpending\b/i,
	/\bplanned?\b/i,
	/\breferred?\s+for\b/i,
];

function checkNegation(text: string, matchIndex: number): boolean {
	const windowStart = Math.max(0, matchIndex - NEGATION_WINDOW);
	const window = text.slice(windowStart, matchIndex + 15).toLowerCase();
	return NEGATION_PATTERNS.some((p) => p.test(window));
}

function checkHedging(text: string, matchIndex: number): boolean {
	const windowStart = Math.max(0, matchIndex - HEDGING_WINDOW);
	const window = text.slice(windowStart, matchIndex + 15).toLowerCase();
	return HEDGING_PATTERNS.some((p) => p.test(window));
}

// ── Treatment category rules ───────────────────────────────────────────

interface CategoryRule {
	pattern: RegExp;
	category: TreatmentCategory;
	icon: string;
	label: string;
}

const CATEGORY_RULES: CategoryRule[] = [
	{
		pattern:
			/\b(root\s+canal|RCT|endodontic|pulpectomy|pulpotomy|pulp\s+cap(?:ping)?|apicoectomy|retreatment|re-treatment|endo\s+treatment|canal\s+treatment|access\s+cavity|obturation|gutta.?percha)\b/i,
		category: 'endodontics',
		icon: '🦷',
		label: 'Endodontics',
	},
	{
		pattern:
			/\b(orthodontic|braces|aligner|invisalign|retainer|archwire|bracket|malocclusion|class\s+I+|skeletal\s+class|molar\s+relationship|overjet|overbite|crossbite|open\s+bite|crowding|arch\s+(expansion|width))\b/i,
		category: 'orthodontics',
		icon: '😁',
		label: 'Orthodontics',
	},
	{
		pattern:
			/\b(crown|bridge|denture|veneer|implant\s+crown|implant\s+prosth|pontic|abutment|onlay|inlay|overlay|zirconia|ceramic\s+restoration|PFM|full\s+arch)\b/i,
		category: 'prosthodontics',
		icon: '🔩',
		label: 'Prosthodontics',
	},
	{
		pattern:
			/\b(scaling|root\s+plan(ing|e)|SRP|flap\s+surgery|perio\s+surgery|bone\s+graft|tissue\s+graft|implant\s+placement|osseointegration|pocket\s+(depth|reduction)|furcation|periodont(itis|al))\b/i,
		category: 'periodontics',
		icon: '🩺',
		label: 'Periodontics',
	},
	{
		pattern:
			/\b(extract(ion|ed)|surgical\s+extract|biopsy|frenectomy|impaction|impacted|third\s+molar|wisdom\s+tooth|alveoplasty|socket|post.?extraction|tooth\s+remov(al|ed))\b/i,
		category: 'oral_surgery',
		icon: '✂️',
		label: 'Oral Surgery',
	},
	{
		pattern:
			/\b(filling|composite|amalgam|glass\s+ionomer|restoration|caries|cavity|decay|carious|interproximal|class\s+[IVX]+\s+(restoration|cavity)|direct\s+restoration)\b/i,
		category: 'restorative',
		icon: '🪥',
		label: 'Restorative',
	},
	{
		pattern:
			/\b(cleaning|prophylaxis|prophy|sealant|fluoride|exam(ination)?|check.?up|recall|prevention|preventive|oral\s+hygiene\s+instruction|OHI)\b/i,
		category: 'preventive',
		icon: '✨',
		label: 'Preventive',
	},
	{
		pattern:
			/\b(x.?ray|xray|radiograph|periapical|panoramic|CBCT|cephalometric|OPG|bitewing|FMX|full\s+mouth\s+radiograph)\b/i,
		category: 'imaging',
		icon: '📷',
		label: 'Imaging',
	},
];

// ── Treatment outcome rules ────────────────────────────────────────────

interface OutcomeRule {
	pattern: RegExp;
	outcome: TreatmentOutcome;
	icon: string;
	label: string;
}

const OUTCOME_RULES: OutcomeRule[] = [
	{
		pattern:
			/\b(retreatment|re-treatment|redo|repeat\s+(root\s+canal|RCT|endo)|re.?root\s+canal)\b/i,
		outcome: 'retreated',
		icon: '🔄',
		label: 'Retreated',
	},
	{
		pattern:
			/\b(extracted?\s+(due\s+to|following|because|after|secondary\s+to)|extraction\s+(following|after|due\s+to|secondary\s+to)|tooth\s+lost|loss\s+of\s+tooth)\b/i,
		outcome: 'failed_extracted',
		icon: '❌',
		label: 'Failed → Extracted',
	},
	{
		pattern: /\b(failed|failure|unsuccessful|not\s+successful|did\s+not\s+(heal|work|resolve))\b/i,
		outcome: 'failed_other',
		icon: '⚠️',
		label: 'Failed',
	},
	{
		pattern:
			/\b(successful|success|healed|healing\s+well|asymptomatic|resolved|no\s+symptoms|periapical\s+healing|bone\s+fill|stable)\b/i,
		outcome: 'successful',
		icon: '✅',
		label: 'Successful',
	},
	{
		pattern:
			/\b(ongoing|in\s+progress|continuing|healing|recall\s+in|review\s+in\s+\d|monitor(ing)?)\b/i,
		outcome: 'ongoing',
		icon: '⏳',
		label: 'Ongoing',
	},
];

// ── Tooth number extraction ────────────────────────────────────────────
// All suggestions are emitted in FDI notation (11–48 permanent, 51–85 primary) —
// the same notation the timeline entry bar stores in tooth_numbers.

const TOOTH_PATTERNS: RegExp[] = [
	/#(\d{1,2})\b/g,
	/\b(?:tooth|zahn)\s+(\d{1,2})\b/gi,
	/\b(?:teeth|zähne)\s+([\d,\s]+)/gi,
	/\bFDI\s+(\d{2})\b/gi,
	/\bd(\d{2})\b/gi, // "d36" shorthand used in the entry bar
];

/** Valid FDI number: quadrants 1–4 positions 1–8, quadrants 5–8 positions 1–5. */
function isValidFDI(n: number): boolean {
	const q = Math.floor(n / 10);
	const p = n % 10;
	if (q >= 1 && q <= 4) return p >= 1 && p <= 8;
	if (q >= 5 && q <= 8) return p >= 1 && p <= 5;
	return false;
}

// Universal 1–32 → FDI (used for unambiguous universal references like "#5")
const UNIVERSAL_TO_FDI: Record<number, number> = {
	 1:18,  2:17,  3:16,  4:15,  5:14,  6:13,  7:12,  8:11,
	 9:21, 10:22, 11:23, 12:24, 13:25, 14:26, 15:27, 16:28,
	17:38, 18:37, 19:36, 20:35, 21:34, 22:33, 23:32, 24:31,
	25:41, 26:42, 27:43, 28:44, 29:45, 30:46, 31:47, 32:48,
};

/** Normalize a raw extracted number to FDI. Valid FDI numbers are kept as-is;
 *  1–10 (which cannot be FDI) are treated as Universal and converted. */
function normalizeToFDI(n: number): number | null {
	if (isValidFDI(n)) return n;
	if (n >= 1 && n <= 10) return UNIVERSAL_TO_FDI[n] ?? null;
	return null;
}

// Palmer notation → universal number mapping (simplified)
const PALMER_MAP: Record<string, string> = {
	UR1: '8', UR2: '7', UR3: '6', UR4: '5', UR5: '4', UR6: '3', UR7: '2', UR8: '1',
	UL1: '9', UL2: '10', UL3: '11', UL4: '12', UL5: '13', UL6: '14', UL7: '15', UL8: '16',
	LR1: '25', LR2: '26', LR3: '27', LR4: '28', LR5: '29', LR6: '30', LR7: '31', LR8: '32',
	LL1: '24', LL2: '23', LL3: '22', LL4: '21', LL5: '20', LL6: '19', LL7: '18', LL8: '17',
};
const PALMER_PATTERN = /\b(U[RL][1-8]|L[RL][1-8])\b/gi;

function extractToothNumbers(text: string): string[] {
	const numbers = new Set<string>();

	for (const pattern of TOOTH_PATTERNS) {
		const re = new RegExp(pattern.source, pattern.flags);
		let match;
		while ((match = re.exec(text)) !== null) {
			const digits = match[1].split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
			for (const d of digits) {
				const n = parseInt(d);
				if (isNaN(n)) continue;
				const fdi = normalizeToFDI(n);
				if (fdi !== null) numbers.add(String(fdi));
			}
		}
	}

	// Palmer notation → Universal → FDI
	let palmerMatch;
	const palmerRe = new RegExp(PALMER_PATTERN.source, PALMER_PATTERN.flags);
	while ((palmerMatch = palmerRe.exec(text)) !== null) {
		const universal = PALMER_MAP[palmerMatch[1].toUpperCase()];
		if (universal) {
			const fdi = UNIVERSAL_TO_FDI[parseInt(universal)];
			if (fdi) numbers.add(String(fdi));
		}
	}

	return Array.from(numbers).sort((a, b) => parseInt(a) - parseInt(b));
}

// ── Main scan function ─────────────────────────────────────────────────

export function scanText(text: string): TagSuggestion[] {
	if (!text || text.trim().length < 4) return [];

	const suggestions: TagSuggestion[] = [];
	const seenKeys = new Set<string>();

	function addSuggestion(s: TagSuggestion) {
		if (!seenKeys.has(s.key)) {
			seenKeys.add(s.key);
			suggestions.push(s);
		}
	}

	// 1. Treatment category
	for (const rule of CATEGORY_RULES) {
		const match = rule.pattern.exec(text);
		if (!match) continue;
		if (checkNegation(text, match.index)) continue;
		const confidence: ConfidenceLevel = checkHedging(text, match.index) ? 'low' : 'high';
		addSuggestion({
			key: `treatment_category:${rule.category}`,
			field: 'treatment_category',
			value: rule.category,
			displayLabel: rule.label,
			icon: rule.icon,
			confidence,
		});
	}

	// 2. Treatment outcome
	for (const rule of OUTCOME_RULES) {
		const match = rule.pattern.exec(text);
		if (!match) continue;
		if (checkNegation(text, match.index)) continue;
		const confidence: ConfidenceLevel = checkHedging(text, match.index) ? 'low' : 'high';
		addSuggestion({
			key: `treatment_outcome:${rule.outcome}`,
			field: 'treatment_outcome',
			value: rule.outcome,
			displayLabel: rule.label,
			icon: rule.icon,
			confidence,
		});
	}

	// 3. Tooth numbers
	const toothNums = extractToothNumbers(text);
	if (toothNums.length > 0) {
		const value = toothNums.join(', ');
		addSuggestion({
			key: `tooth_numbers:${value}`,
			field: 'tooth_numbers',
			value,
			displayLabel: `Tooth ${value}`,
			icon: '🦷',
			confidence: 'high',
		});
	}

	// 4. Related entry suggestion — when retreatment or failed_extracted outcome was detected
	const hasRetreatedOrFailed = suggestions.some(
		s => s.field === 'treatment_outcome' && (s.value === 'retreated' || s.value === 'failed_extracted'),
	);
	if (hasRetreatedOrFailed) {
		addSuggestion({
			key: 'related_entry:suggest',
			field: 'related_entry',
			value: 'suggest',
			displayLabel: 'Link to prior treatment',
			icon: '🔗',
			confidence: 'high',
		});
	}

	return suggestions;
}
