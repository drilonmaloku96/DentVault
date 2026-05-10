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
		deselect: string;
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
		schedule: string;
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
			city: string; postalCode: string; country: string;
			referralSource: string; smokingStatus: string; occupation: string;
			allergies: string; bloodGroup: string;
			recall: string;
			emergencyContactName: string; emergencyContactPhone: string; emergencyContactRelation: string;
			primaryPhysician: string; maritalStatus: string;
		};
		tabs: {
			timeline: string; plans: string; chart: string;
			perio: string; documents: string; par: string;
		};
		maritalStatus: { single: string; married: string; divorced: string; widowed: string; partnered: string; };
		medicalHistory: string; acuteProblems: string; conditions: string;
		acuteProblemPlaceholder: string;
		medicalHistoryPlaceholder: string;
		editPatient: string; deletePatient: string;
		deleteConfirm: string; deleteWarning: string;
		formSections: {
			personal: string; contact: string; address: string;
			emergencyContact: string; insurance: string; clinical: string; demographics: string;
		};
	};

	// ── Timeline ──────────────────────────────────────────────────────
	timeline: {
		title: string; addEntry: string; noEntries: string;
		filter: string; filterAll: string; loading: string;
		filterCategories: { files: string; documentation: string; charts: string };
		entry: {
			category: string; outcome: string; toothNumbers: string;
			doctor: string; colleagues: string; relatedEntry: string;
			addImage: string; viewImage: string; openExternal: string;
			legacyProvider: string; complications: string; addComplication: string;
			type: string; typePlaceholder: string; typeSynced: string;
			notesPlaceholder: string;
		};
		snapshot: { take: string; view: string; title: string };
		tagSuggestion: {
			title: string; accept: string; dismiss: string;
			relatedEntry: string; pickEntry: string;
		};
		searchPlaceholder: string;
		bar: {
			typeSelect: string;
			staffButton: string;
			staffSearch: string;
			noResults: string;
			detectedTeeth: string;
			titlePlaceholder: string;
			titleAriaLabel: string;
			bodyPlaceholder: string;
			saveButton: string;
			saveTitle: string;
			hintLine: string;
			errorEmpty: string;
			errorSave: string;
			entryFallback: string;
			formatting: { red: string; blue: string; green: string; remove: string; };
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
		openPlan: string;
		activePlan: string;
		noPlan: string;
		createFirst: string;
		selectTooth: string;
		clearProcedure: string;
		manualItem: string;
		status: { draft: string; active: string; completed: string; cancelled: string; edited: string };
		fields: { name: string; description: string; cost: string; tooth: string };
		procedures: {
			plan_extract: string;
			plan_fill: string;
			plan_crown: string;
			plan_rct: string;
			plan_bridge: string;
			plan_implant: string;
			plan_veneer: string;
			plan_watch: string;
			plan_partial_denture: string;
			plan_full_denture: string;
		};
		deletePlan: string;
		confirmDeleteShort: string;
		archive: string;
		noSteps: string;
		stepSingular: string;
		stepPlural: string;
		currentFindings: string;
		planningLabel: string;
		planBridgeProsthesis: string;
		chartHintText: string;
		toothStepsHeader: string;
		prosthetics: string;
		manual: string;
		stepPlaceholder: string;
		noStepPlanned: string;
		addStepLabel: string;
		toothNotesPlaceholder: string;
		planTooth: string;
		editStructure: string;
		countZero: string;
		countSingular: string;
		countPlural: string;
		dragTeethCount: string;
		teethLabel: string;
		bridgeLabel: string;
		prosthesisLabel: string;
		abutmentLabel: string;
		applyToAll: string;
		applyToTooth: string;
		selectToothThenKey: string;
		restorationPlanHeader: string;
		addManualStepButton: string;
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
		addNote: string;
		editNote: string;
		deleteNote: string;
		deleteNoteConfirm: string;
		reminderDate: string;
		reminderDue: string;
		noNotes: string;
		saveNote: string;
		cancelNote: string;
		selectSurfaces: string; clearSurfaces: string;
		wholeToothOnly: string;
		applyingTo: string; wholeTooth: string; resetToHealthy: string;
		rootCanal: {
			statusNone: string;
			filled: string;
			insufficient: string;
			dressing: string;
			apexFocus: string;
			postLabel: string;
			noPost: string;
			canalNames: { MB: string; DB: string; P: string; M: string; D: string; B: string; single: string };
		};
		endo: {
			title: string;
			openButton: string;
			newSession: string;
			history: string;
			noHistory: string;
			canal: string;
			instrument: string;
			isoSize: string;
			lengthXray: string;
			lengthPrep: string;
			lengthElectronic: string;
			referencePoint: string;
			definitiveLength: string;
			addCanal: string;
			deleteSession: string;
			deleteConfirm: string;
			saveSession: string;
			sessionOf: string;
			toothFallback: string;
			findingsPlaceholder: string;
		};
		filling: {
			material: string;
			origin: string;
			own: string;
			foreign: string;
			insufficient: string;
			inlay: string;
			inlayPlanned: string;
			noMaterial: string;
		};
		prosthesisTypes: {
			telescope: string; replaced: string;
		};
		bridgeRoles: { abutment: string; pontic: string; connector: string };
		primaryTeeth: string;
		showPrimaryTeeth: string;
		hidePrimaryTeeth: string;
		legend: string;
		legendHint: string;
		multiSelect: {
			teeth: string;
			clear: string;
		};

		archSetup: {
			title: string;
			editArch: string;
			instruction: string;
			dentitionTypes: { permanent: string; mixed: string; primary: string };
			selectAll: string;
			deselectAll: string;
			teethPresent: string;
			present: string;
			absent: string;
			confirm: string;
		};
		tagGroups: {
			general: string;
			restorative: string;
			endodontic: string;
			fixedProsthetics: string;
			absent: string;
			primary: string;
			custom: string;
			bridgeTagNote: string;
			prosthesisTagNote: string;
		};
		tags: {
			healthy:            { label: string; defaultShortcut: string };
			watch:              { label: string; defaultShortcut: string };
			decayed:            { label: string; defaultShortcut: string };
			filled:             { label: string; defaultShortcut: string };
			crowned:            { label: string; defaultShortcut: string };
			root_canal:         { label: string; defaultShortcut: string };
			implant:            { label: string; defaultShortcut: string };
			bridge:             { label: string; defaultShortcut: string };
			missing:            { label: string; defaultShortcut: string };
			extracted:          { label: string; defaultShortcut: string };
			impacted:           { label: string; defaultShortcut: string };
			fractured:          { label: string; defaultShortcut: string };
			prosthesis:         { label: string; defaultShortcut: string };
			erupting:           { label: string; defaultShortcut: string };
			persistent_primary: { label: string; defaultShortcut: string };
			inlay:                { label: string; defaultShortcut: string };
			inlay_planned:        { label: string; defaultShortcut: string };
			decayed_radiographic: { label: string; defaultShortcut: string };
			mih:                  { label: string; defaultShortcut: string };
		};
		mih: {
			grade: string;
			grades: { 1: string; 2: string; 3: string; 4: string };
		};
		dmft: string;
		dmftDecayed: string;
		dmftMissing: string;
		dmftFilled: string;
		position: {
			title: string;
			migration: string;
			tipping: string;
			rotation: string;
			foreignWork: string;
			directions: {
				none: string;
				mesial: string; distal: string;
				buccal: string; lingual: string;
				superior: string; inferior: string;
				clockwise: string; counterclockwise: string;
			};
		};
		shade: {
			title: string;
			guide: string;
			noShade: string;
			clear: string;
		};
		snapshotReport: { allHealthy: string; showMore: string; showLess: string; readOnly: string; reportTitle: string };
		resetShortcuts: string; resetShortcutsConfirm: string;
		prevTooth: string;
		prevToothHint: string;
		planningMode: string;
		sameMandible: string;
		firstSelectTooth: string;
		planningAriaLabel: string;
		restoration: {
			edit: string;
			newLabel: string;
			editDialog: string;
			createDialog: string;
			bridgeTab: string;
			prosthesisTab: string;
			bridgeClickHint: string;
			bridgeHint: string;
			prosthesisClickHint: string;
			abutmentToggle: string;
			implantShort: string;
			toothShort: string;
			telescopeLegend: string;
			bracketLegend: string;
			attachmentLegend: string;
			replacedLegend: string;
			createBridge: string;
			createProsthesis: string;
			bridgeDescription: string;
			prosthesisDescription: string;
			toothRole: string;
			implantRole: string;
			ponticRole: string;
		};
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
		svgTeethLabel: string;
		legendTtTrend: string;
		legendGumMargin: string;
		legendRecession: string;
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
			patientsServed: string; newPatients: string; treatments: string;
		};
		period: { week: string; month: string; year: string; custom: string };
		periodLabel: string;
		customRange: { from: string; to: string; apply: string };
		categoryChart: string; outcomeTable: string; recentActivity: string;
		drillDown: string; noData: string;
		heatmapDayAbbrevs: string[];
		typeColumn: string;
		basedOnPatients: string;
		providerOutcomes: string;
		doctorActivity: string;
		appointments: {
			title: string;
			booked: string;
			completed: string;
			cancelled: string;
			noShow: string;
			cancellationRate: string;
			noShowRate: string;
			avgDuration: string;
			heatmap: string;
			byDay: string;
			minutes: string;
			noSlotData: string;
		};
		demographics: {
			title: string;
			avgAge: string;
			ageDistribution: string;
			gender: string;
			referralSource: string;
			years: string;
		};
		visits: {
			todayTitle: string;
			weekTitle: string;
			patients: string;
		};
		staff: {
			title: string;
			overview: string;
			year: string;
			doctor: string;
			allDoctors: string;
			absences: string;
			absenceSummary: string;
			noAbsences: string;
			totalDays: string;
			appointmentStats: string;
			noAppointments: string;
			completionRate: string;
			avgDuration: string;
			dateRange: string;
			reasons: {
				vacation: string;
				sick: string;
				conference: string;
				training: string;
				other: string;
			};
			workingHours: string;
			workingHoursDesc: string;
		};
	};

	// ── Reports ───────────────────────────────────────────────────────
	reports: {
		title: string; filters: string; exportCsv: string; exportJson: string; noResults: string;
		quickFilterLabel: string;
		quickThisWeek: string; quickThisMonth: string; quickThisYear: string;
		columns: {
			date: string; patient: string; category: string; outcome: string;
			teeth: string; doctor: string; notes: string;
		};
	};

	// ── Appointment Scheduling ────────────────────────────────────────
	schedule: {
		title: string;
		today: string;
		bookAppointment: string;
		editAppointment: string;
		room: string;
		type: string;
		patient: string;
		doctor: string;
		duration: string;
		durationMin: string;
		startTime: string;
		endTime: string;
		notes: string;
		titleLabel: string;
		status: string;
		statuses: {
			scheduled: string;
			completed: string;
			cancelled: string;
			no_show: string;
		};
		noRoomsConfigured: string;
		goToSettings: string;
		patientContext: string;
		clearPatient: string;
		deleteAppointment: string;
		confirmDelete: string;
		selectPatient: string;
		searchPatients: string;
		optional: string;
		nextAppointment: string;
		upcomingAppointments: string;
		previousAppointments: string;
		noUpcoming: string;
		noPrevious: string;
		bookNew: string;
		blocks: {
			title: string;
			editBlock: string;
			blockTitle: string;
			delete: string;
			confirmDelete: string;
		};
		staffBlockouts: {
			title: string;
			absent: string;
			addBlockout: string;
			editBlockout: string;
			deleteBlockout: string;
			confirmDelete: string;
			allDay: string;
			dateRange: string;
			timeRange: string;
			reasons: {
				vacation: string;
				sick: string;
				conference: string;
				training: string;
				other: string;
			};
			noBlockouts: string;
		};
		dragCreate: {
			blockTime: string;
			bookAppointment: string;
		};
		presence: {
			toggle: string;
			allPresent: string;
			presentAt: string;
			nonePresent: string;
		};
		printDay: string;
	};

	// ── Settings ──────────────────────────────────────────────────────
	settings: {
		title: string; language: string; languageLabel: string;
		saved: string; resetToDefaults: string;
		uiScaleLabel: string;
		uiScaleOptions: { '0.8': string; '0.9': string; '1': string; '1.1': string; '1.25': string; '1.5': string };
		homeTitle: string;
		homeSubtitle: string;
		sections: {
			overview: string;
			general: string; vault: string; appearance: string;
			docCategories: string; clinicalTags: string; staffRoles: string;
			textBlocks: string; complicationTypes: string; entryTypes: string; backup: string; about: string;
			textHighlightColors: string;
			rooms: string; appointmentTypes: string; workingHours: string;
			patientManagement: string;
			schedule: string; clinical: string; documents: string;
			dentalTagsAndSymbols: string; prostheticsAndBridges: string;
			staffAndHours: string; roles: string;
			documentTemplates: string; patientExport: string;
		};
		patientManagement: {
			title: string;
			description: string;
			search: string;
			selectAll: string;
			deselectAll: string;
			deleteSelected: string;
			confirmDelete: string;
			noPatients: string;
			noResults: string;
			deleted: string;
		};
		vault: { path: string; changePath: string; backup: string };
		theme: { label: string; light: string; dark: string; system: string };
		docCategories: {
			title: string; description: string; add: string;
			labelField: string; iconField: string;
			deleteConfirm: string;
			templateInfoBox: string;
			subfolderCol: string;
			templateFilesCol: string;
			templateFrameHint: string;
			addCategoryFolderHint: string;
			categoryRenameHint: string;
			reusableTemplates: string;
			docTemplatesDescription: string;
			noTemplates: string;
			openInFinder: string;
			openFile: string;
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
			labelPlaceholder: string;
			bodyPlaceholder: string;
		};
		complicationTypes: {
			title: string; description: string; add: string; deleteConfirm: string;
		};
		entryTypes: {
			title: string; description: string; add: string; labelPlaceholder: string; iconPlaceholder: string; deleteConfirm: string;
		};
		backup: {
			title: string; description: string;
			exportSettings: string; exportSettingsDesc: string;
			importSettings: string; importSettingsDesc: string;
			backupDatabase: string; backupDatabaseDesc: string;
			backupVault: string; backupVaultDesc: string;
			importWarning: string; importConfirm: string;
			importSuccess: string; importError: string;
			backupSuccess: string; backupError: string;
		};
		about: { title: string; version: string; description: string };
		fillingMaterials: {
			title: string;
			description: string;
			add: string;
			deleteConfirm: string;
			colorLabel: string;
			labelPlaceholder: string;
		};
		endoInstruments: {
			title: string;
			description: string;
			add: string;
			deleteConfirm: string;
			labelPlaceholder: string;
		};
		shadeGuides: {
			title: string;
			description: string;
			guideName: string;
			shadesPlaceholder: string;
			add: string;
		};
		textHighlightColors: {
			title: string;
			description: string;
			add: string;
			labelPlaceholder: string;
			maxReached: string;
			preview: string;
			empty: string;
		};
		postTypes: {
			title: string;
			description: string;
			add: string;
			deleteConfirm: string;
			labelPlaceholder: string;
		};
		planProcedures: {
			title: string;
			description: string;
			add: string;
			labelPlaceholder: string;
			abbrPlaceholder: string;
			shortcutPlaceholder: string;
			colorLabel: string;
			defaultBadge: string;
			labelHeader: string;
			abbrHeader: string;
			keyHeader: string;
		};
		prosthesisTypeSettings: {
			title: string;
			description: string;
			badge: string;
			color: string;
			fillColor: string;
			fillPattern: string;
			saved: string;
		};
		bridgeRoleSettings: {
			title: string;
			description: string;
			badge: string;
			color: string;
			fillColor: string;
			fillPattern: string;
			saved: string;
			connectorBar: string;
		};
		chart: {
			dmftForAdults: string;
			dmftTitle: string;
			dmftDesc: string;
			dmftToggleDesc: string;
		};
		schedule: {
			workingHoursDesc: string;
			roomsDesc: string;
			break: string;
			closed: string;
			colorLabel: string;
			abbrPlaceholder: string;
			abbrShortPlaceholder: string;
			durationPlaceholder: string;
			active: string;
			inactive: string;
			deactivate: string;
			activate: string;
		};
	};

	// ── Staff / Doctors ───────────────────────────────────────────────
	staff: {
		title: string; add: string; edit: string; delete: string;
		fields: { name: string; role: string; email: string; phone: string };
		deleteConfirm: string; noStaff: string;
		workingHours: string;
		editWorkingHours: string;
		saveWorkingHours: string;
		noWorkingHours: string;
		colStart: string; colBreakStart: string; colBreakEnd: string; colEnd: string; colActive: string;
		paletteHint: string;
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

	// ── Ortho / KIG classifications ───────────────────────────────────
	ortho: {
		// Used by PatientClassifications.svelte (legacy form — keep these unchanged)
		title: string; pretreatment: string; posttreatment: string;
		angleClass: { class_I: string; class_II_div1: string; class_II_div2: string; class_III: string };
		molarRelationship: string; overjet: string; overbite: string;
		crowding: { none: string; mild: string; moderate: string; severe: string };
		crossbite: { none: string; anterior: string; posterior_unilateral: string; posterior_bilateral: string };
		openBite: { none: string; anterior: string; posterior: string };
		midlineDeviation: string; treatmentType: string; extractionPattern: string;

		// Assessment dialog — shared
		button: string;
		newAssessment: string; saveAssessment: string;
		examDate: string; doctor: string;
		noFindings: string; deleteAssessment: string; deleteConfirm: string;
		mmLabel: string;

		// IOTN — Dental Health Component
		dhcTitle: string;
		dhcNeedLevel: { '1': string; '2': string; '3': string; '4': string; '5': string };
		dhcSubcategories: {
			'2a': string; '2b': string; '2c': string; '2d': string; '2e': string; '2f': string; '2g': string; '2h': string; '2i': string;
			'3a': string; '3b': string; '3c': string; '3d': string; '3e': string; '3f': string;
			'4a': string; '4b': string; '4c': string; '4d': string; '4e': string; '4f': string;
			'4h': string; '4i': string; '4j': string; '4k': string; '4l': string; '4m': string;
			'5a': string; '5h': string; '5i': string; '5m': string; '5p': string; '5s': string;
		};
		// IOTN — Aesthetic Component
		acTitle: string;
		acGradeDesc: { '1': string; '2': string; '3': string; '4': string; '5': string; '6': string; '7': string; '8': string; '9': string; '10': string };
		// IOTN score label
		iotnScore: string;

		// Clinical context
		angleClassLabel: string;
		dentitionStage: string;
		dentitionOptions: { primary: string; mixed: string; permanent: string };
		treatmentPhase: string;
		treatmentPhaseOptions: { expectative: string; early: string; main: string; adult: string };
		cvmStage: string;
		facialProfile: string;
		facialProfileOptions: { straight: string; convex: string; concave: string };
		treatmentRecommendation: string;

		// Bad habits
		badHabitsLabel: string;
		badHabitOptions: {
			thumbSucking: string; tongueThrusting: string; mouthBreathing: string;
			lipBiting: string; nailBiting: string; bruxism: string;
			pacifierUse: string; penChewing: string;
		};

		// Bite section
		bissTitle: string;
		bissRight: string; bissLeft: string;
		bissTypes: { neutral: string; distal: string; mesial: string };
		praemolarenbreite: string; praemolarenbreiteShort: string;

		// IOTN group section headers
		iotnGroupM: string;
		iotnGroupOSagittal: string;
		iotnGroupC: string;
		iotnGroupD: string;
		iotnGroupOVertical: string;
		iotnGroupOther: string;

		// IOTN dialog labels
		iotnNone: string;
		iotnOneTooth: string;
		iotnTwoOrMore: string;
		iotnPerQuadrant: string;
		iotnRetainedTeeth: string;
		iotnRetainedHint: string;
		iotnNotScoredM: string;
		iotnHypodontia: string;
		iotnPositiveOverjet: string;
		iotnCompetentLips: string;
		iotnIncompetentLips: string;
		iotnEvalGreatestPositive: string;
		iotnReverseOverjet: string;
		iotnNoMasticatoryDiff: string;
		iotnWithDifficulties: string;
		iotnEvalGreatestNegative: string;
		iotnCrossbiteLabel: string;
		iotnMmDiscrepancy: string;
		iotnContactDisplacement: string;
		iotnMmContactToContact: string;
		iotnNotScoredD: string;
		iotnDeepOverbite: string;
		iotnOverbiteNoGingival: string;
		iotnOverbiteGingival: string;
		iotnOverbiteTrauma: string;
		iotnOpenBite: string;
		iotnMmVerticalDistance: string;
		iotnEvalGreatestVertical: string;
		iotnBm4mDesc: string;
		iotnMmContactUnit: string;
		iotnMmVertUnit: string;
		iotnCondG: string;
		iotnCondL: string;
		iotnCondP: string;
		iotnCondS: string;
		iotnCondT: string;
		iotnCondX: string;

		// Viewing
		viewAssessment: string; readOnly: string;
		historyDropdownLabel: string; newAssessmentOption: string;

		// Legacy KIG display (old snapshots — do not use in new UI)
		insuranceCovered: string; notCovered: string; leadingGroup: string;
		groups: { A: string; U: string; S: string; D: string; M: string; O: string; T: string; B: string; K: string; E: string; P: string };
		grades: {
			A5: string; U4: string; S4: string; S5: string;
			D1: string; D2: string; D4: string; D5: string;
			M4: string; M5: string;
			O1: string; O2: string; O3: string; O4: string; O5: string;
			T1: string; T2: string; T3: string;
			B4: string; K2: string; K3: string; K4: string;
			E1: string; E2: string; E3: string; E4: string;
			P2: string; P3: string; P4: string;
		};
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
		timelineTitle: string;
		openInFinder: string;
		dragHint: string;
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
		scaleLabel: string;
		clinicTitle: string;
		clinicDesc: string;
		clinicChairsLabel: string;
		clinicChairsHint: string;
		defaultRoomName: string;
		doneTitle: string;
		doneSubtitle: string;
		doneButton: string;
		back: string;
		continueBtn: string;
		skip: string;
		stepLabels: { vault: string; team: string; clinic: string; defaults: string; };
	};

	// ── Patient Export ────────────────────────────────────────────────
	export: {
		title: string;
		description: string;
		dateRange: string;
		dateFrom: string;
		dateTo: string;
		allTime: string;
		sectionsLabel: string;
		sections: {
			demographics: string;
			medical: string;
			notes: string;
			chart: string;
			timeline: string;
			perio: string;
			plans: string;
			documents: string;
		};
		chooseFolder: string;
		progress: {
			collecting: string;
			rendering: string;
			building: string;
			copying: string;
			writing: string;
			done: string;
		};
		openFolder: string;
		error: string;
		success: string;
		coverTitle: string;
		generatedBy: string;
		documentIndex: string;
		selectPatient: string;
		searchPatients: string;
		noPatientSelected: string;
	};

	docTemplates: {
		folder: string;       // '!Documents' display name
		button: string;       // timeline toolbar button label
		dialogTitle: string;
		noFiles: string;
		uploadHint: string;
		addFile: string;
		deleteFile: string;
		pickAndAdd: string;
		category: string;
		addToPatient: string;
		adding: string;
		deleteConfirm: string;
	};

	// ── User-configurable defaults ────────────────────────────────────
	defaults: {
		docCategories: Array<{ key: string; label: string; icon: string; folder: string }>;
		staffRoles: Array<{ key: string; label: string; prefix: string }>;
		acuteTags: Array<{ key: string; label: string }>;
		medicalTags: Array<{ key: string; label: string }>;
		textBlocks: Array<{ key: string; label: string; body: string }>;
		complicationTypes: Array<{ key: string; label: string }>;
		fillingMaterials: Array<{ key: string; label: string; color: string }>;
		endoInstruments: Array<{ key: string; label: string }>;
		workingDays: string[];
		dayAbbrevs: string[];
	};

	// ── PAR (Parodontitis-Therapie) ──────────────────────────────────────────
	par: {
		title: string;
		tab: string;
		newCase: string;
		noCase: string;
		noCaseHint: string;
		planType: { kasse: string; privat: string };
		status: { active: string; completed: string; ended: string };
		grade: string;
		gradeLabel: { A: string; B: string; C: string };
		gradeUpt: { A: string; B: string; C: string };
		sgb22: string;
		treatmentEnd: string;
		setTreatmentEnd: string;
		transferCase: string;
		transferFrom: string;
		transferStep: string;
		transferUptPhase: string;
		primaryDoctor: string;
		stepTypes: {
			AIT: string; BEVa: string; CPT: string; BEVb: string;
			UPTd: string; UPTg: string; UPTc: string; KTB: string;
		};
		stepTypeShort: {
			AIT: string; BEVa: string; CPT: string; BEVb: string;
			UPTd: string; UPTg: string; UPTc: string; KTB: string;
		};
		stepStatus: { pending: string; active: string; done: string; locked: string };
		newStep: string;
		newStepHint: string;
		noValidNextStep: string;
		examDate: string;
		startDate: string;
		endDate: string;
		approvalDate: string;
		referral: string;
		referralLabel: string;
		sequence: string;
		deleteCase: string;
		deleteCaseConfirm: string;
		deleteStep: string;
		deleteStepConfirm: string;
		endCaseTitle: string;
		endCaseDesc: string;
		endCaseConfirm: string;
		caseEnded: string;
		caseLocked: string;
		newCaseDialog: {
			title: string;
			planTypeLabel: string;
			doctorLabel: string;
			gradeHint: string;
			transferHint: string;
		};
		newStepDialog: {
			title: string;
			typeLabel: string;
			dateLabel: string;
			doctorLabel: string;
			sequenceLabel: string;
			validNextSteps: string;
		};
		grid: {
			hintNumbers: string;
			hintTabEnter: string;
			hintRightClick: string;
		};
	};
}
