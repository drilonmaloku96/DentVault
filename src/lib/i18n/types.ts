export type LangCode = 'en' | 'de';

export interface Translations {
	meta: {
		code: 'en' | 'de';
		name: string;
	};

	// ── Global actions ────────────────────────────────────────────────
	actions: {
		save: string; cancel: string; delete: string; edit: string;
		close: string; add: string; confirm: string; search: string;
		filter: string; export: string; load: string; reset: string;
		new: string; back: string; next: string; prev: string;
		done: string; saveClose: string; open: string; copy: string;
		dismiss: string; accept: string; apply: string; remove: string;
	};

	// ── Common UI ─────────────────────────────────────────────────────
	common: {
		loading: string; noData: string; optional: string; required: string;
		date: string; notes: string; name: string; all: string; none: string;
		unknown: string; yes: string; no: string; today: string;
		legacy: string; examiner: string; doctor: string; tooth: string;
	};

	// ── Navigation ────────────────────────────────────────────────────
	nav: {
		patients: string; dashboard: string; reports: string; settings: string;
	};

	// ── Vault / app init ──────────────────────────────────────────────
	vault: {
		opening: string; choosePath: string; noVault: string;
		welcome: string; welcomeDesc: string;
	};

	// ── Patients ──────────────────────────────────────────────────────
	patients: {
		title: string; new: string; search: string;
		noResults: string; noPatients: string;
		status: { active: string; inactive: string; archived: string; deceased: string };
		gender: { male: string; female: string; other: string; unknown: string };
		fields: {
			firstName: string; lastName: string; dob: string; gender: string;
			phone: string; email: string; address: string;
			referralSource: string; smokingStatus: string; occupation: string;
			allergies: string; bloodGroup: string;
		};
		tabs: {
			timeline: string; plans: string; chart: string;
			perio: string; documents: string;
		};
		medicalHistory: string; acuteProblems: string; conditions: string;
		editPatient: string; deletePatient: string;
		deleteConfirm: string; deleteWarning: string;
	};

	// ── Timeline ──────────────────────────────────────────────────────
	timeline: {
		title: string; addEntry: string; noEntries: string;
		filter: string; filterAll: string; loading: string;
		entry: {
			category: string; outcome: string; toothNumbers: string;
			doctor: string; colleagues: string; relatedEntry: string;
			addImage: string; viewImage: string; openExternal: string;
			legacyProvider: string; complications: string; addComplication: string;
		};
		snapshot: { take: string; view: string; title: string };
		tagSuggestion: {
			title: string; accept: string; dismiss: string;
			relatedEntry: string; pickEntry: string;
		};
	};

	// ── Treatment categories ──────────────────────────────────────────
	categories: {
		endodontics: string; orthodontics: string; prosthodontics: string;
		periodontics: string; oral_surgery: string; restorative: string;
		preventive: string; imaging: string; other: string;
	};

	// ── Treatment outcomes ────────────────────────────────────────────
	outcomes: {
		successful: string; retreated: string; failed_extracted: string;
		failed_other: string; ongoing: string; unknown: string;
	};

	// ── Treatment plans ───────────────────────────────────────────────
	plans: {
		title: string; new: string; noPlans: string;
		addItem: string; totalCost: string; completedCost: string;
		linkEntry: string;
		status: { draft: string; active: string; completed: string; cancelled: string };
		fields: { name: string; description: string; cost: string; tooth: string };
	};

