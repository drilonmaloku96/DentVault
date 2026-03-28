/**
 * Persists per-page navigation state across SvelteKit route remounts.
 * Module-level $state survives navigation within the same session.
 */

let _scheduleDate = $state('');
let _dashboardTab = $state<'overview' | 'staff'>('overview');

export const navState = {
	get scheduleDate() { return _scheduleDate; },
	get dashboardTab() { return _dashboardTab; },
	setScheduleDate(d: string) { _scheduleDate = d; },
	setDashboardTab(t: 'overview' | 'staff') { _dashboardTab = t; },
};
