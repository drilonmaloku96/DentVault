import type { FacialAnalysisView, FacialMeasurementResult } from '$lib/types';

export type { FacialAnalysisView };

export interface LandmarkDef {
	id: string;
	name: string;
	hint: string;
}

export interface MeasurementDef {
	id: string;
	name: string;
	unit: 'deg' | 'ratio' | 'mm' | '%';
	standardValue?: number;
	standardDeviation?: number;
}

export interface FacialTemplate {
	view: FacialAnalysisView;
	landmarks: LandmarkDef[];
	measurements: MeasurementDef[];
}

type Point = { x: number; y: number };

const PROFILE_LANDMARKS: LandmarkDef[] = [
	{ id: 'tr', name: 'Trichion', hint: 'Midpoint of the hairline, on the forehead midline.' },
	{ id: 'g', name: 'Glabella', hint: 'Most prominent soft-tissue point of the forehead, above the nose, between the eyebrows.' },
	{ id: 'n', name: 'Nasion', hint: 'Deepest point of the nasofrontal angle, at the bridge of the nose between the eyes.' },
	{ id: 'or', name: 'Orbitale', hint: 'Approximate lower border of the eye socket, used with Tragus to approximate the Frankfort horizontal.' },
	{ id: 't', name: 'Tragus', hint: 'Small cartilage flap just in front of the ear canal, used with Orbitale to approximate the Frankfort horizontal.' },
	{ id: 'prn', name: 'Pronasale', hint: 'Most anterior, protruding tip of the nose.' },
	{ id: 'cm', name: 'Columella point', hint: 'Midpoint of the columella at the base of the nostrils, just below the nasal tip.' },
	{ id: 'sn', name: 'Subnasale', hint: 'Point where the base of the nasal septum meets the upper lip.' },
	{ id: 'ls', name: 'Labrale Superius', hint: 'Most anterior point of the upper lip vermilion border.' },
	{ id: 'stms', name: 'Stomion Superius', hint: 'Lowest point of the upper lip vermilion, at the mouth opening.' },
	{ id: 'stmi', name: 'Stomion Inferius', hint: 'Highest point of the lower lip vermilion, at the mouth opening.' },
	{ id: 'li', name: 'Labrale Inferius', hint: 'Most anterior point of the lower lip vermilion border.' },
	{ id: 'sm', name: 'Supramentale (soft-tissue B-point)', hint: 'Deepest point of the concavity between the lower lip and the chin.' },
	{ id: 'pog', name: 'Soft-tissue Pogonion', hint: 'Most anterior (forward-most) point of the chin.' },
	{ id: 'gn', name: 'Soft-tissue Gnathion', hint: 'Midpoint between Pogonion and Menton — the lowest, most forward point of the chin.' },
	{ id: 'me', name: 'Soft-tissue Menton', hint: 'Lowest point of the chin contour.' },
	{ id: 'c', name: 'Cervical point', hint: 'Point of greatest concavity where the neck meets the underside of the chin.' }
];