	// ── Dental chart ──────────────────────────────────────────────────
	chart: {
		title: string; open: string;
		startCharting: string; stopCharting: string;
		chartingProgress: string;
		takeSnapshot: string; editTags: string;
		bridgeTitle: string; prosthesisTitle: string;
		dissolve: string;
		abutment: string; pontic: string; implantAbutment: string;
		surfaces: { B: string; O: string; L: string; M: string; D: string };
		conditionHistory: string; noHistory: string;
		lastExamined: string; toothNotes: string;
		selectSurfaces: string; clearSurfaces: string;
		prosthesisTypes: {
			telescope: string; clasp: string; attachment: string; replaced: string;
		};
		bridgeRoles: { abutment: string; pontic: string };
		tags: {
			healthy:    { label: string; defaultShortcut: string };
			watch:      { label: string; defaultShortcut: string };
			decayed:    { label: string; defaultShortcut: string };
			filled:     { label: string; defaultShortcut: string };
			crowned:    { label: string; defaultShortcut: string };
			root_canal: { label: string; defaultShortcut: string };
			implant:    { label: string; defaultShortcut: string };
			bridge:     { label: string; defaultShortcut: string };
			missing:    { label: string; defaultShortcut: string };
			extracted:  { label: string; defaultShortcut: string };
			impacted:   { label: string; defaultShortcut: string };
			fractured:  { label: string; defaultShortcut: string };
			prosthesis: { label: string; defaultShortcut: string };
		};
		resetShortcuts: string; resetShortcutsConfirm: string;
		editTagsDialog: {
			title: string; tagName: string; color: string;
			stroke: string; pattern: string; shortcut: string;
			duplicateShortcut: string;
		};
	};

	// ── Periodontal probing ───────────────────────────────────────────
	perio: {
		title: string; open: string;
		startCharting: string; stopCharting: string;
		chartingProgress: string;
		examiner: string; loadPast: string; compare: string;
		compareOff: string; saveClose: string;
		buccal: string; lingual: string; palatal: string;
		pd: string; recession: string; cal: string; bop: string; plaque: string;
		mobility: string; furcation: string; furcationSites: string;
		clickToStart: string; noRecord: string;
		comparison: {
			title: string; improved: string; worsened: string;
			unchanged: string; noChanges: string;
		};
		summary: {
			sites: string; meanPd: string; pd4plus: string;
			pd6plus: string; bopPct: string; teeth: string;
		};
	};

	// ── Documents ─────────────────────────────────────────────────────
	documents: {
		title: string; add: string; noDocuments: string;
		category: string; openFile: string; deleteFile: string;
		deleteConfirm: string; uploadTitle: string;
	};

	// ── Dashboard ─────────────────────────────────────────────────────
	dashboard: {
		title: string;
		filters: { dateFrom: string; dateTo: string; doctor: string; allDoctors: string };
		stats: {
			totalPatients: string; activePatients: string;
			entriesThisMonth: string; successRate: string; activePlans: string;
		};
		categoryChart: string; outcomeTable: string; recentActivity: string;
		drillDown: string; noData: string;
		providerOutcomes: string;
	};

	// ── Reports ───────────────────────────────────────────────────────
	reports: {
		title: string; filters: string; exportCsv: string; noResults: string;
		columns: {
			date: string; patient: string; category: string; outcome: string;
			teeth: string; doctor: string; notes: string;
		};
	};

	// ── Settings ──────────────────────────────────────────────────────
	settings: {
		title: string; language: string; languageLabel: string;
		saved: string; resetToDefaults: string;
		sections: {
			general: string; vault: string; appearance: string;
			docCategories: string; clinicalTags: string; staffRoles: string;
			textBlocks: string; complicationTypes: string; about: string;
		};
		vault: { path: string; changePath: string; backup: string };
		theme: { label: string; light: string; dark: string; system: string };
		docCategories: {
			title: string; description: string; add: string;
			labelField: string; iconField: string;
			deleteConfirm: string;
		};
		clinicalTags: {
			acuteTitle: string; acuteDesc: string;
			medicalTitle: string; medicalDesc: string;
			addTag: string; deleteConfirm: string;
		};
		staffRoles: {
			title: string; description: string; add: string;
			roleLabel: string; prefix: string; deleteConfirm: string;
		};
		textBlocks: {
			title: string; description: string; add: string;
			triggerLabel: string; bodyLabel: string;
			resetToLangDefaults: string; resetConfirm: string;
			placeholderHint: string;
		};
		complicationTypes: {
			title: string; description: string; add: string; deleteConfirm: string;
		};
		about: { title: string; version: string; description: string };
	};

