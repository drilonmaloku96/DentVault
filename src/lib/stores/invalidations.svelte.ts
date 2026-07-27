/**
 * Entity-keyed invalidation bus (ROADMAP_MULTI_COMPUTER.md Phase 0, §3.4).
 *
 * Solo mode feeds this from per-component timers at today's cadence — a pure refactor of
 * the existing polling loops, not a behavior change. Connected mode (Phase 1) will feed it
 * from a WebSocket handler instead; the subscribe side (and every component using it) does
 * not change — that's the point of routing both through one abstraction now.
 *
 * No event payloads carry data — invalidation only. Listeners refetch through the normal
 * DB/RPC path, so there is exactly one code path for reading data.
 */

export type InvalidationKey =
	| { entity: 'timeline'; patientId: string }
	| { entity: 'files'; patientFolder: string }
	| { entity: 'appointments'; date: string }
	| { entity: 'settings'; key: string };

type Listener = () => void;

function keyString(k: InvalidationKey): string {
	switch (k.entity) {
		case 'timeline': return `timeline:${k.patientId}`;
		case 'files': return `files:${k.patientFolder}`;
		case 'appointments': return `appointments:${k.date}`;
		case 'settings': return `settings:${k.key}`;
	}
}

const listeners = new Map<string, Set<Listener>>();

export const invalidations = {
	/** Register `listener` to run whenever `key` is invalidated. Returns an unsubscribe fn. */
	subscribe(key: InvalidationKey, listener: Listener): () => void {
		const k = keyString(key);
		let set = listeners.get(k);
		if (!set) {
			set = new Set();
			listeners.set(k, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
			if (set.size === 0) listeners.delete(k);
		};
	},

	/** Notify every listener registered for `key`. */
	emit(key: InvalidationKey): void {
		listeners.get(keyString(key))?.forEach(fn => fn());
	},

	/**
	 * Notify every listener for every key under `entity`, regardless of the specific
	 * patientId/date/etc. Connected mode's server push is entity-level only (Phase 1's
	 * coarse table→entity mapping in dentvault-server has no way to know which specific
	 * patient/date a write touched without a real SQL parser) — so a connected-mode client
	 * can't target the exact key the way the solo-mode timer feed does. Refetching every
	 * open listener for that entity is the safe fallback; finer server-side keys are a
	 * later refinement (Shape 2 / Phase 2), not a correctness requirement now.
	 */
	emitEntity(entity: InvalidationKey['entity']): void {
		const prefix = `${entity}:`;
		for (const [k, set] of listeners) {
			if (k.startsWith(prefix)) set.forEach(fn => fn());
		}
	},
};