const FRONTAL_LANDMARKS: LandmarkDef[] = [
	{ id: 'tr', name: 'Trichion', hint: 'Midpoint of the hairline, on the forehead midline.' },
	{ id: 'g', name: 'Glabella', hint: 'Most prominent soft-tissue point of the forehead, above the nose, between the eyebrows.' },
	{ id: 'n', name: 'Nasion', hint: 'Deepest point of the nasofrontal angle, at the bridge of the nose between the eyes.' },
	{ id: 'en_r', name: 'Endocanthion (right)', hint: "Inner corner of the patient's right eye." },
	{ id: 'en_l', name: 'Endocanthion (left)', hint: "Inner corner of the patient's left eye." },
	{ id: 'ex_r', name: 'Exocanthion (right)', hint: "Outer corner of the patient's right eye." },
	{ id: 'ex_l', name: 'Exocanthion (left)', hint: "Outer corner of the patient's left eye." },
	{ id: 'pu_r', name: 'Pupil (right)', hint: "Center of the patient's right pupil." },
	{ id: 'pu_l', name: 'Pupil (left)', hint: "Center of the patient's left pupil." },
	{ id: 'zy_r', name: 'Zygion (right)', hint: "Most lateral point of the patient's right cheekbone." },
	{ id: 'zy_l', name: 'Zygion (left)', hint: "Most lateral point of the patient's left cheekbone." },
	{ id: 'al_r', name: 'Alare (right)', hint: "Most lateral point of the patient's right nostril wing." },
	{ id: 'al_l', name: 'Alare (left)', hint: "Most lateral point of the patient's left nostril wing." },
	{ id: 'sn', name: 'Subnasale', hint: 'Point where the base of the nasal septum meets the upper lip.' },
	{ id: 'ls', name: 'Labrale Superius', hint: 'Most anterior point of the upper lip vermilion border.' },
	{ id: 'ch_r', name: 'Cheilion (right)', hint: "Corner of the mouth on the patient's right side." },
	{ id: 'ch_l', name: 'Cheilion (left)', hint: "Corner of the mouth on the patient's left side." },
	{ id: 'go_r', name: 'Gonion (right)', hint: "Angle of the jaw on the patient's right side." },
	{ id: 'go_l', name: 'Gonion (left)', hint: "Angle of the jaw on the patient's left side." },
	{ id: 'stms', name: 'Stomion Superius', hint: 'Lowest point of the upper lip vermilion, at the mouth opening.' },
	{ id: 'stmi', name: 'Stomion Inferius', hint: 'Highest point of the lower lip vermilion, at the mouth opening.' },
	{ id: 'li', name: 'Labrale Inferius', hint: 'Most anterior point of the lower lip vermilion border.' },
	{ id: 'pog', name: 'Soft-tissue Pogonion', hint: 'Most anterior (forward-most) point of the chin.' },
	{ id: 'me', name: 'Soft-tissue Menton', hint: 'Lowest point of the chin contour.' }
];

const PROFILE_MEASUREMENTS: MeasurementDef[] = [
	{ id: 'facial_convexity', name: 'Facial Convexity Angle', unit: 'deg', standardValue: 168, standardDeviation: 8 },
	{ id: 'nasolabial_angle', name: 'Nasolabial Angle', unit: 'deg', standardValue: 102, standardDeviation: 8 },
	{ id: 'mentolabial_angle', name: 'Mentolabial Angle', unit: 'deg', standardValue: 125, standardDeviation: 10 },
	{ id: 'e_line_ls', name: 'E-line (Upper Lip)', unit: 'mm', standardValue: -2, standardDeviation: 2 },
	{ id: 'e_line_li', name: 'E-line (Lower Lip)', unit: 'mm', standardValue: -4, standardDeviation: 2 },
	{ id: 'nasofrontal_angle', name: 'Nasofrontal Angle', unit: 'deg', standardValue: 122, standardDeviation: 8 },
	{ id: 'holdaway_h_angle', name: 'Holdaway H-Angle', unit: 'deg', standardValue: 11, standardDeviation: 4 },
	{ id: 'facial_thirds_upper', name: 'Facial Thirds — Upper', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'facial_thirds_middle', name: 'Facial Thirds — Middle', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'facial_thirds_lower', name: 'Facial Thirds — Lower', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'lower_third_ratio', name: 'Lower-Third Lip Ratio', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'cervicomental_angle', name: 'Cervicomental Angle', unit: 'deg', standardValue: 100, standardDeviation: 10 }
];

const FRONTAL_MEASUREMENTS: MeasurementDef[] = [
	{ id: 'facial_midline_pog', name: 'Facial Midline Deviation (Pogonion)', unit: 'mm', standardValue: 0, standardDeviation: 2 },
	{ id: 'facial_midline_prn', name: 'Facial Midline Deviation (Nasal Base)', unit: 'mm', standardValue: 0, standardDeviation: 2 },
	{ id: 'facial_thirds_upper', name: 'Facial Thirds — Upper', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'facial_thirds_middle', name: 'Facial Thirds — Middle', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'facial_thirds_lower', name: 'Facial Thirds — Lower', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'facial_index', name: 'Facial Index', unit: 'ratio', standardValue: 0.87, standardDeviation: 0.05 },
	{ id: 'bigonial_bizygomatic_ratio', name: 'Bigonial : Bizygomatic Ratio', unit: 'ratio', standardValue: 0.75, standardDeviation: 0.05 },
	{ id: 'interpupillary_cant', name: 'Interpupillary / Commissure Cant', unit: 'deg', standardValue: 0, standardDeviation: 3 },
	{ id: 'lower_third_ratio', name: 'Lower-Third Lip Ratio', unit: '%', standardValue: 33.3, standardDeviation: 5 },
	{ id: 'rule_of_fifths_nose_width', name: 'Rule of Fifths — Nose Width', unit: 'ratio', standardValue: 1.0, standardDeviation: 0.15 },
	{ id: 'rule_of_fifths_face_width', name: 'Rule of Fifths — Face Width', unit: 'ratio', standardValue: 0.6, standardDeviation: 0.08 }
];

