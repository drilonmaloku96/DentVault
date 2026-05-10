import type {
	ParAssessmentSnapshot,
	ParCaseStats,
	ParImprovementStats,
	ParMeasurement,
	ParToothData,
	ParToothSummary,
} from '$lib/types';

export function computeToothSummaries(
	measurements: ParMeasurement[],
	toothData: ParToothData[],
): ParToothSummary[] {
	const teethSet = new Set([...measurements.map(m => m.tooth), ...toothData.map(t => t.tooth)]);
	const tdMap = new Map(toothData.map(t => [t.tooth, t]));

	return Array.from(teethSet)
		.sort((a, b) => a - b)
		.map(tooth => {
			const sites = measurements.filter(m => m.tooth === tooth);
			const td = tdMap.get(tooth);
			const pockets = sites.map(s => s.pocket).filter((p): p is number => p !== null);
			const cals = sites
				.map(s => (s.pocket !== null ? s.pocket + (s.recession ?? 0) : null))
				.filter((c): c is number => c !== null);
			return {
				tooth,
				maxPocket: pockets.length > 0 ? Math.max(...pockets) : null,
				bopCount: sites.filter(s => s.bop > 0).length,
				siteCount: sites.length,
				cal: cals.length > 0 ? Math.max(...cals) : null,
				mobility: td?.mobility ?? null,
				status: td?.status ?? null,
				vitality: td?.vitality ?? null,
				aitPlanned: td?.ait_planned ?? false,
				cptPlanned: td?.cpt_planned ?? false,
			};
		});
}

export function computeAssessmentStats(snapshot: ParAssessmentSnapshot): ParCaseStats {
	const { measurements, toothData } = snapshot;
	const pockets = measurements.map(m => m.pocket).filter((p): p is number => p !== null);
	const bopSites = measurements.filter(m => m.bop > 0).length;
	const totalSites = measurements.length;
	const cals = measurements
		.map(m => (m.pocket !== null ? m.pocket + (m.recession ?? 0) : null))
		.filter((c): c is number => c !== null);
	const summaries = computeToothSummaries(measurements, toothData);

	const bopPercent = totalSites > 0 ? (bopSites / totalSites) * 100 : 0;
	const meanPocket =
		pockets.length > 0 ? pockets.reduce((a, b) => a + b, 0) / pockets.length : 0;
	const maxPocket = pockets.length > 0 ? Math.max(...pockets) : 0;
	const teethWithPocket6plus = summaries.filter(s => (s.maxPocket ?? 0) >= 6).length;
	const teethWithBop = summaries.filter(s => s.bopCount > 0).length;
	const cal = cals.length > 0 ? cals.reduce((a, b) => a + b, 0) / cals.length : 0;

	let riskLevel: ParCaseStats['riskLevel'];
	if (
		bopPercent >= 25 ||
		maxPocket >= 6 ||
		toothData.some(t => (t.mobility ?? 0) >= 2)
	) {
		riskLevel = 'high_risk';
	} else if (bopPercent >= 10 || maxPocket >= 5) {
		riskLevel = 'maintenance';
	} else {
		riskLevel = 'stable';
	}

	return { bopPercent, meanPocket, maxPocket, teethWithPocket6plus, teethWithBop, cal, riskLevel };
}

export function compareSnapshots(
	before: ParAssessmentSnapshot,
	after: ParAssessmentSnapshot,
): ParImprovementStats {
	const statsAfter = computeAssessmentStats(after);
	const statsBefore = computeAssessmentStats(before);
	const summBefore = computeToothSummaries(before.measurements, before.toothData);
	const summAfter = computeToothSummaries(after.measurements, after.toothData);
	const afterMap = new Map(summAfter.map(s => [s.tooth, s]));

	let improvedTeeth = 0,
		worsenedTeeth = 0,
		teethWithPocket6Resolved = 0;
	for (const b of summBefore) {
		const a = afterMap.get(b.tooth);
		if (!a) continue;
		const bMax = b.maxPocket ?? 0;
		const aMax = a.maxPocket ?? 0;
		if (aMax < bMax) improvedTeeth++;
		else if (aMax > bMax) worsenedTeeth++;
		if (bMax >= 6 && aMax < 6) teethWithPocket6Resolved++;
	}

	return {
		bopDelta: statsAfter.bopPercent - statsBefore.bopPercent,
		meanPocketDelta: statsAfter.meanPocket - statsBefore.meanPocket,
		cal_delta: statsAfter.cal - statsBefore.cal,
		improvedTeeth,
		worsenedTeeth,
		teethWithPocket6Resolved,
	};
}
