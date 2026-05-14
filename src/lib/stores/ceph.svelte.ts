import { createDefaultAngles, createDefaultDistances } from '$lib/ceph/defaults';
import { findLineIntersection, findPerpendicularIntersection } from '$lib/ceph/geometry';
import { defaultTemplates } from '$lib/ceph/templates';
import type { Angle, Distance, Line, Point, ReferenceScale, Template } from '$lib/ceph/types';
import type { OverlayVisibility } from '$lib/ceph/overlay-export';
import { REFERENCE_SCALE_CONSTANTS } from '$lib/ceph/constants';

export type CephMode = 'idle' | 'placing' | 'dragging';

// Points use id === name so geometry functions (which look up by p.id) work
// with name-based line.pointIds without any lookup changes.

function createCephStore() {
	// ─── Image ────────────────────────────────────────────────────────────
	let imagePath = $state<string | null>(null);
	let imageUrl = $state<string | null>(null);
	let imageWidth = $state(0);
	let imageHeight = $state(0);
	let imageBrightness = $state(100);
	let imageContrast = $state(100);

	// ─── Viewport ─────────────────────────────────────────────────────────
	let zoom = $state(1.0);
	let panX = $state(0);
	let panY = $state(0);

	// ─── Landmarks ────────────────────────────────────────────────────────
	let points = $state<Point[]>([]);

	// ─── Lines / Angles / Distances ───────────────────────────────────────
	let lines = $state<Line[]>([]);
	let angles = $state<Angle[]>(createDefaultAngles());
	let distances = $state<Distance[]>(createDefaultDistances());

	// ─── Reference scale ──────────────────────────────────────────────────
	let referenceScale = $state<ReferenceScale | null>(null);

	// ─── Active template ──────────────────────────────────────────────────
	let activeTemplate = $state<Template | null>(defaultTemplates[0]);

	// ─── UI state ─────────────────────────────────────────────────────────
	let mode = $state<CephMode>('idle');
	let selectedPointName = $state<string | null>(null);

	// ─── Overlays ─────────────────────────────────────────────────────────
	let overlayVisibility = $state<OverlayVisibility>({
		nasalFloor: false,
		cranialBase: false,
		mandible: false,
		upperIncisor: false,
		lowerIncisor: false
	});

	// ─── Clinical ─────────────────────────────────────────────────────────
	let clinicalNotes = $state('');
	let patientName = $state('');

	// ─── Undo history (stores deep copies of points array, max 10 deep) ───
	let undoStack = $state<Point[][]>([]);

	// ─── Measurement visibility ────────────────────────────────────────────
	let measurementVisibility = $state<Record<string, boolean>>({});

	// ─── Derived ──────────────────────────────────────────────────────────
	const hasImage = $derived(!!imageUrl);
	const placedPointNames = $derived(new Set(points.map((p) => p.name)));
	const templatePointDefs = $derived(activeTemplate?.points ?? []);

	// ─── Private helpers ───────────────────────────────────────────────────

	function pt(name: string): Point | undefined {
		return points.find((p) => p.id === name);
	}

	function upsertPoint(name: string, x: number, y: number, type: Point['type'] = 'standard') {
		const idx = points.findIndex((p) => p.id === name);
		if (idx >= 0) {
			// Deep-reactive mutation — OK per DentVault convention
			points[idx].x = x;
			points[idx].y = y;
		} else {
			points.push({ id: name, name, x, y, type, visible: true, imageId: imagePath ?? 'current' });
		}
	}

	function recalculateIntersections() {
		// Go = intersection of T1-Ar and T2-Me lines (ramus × mandibular base)
		if (pt('T1') && pt('Ar') && pt('T2') && pt('Me')) {
			const ramusLine: Line = { id: 'T1-Ar', name: 'T1-Ar Line', pointIds: ['T1', 'Ar'], visible: false };
			const mandLine: Line = { id: 'T2-Me', name: 'T2-Me Line', pointIds: ['T2', 'Me'], visible: false };
			const go = findLineIntersection(ramusLine, mandLine, points);
			if (go) upsertPoint('Go', go.x, go.y, 'intersection');
		}

		// OA = foot of perpendicular from A to occlusal plane (LM Cusp — UK IS1)
		if (pt('LM Cusp') && pt('UK IS1') && pt('A')) {
			const occLine: Line = { id: 'occ', name: 'Occlusal Plane', pointIds: ['LM Cusp', 'UK IS1'], visible: false };
			const oa = findPerpendicularIntersection(pt('A')!, occLine, points);
			if (oa) upsertPoint('OA', oa.x, oa.y, 'intersection');
		}

		// OB = foot of perpendicular from B to occlusal plane
		if (pt('LM Cusp') && pt('UK IS1') && pt('B')) {
			const occLine: Line = { id: 'occ', name: 'Occlusal Plane', pointIds: ['LM Cusp', 'UK IS1'], visible: false };
			const ob = findPerpendicularIntersection(pt('B')!, occLine, points);
			if (ob) upsertPoint('OB', ob.x, ob.y, 'intersection');
		}
	}

	function updateReferenceScale() {
		const ip1 = pt('IP1'), ip2 = pt('IP2');
		if (!ip1 || !ip2) return;
		const px = Math.sqrt((ip2.x - ip1.x) ** 2 + (ip2.y - ip1.y) ** 2);
		if (px > 0) {
			referenceScale = {
				pointIds: ['IP1', 'IP2'],
				realWorldDistance: REFERENCE_SCALE_CONSTANTS.REAL_WORLD_DISTANCE_MM,
				pixelDistance: px,
				scaleFactor: px / REFERENCE_SCALE_CONSTANTS.REAL_WORLD_DISTANCE_MM
			};
		}
	}

	function snapshotPoints(): Point[] {
		// Shallow-copy the array and plain-copy each point object for undo
		return points.map((p) => ({ ...p }));
	}

	// ─── Public actions ────────────────────────────────────────────────────

	function loadImage(path: string, url: string, width: number, height: number) {
		imagePath = path;
		imageUrl = url;
		imageWidth = width;
		imageHeight = height;
		zoom = 1.0;
		panX = 0;
		panY = 0;
	}

	function loadTemplate(template: Template) {
		// Convert template lines — use pointNames as pointIds (names == ids in this store)
		const newLines: Line[] = template.lines.map((l) => ({
			id: l.name,
			name: l.name,
			pointIds: l.pointNames as [string, string],
			visible: l.visible,
			color: l.color
		}));

		// Convert template angles
		const newAngles: Angle[] = template.angles.map((a, i) => ({
			id: `angle-${i}`,
			name: a.name,
			description: a.description,
			type: a.type,
			pointIds: a.pointNames,
			lineIds: a.lineNames,
			visible: a.visible,
			isCustom: false,
			standardValue: template.analysisStandards?.[a.name]?.value,
			standardDeviation: template.analysisStandards?.[a.name]?.deviation
		}));

		// Convert template distances (fall back to defaults if none defined)
		const newDistances: Distance[] = (template.distances ?? []).map((d, i) => ({
			id: `dist-${i}`,
			name: d.name,
			description: d.description,
			type: d.type as Distance['type'],
			pointIds: d.pointNames,
			pointId: d.pointName,
			lineId: d.lineName,
			visible: d.visible ?? true,
			isCustom: false,
			standardValue: template.analysisStandards?.[d.name]?.value,
			standardDeviation: template.analysisStandards?.[d.name]?.deviation
		}));

		lines = newLines;
		angles = newAngles;
		distances = newDistances.length > 0 ? newDistances : createDefaultDistances();
		activeTemplate = template;
	}

	function placePoint(name: string, x: number, y: number) {
		undoStack = [...undoStack.slice(-9), snapshotPoints()];

		const pointDef = templatePointDefs.find((p) => p.name === name);
		upsertPoint(name, x, y, pointDef?.type ?? 'standard');

		updateReferenceScale();
		recalculateIntersections();
	}

	function movePoint(name: string, x: number, y: number) {
		const idx = points.findIndex((p) => p.id === name);
		if (idx < 0) return;
		points[idx].x = x;
		points[idx].y = y;
		updateReferenceScale();
		recalculateIntersections();
	}

	function deletePoint(name: string) {
		undoStack = [...undoStack.slice(-9), snapshotPoints()];
		points = points.filter((p) => p.id !== name);
		recalculateIntersections();
	}

	function undoLastPoint() {
		if (undoStack.length === 0) return;
		points = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
	}

	function setScale(scale: ReferenceScale | null) {
		referenceScale = scale;
	}

	function setZoom(z: number) {
		zoom = Math.max(0.1, Math.min(5.0, z));
	}

	function setPan(x: number, y: number) {
		panX = x;
		panY = y;
	}

	function setBrightness(v: number) {
		imageBrightness = Math.max(0, Math.min(200, v));
	}

	function setContrast(v: number) {
		imageContrast = Math.max(0, Math.min(200, v));
	}

	function toggleOverlay(key: keyof OverlayVisibility) {
		overlayVisibility[key] = !overlayVisibility[key];
	}

	function setMode(m: CephMode) {
		mode = m;
	}

	function selectPointName(name: string | null) {
		selectedPointName = name;
	}

	function setClinicalNotes(s: string) {
		clinicalNotes = s;
	}

	function setPatientName(s: string) {
		patientName = s;
	}

	function setMeasurementVisibility(v: Record<string, boolean>) {
		measurementVisibility = v;
	}

	/** Restore a full analysis state (e.g. when loading a saved .ceph file) */
	function restore(data: {
		points: Point[];
		lines: Line[];
		angles: Angle[];
		distances: Distance[];
		referenceScale?: ReferenceScale | null;
		clinicalNotes?: string;
		patientName?: string;
		overlayVisibility?: OverlayVisibility;
	}) {
		points = data.points;
		lines = data.lines;
		angles = data.angles;
		distances = data.distances;
		referenceScale = data.referenceScale ?? null;
		clinicalNotes = data.clinicalNotes ?? '';
		patientName = data.patientName ?? '';
		if (data.overlayVisibility) overlayVisibility = data.overlayVisibility;
		undoStack = [];
	}

	/** Clear all patient-specific state (keep template/config) */
	function reset() {
		imagePath = null;
		imageUrl = null;
		imageWidth = 0;
		imageHeight = 0;
		imageBrightness = 100;
		imageContrast = 100;
		zoom = 1.0;
		panX = 0;
		panY = 0;
		points = [];
		referenceScale = null;
		clinicalNotes = '';
		patientName = '';
		undoStack = [];
		mode = 'idle';
		selectedPointName = null;
		overlayVisibility = {
			nasalFloor: false,
			cranialBase: false,
			mandible: false,
			upperIncisor: false,
			lowerIncisor: false
		};
	}

	return {
		// ─── Getters ──────────────────────────────────────────────────────
		get imagePath() { return imagePath; },
		get imageUrl() { return imageUrl; },
		get imageWidth() { return imageWidth; },
		get imageHeight() { return imageHeight; },
		get imageBrightness() { return imageBrightness; },
		get imageContrast() { return imageContrast; },
		get zoom() { return zoom; },
		get panX() { return panX; },
		get panY() { return panY; },
		get points() { return points; },
		get lines() { return lines; },
		get angles() { return angles; },
		get distances() { return distances; },
		get referenceScale() { return referenceScale; },
		get activeTemplate() { return activeTemplate; },
		get mode() { return mode; },
		get selectedPointName() { return selectedPointName; },
		get overlayVisibility() { return overlayVisibility; },
		get clinicalNotes() { return clinicalNotes; },
		get patientName() { return patientName; },
		get undoStack() { return undoStack; },
		get measurementVisibility() { return measurementVisibility; },
		// ─── Derived ──────────────────────────────────────────────────────
		get hasImage() { return hasImage; },
		get placedPointNames() { return placedPointNames; },
		get templatePointDefs() { return templatePointDefs; },
		// ─── Helpers ──────────────────────────────────────────────────────
		getPointByName: pt,
		// ─── Actions ──────────────────────────────────────────────────────
		loadImage,
		loadTemplate,
		placePoint,
		movePoint,
		deletePoint,
		undoLastPoint,
		setScale,
		setZoom,
		setPan,
		setBrightness,
		setContrast,
		toggleOverlay,
		setMode,
		selectPointName,
		setClinicalNotes,
		setPatientName,
		setMeasurementVisibility,
		restore,
		reset
	};
}

export const ceph = createCephStore();