export const FACIAL_TEMPLATES: Record<FacialAnalysisView, FacialTemplate> = {
	profile: { view: 'profile', landmarks: PROFILE_LANDMARKS, measurements: PROFILE_MEASUREMENTS },
	frontal: { view: 'frontal', landmarks: FRONTAL_LANDMARKS, measurements: FRONTAL_MEASUREMENTS }
};

function dist(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

// Three-point angle at `vertex`, formed by rays vertex->a and vertex->b, in degrees [0, 180].
function angleThreePoint(a: Point, vertex: Point, b: Point): number {
	const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
	const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };
	const dot = v1.x * v2.x + v1.y * v2.y;
	const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
	if (mag === 0) return 0;
	const cos = Math.min(1, Math.max(-1, dot / mag));
	return (Math.acos(cos) * 180) / Math.PI;
}

// Angle between two undirected lines (each defined by two points), in degrees [0, 90].
function angleLineLine(l1a: Point, l1b: Point, l2a: Point, l2b: Point): number {
	const a1 = Math.atan2(l1b.y - l1a.y, l1b.x - l1a.x);
	const a2 = Math.atan2(l2b.y - l2a.y, l2b.x - l2a.x);
	let diff = Math.abs(((a1 - a2) * 180) / Math.PI) % 180;
	if (diff > 90) diff = 180 - diff;
	return diff;
}

// Signed perpendicular distance from `p` to the line through (lineA, lineB).
// Sign convention: positive = p is to the LEFT of the directed line lineA->lineB
// (standard 2D cross-product sign; in image space with y-down this is a consistent,
// if not anatomically-labeled, "side" — callers pick lineA->lineB direction to match
// the intended clinical meaning, e.g. Prn->Pog so a forward-projecting lip reads negative).
function signedDistanceToLine(p: Point, lineA: Point, lineB: Point): number {
	const dx = lineB.x - lineA.x;
	const dy = lineB.y - lineA.y;
	const len = Math.hypot(dx, dy);
	if (len === 0) return 0;
	const cross = dx * (p.y - lineA.y) - dy * (p.x - lineA.x);
	return -cross / len;
}