	// ── Staff / Doctors ───────────────────────────────────────────────
	staff: {
		title: string; add: string; edit: string; delete: string;
		fields: { name: string; role: string; email: string; phone: string };
		deleteConfirm: string; noStaff: string;
	};

	// ── Complications ─────────────────────────────────────────────────
	complications: {
		title: string; add: string; resolve: string; delete: string;
		noComplications: string; resolved: string;
		severity: { mild: string; moderate: string; severe: string };
		fields: { type: string; severity: string; description: string };
		types: {
			infection: string; dry_socket: string; nerve_damage: string;
			hemorrhage: string; allergic_reaction: string; pain_persistent: string;
			swelling: string; instrument_fracture: string; perforation: string;
			sinus_communication: string; restoration_failure: string;
			implant_failure: string; other: string;
		};
	};

	// ── Audit log ─────────────────────────────────────────────────────
	audit: {
		title: string; noRecords: string;
		actions: { update: string; delete: string };
		entityTypes: {
			timeline_entry: string; treatment_plan: string;
			treatment_plan_item: string; dental_chart: string;
			document: string; patient: string;
		};
		filters: { search: string; action: string; entity: string };
	};

	// ── Ortho classifications ─────────────────────────────────────────
	ortho: {
		title: string; pretreatment: string; posttreatment: string;
		angleClass: {
			class_I: string; class_II_div1: string;
			class_II_div2: string; class_III: string;
		};
		molarRelationship: string; overjet: string; overbite: string;
		crowding: { none: string; mild: string; moderate: string; severe: string };
		crossbite: { none: string; anterior: string; posterior_unilateral: string; posterior_bilateral: string };
		openBite: { none: string; anterior: string; posterior: string };
		midlineDeviation: string; treatmentType: string; extractionPattern: string;
	};

	// ── Patient sidebar tree ──────────────────────────────────────────────
	sidebar: {
		searchPlaceholder: string;
		newPatient: string;
		backToList: string;
		noResults: string; noPatients: string;
		results: string; patientsLabel: string;
		sections: {
			timeline: string; plans: string; chart: string;
			perio: string; documents: string;
			medical: string; acute: string; conditions: string;
		};
		lastExam: string; noExams: string;
		activePlans: string; noPlans: string;
		noEntries: string; noDocuments: string;
		noTags: string; activeConditions: string;
	};

	// ── Onboarding wizard ─────────────────────────────────────────────────
	onboarding: {
		step: string;             // e.g. "Step {n} of 3" — use with JS template
		welcomeTitle: string;
		welcomeSubtitle: string;
		getStarted: string;
		vaultTitle: string;
		vaultDesc: string;
		vaultChoose: string;
		vaultNone: string;
		vaultHint: string;
		vaultStructureLabel: string;
		teamTitle: string;
		teamDesc: string;
		teamNamePlaceholder: string;
		teamRoleLabel: string;
		teamAddMember: string;
		defaultsTitle: string;
		defaultsDesc: string;
		defaultsNote: string;
		textBlocksHint: string;
		defaultsSections: {
			docCategories: string;
			acuteTags: string;
			medicalTags: string;
			textBlocks: string;
			complicationTypes: string;
		};
		doneTitle: string;
		doneSubtitle: string;
		doneButton: string;
		back: string;
		continueBtn: string;
		skip: string;
		stepLabels: { vault: string; team: string; defaults: string; };
	};

	// ── User-configurable defaults ────────────────────────────────────
	defaults: {
		docCategories: Array<{ key: string; label: string; icon: string }>;
		staffRoles: Array<{ key: string; label: string; prefix: string }>;
		acuteTags: Array<{ key: string; label: string }>;
		medicalTags: Array<{ key: string; label: string }>;
		textBlocks: Array<{ key: string; label: string; body: string }>;
		complicationTypes: Array<{ key: string; label: string }>;
	};
}
