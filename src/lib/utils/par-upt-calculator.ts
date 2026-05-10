import type { ParGrade, UptWindowResult, UptSessionWindow } from '$lib/types';

function addMonths(dateStr: string, months: number): Date {
	const d = new Date(dateStr);
	d.setMonth(d.getMonth() + months);
	return d;
}

function toISO(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function nextWorkingDay(d: Date, workingDays: number[]): Date {
	const r = new Date(d);
	while (!workingDays.includes(r.getDay() === 0 ? 7 : r.getDay())) {
		r.setDate(r.getDate() + 1);
	}
	return r;
}

function prevWorkingDay(d: Date, workingDays: number[]): Date {
	const r = new Date(d);
	while (!workingDays.includes(r.getDay() === 0 ? 7 : r.getDay())) {
		r.setDate(r.getDate() - 1);
	}
	return r;
}

export function calculateUptWindows(
	grade: ParGrade,
	aitEndDate: string,
	cptEndDate?: string | null,
	workingDays: number[] = [1, 2, 3, 4, 5],
): UptWindowResult {
	const baseDate = cptEndDate && cptEndDate > aitEndDate ? cptEndDate : aitEndDate;
	const maxDate = toISO(addMonths(baseDate, 24));
	const count = ({ A: 2, B: 4, C: 6 } as Record<ParGrade, number>)[grade];
	const sessions: UptSessionWindow[] = [];

	let prevWindowEnd: string = baseDate;

	for (let i = 1; i <= count; i++) {
		const fromDate = i === 1 ? baseDate : prevWindowEnd;
		const rawStart = addMonths(fromDate, 3);
		const rawEnd = addMonths(fromDate, 6);
		const windowStart = toISO(nextWorkingDay(rawStart, workingDays));
		const windowEnd = toISO(
			prevWorkingDay(
				new Date(Math.min(rawEnd.getTime(), new Date(maxDate).getTime())),
				workingDays,
			),
		);

		const session: UptSessionWindow = {
			session: i,
			windowStart,
			windowEnd,
			deliveredDate: null,
			appointmentId: null,
			status: 'future',
		};
		session.status = classifyUptStatus(session);
		sessions.push(session);

		prevWindowEnd = windowEnd;
	}

	return { sessions, total: count, baseDate };
}

export function classifyUptStatus(session: UptSessionWindow): UptSessionWindow['status'] {
	const today = new Date().toISOString().slice(0, 10);
	if (session.deliveredDate) {
		if (session.deliveredDate > session.windowEnd) return 'delivered_late';
		if (session.deliveredDate < session.windowStart) return 'delivered_early';
		return 'delivered_on_time';
	}
	if (today > session.windowEnd) return 'overdue';
	if (today >= session.windowStart) return 'upcoming';
	return 'future';
}