function has(landmarks: Record<string, Point>, ...ids: string[]): boolean {
	return ids.every((id) => landmarks[id] != null);
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function push(
	out: FacialMeasurementResult[],
	defs: Record<string, MeasurementDef>,
	id: string,
	value: number
): void {
	const def = defs[id];
	if (!def) return;
	out.push({ id, value, unit: def.unit, standardValue: def.standardValue, standardDeviation: def.standardDeviation });
}

function computeProfileMeasurements(lm: Record<string, Point>): FacialMeasurementResult[] {
	const out: FacialMeasurementResult[] = [];
	const defs = Object.fromEntries(PROFILE_MEASUREMENTS.map((d) => [d.id, d]));

	if (has(lm, 'g', 'sn', 'pog')) {
		push(out, defs, 'facial_convexity', angleThreePoint(lm.g, lm.sn, lm.pog));
	}
	if (has(lm, 'cm', 'sn', 'ls')) {
		push(out, defs, 'nasolabial_angle', angleThreePoint(lm.cm, lm.sn, lm.ls));
	}
	if (has(lm, 'li', 'sm', 'pog')) {
		push(out, defs, 'mentolabial_angle', angleThreePoint(lm.li, lm.sm, lm.pog));
	}
	if (has(lm, 'ls', 'prn', 'pog')) {
		push(out, defs, 'e_line_ls', signedDistanceToLine(lm.ls, lm.prn, lm.pog));
	}
	if (has(lm, 'li', 'prn', 'pog')) {
		push(out, defs, 'e_line_li', signedDistanceToLine(lm.li, lm.prn, lm.pog));
	}
	if (has(lm, 'g', 'n', 'prn')) {
		push(out, defs, 'nasofrontal_angle', angleThreePoint(lm.g, lm.n, lm.prn));
	}
	if (has(lm, 'ls', 'pog', 'n')) {
		push(out, defs, 'holdaway_h_angle', angleLineLine(lm.ls, lm.pog, lm.n, lm.pog));
	}
	if (has(lm, 'tr', 'g', 'sn', 'me')) {
		const total = dist(lm.tr, lm.me);
		if (total > 0) {
			push(out, defs, 'facial_thirds_upper', (dist(lm.tr, lm.g) / total) * 100);
			push(out, defs, 'facial_thirds_middle', (dist(lm.g, lm.sn) / total) * 100);
			push(out, defs, 'facial_thirds_lower', (dist(lm.sn, lm.me) / total) * 100);
		}
	}
	if (has(lm, 'sn', 'stms', 'me')) {
		const total = dist(lm.sn, lm.me);
		if (total > 0) push(out, defs, 'lower_third_ratio', (dist(lm.sn, lm.stms) / total) * 100);
	}
	if (has(lm, 'sm', 'c', 'me')) {
		push(out, defs, 'cervicomental_angle', angleThreePoint(lm.sm, lm.c, lm.me));
	}

	return out;
}

function computeFrontalMeasurements(lm: Record<string, Point>): FacialMeasurementResult[] {
	const out: FacialMeasurementResult[] = [];
	const defs = Object.fromEntries(FRONTAL_MEASUREMENTS.map((d) => [d.id, d]));

	if (has(lm, 'pog', 'n')) {
		push(out, defs, 'facial_midline_pog', lm.pog.x - lm.n.x);
	}
	if (has(lm, 'al_r', 'al_l', 'n')) {
		const nasalBase = midpoint(lm.al_r, lm.al_l);
		push(out, defs, 'facial_midline_prn', nasalBase.x - lm.n.x);
	}
	if (has(lm, 'tr', 'g', 'sn', 'me')) {
		const total = dist(lm.tr, lm.me);
		if (total > 0) {
			push(out, defs, 'facial_thirds_upper', (dist(lm.tr, lm.g) / total) * 100);
			push(out, defs, 'facial_thirds_middle', (dist(lm.g, lm.sn) / total) * 100);
			push(out, defs, 'facial_thirds_lower', (dist(lm.sn, lm.me) / total) * 100);
		}
	}
	if (has(lm, 'n', 'me', 'zy_r', 'zy_l')) {
		const width = dist(lm.zy_r, lm.zy_l);
		if (width > 0) push(out, defs, 'facial_index', dist(lm.n, lm.me) / width);
	}
	if (has(lm, 'go_r', 'go_l', 'zy_r', 'zy_l')) {
		const width = dist(lm.zy_r, lm.zy_l);
		if (width > 0) push(out, defs, 'bigonial_bizygomatic_ratio', dist(lm.go_r, lm.go_l) / width);
	}
	if (has(lm, 'pu_r', 'pu_l', 'ch_r', 'ch_l')) {
		push(out, defs, 'interpupillary_cant', angleLineLine(lm.pu_r, lm.pu_l, lm.ch_r, lm.ch_l));
	}
	if (has(lm, 'sn', 'stms', 'me')) {
		const total = dist(lm.sn, lm.me);
		if (total > 0) push(out, defs, 'lower_third_ratio', (dist(lm.sn, lm.stms) / total) * 100);
	}
	if (has(lm, 'al_r', 'al_l', 'en_r', 'en_l')) {
		const intercanthal = dist(lm.en_r, lm.en_l);
		if (intercanthal > 0) push(out, defs, 'rule_of_fifths_nose_width', dist(lm.al_r, lm.al_l) / intercanthal);
	}
	if (has(lm, 'ex_r', 'ex_l', 'zy_r', 'zy_l')) {
		const faceWidth = dist(lm.zy_r, lm.zy_l);
		if (faceWidth > 0) push(out, defs, 'rule_of_fifths_face_width', dist(lm.ex_r, lm.ex_l) / faceWidth);
	}

	return out;
}

export function computeMeasurements(
	view: FacialAnalysisView,
	landmarks: Record<string, { x: number; y: number }>
): FacialMeasurementResult[] {
	return view === 'profile' ? computeProfileMeasurements(landmarks) : computeFrontalMeasurements(landmarks);
}
