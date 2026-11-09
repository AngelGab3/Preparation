/* Coste de ruta ponderado por salud. Uso:
 *   const route = computeHealthOptimalRoute(dem, start, goal, group, mode);
 * mode: 'oxygen' | 'health' | 'balanced'
 * 'oxygen' = comportamiento legacy (sin salud) → devuelve null y el caller usa A* original.
 */

import { advanceGroupState, aggregateGroupState } from './health_group.js';

export function computeHealthCostFactor(segment, group, weights, mode) {
    if (mode === 'oxygen') return 1.0; // legacy

    /* Simular el segmento sobre una copia del grupo */
    const simulated = advanceGroupState(group, segment);
    const agg = aggregateGroupState(simulated);
    const maxSafe = group.cfg.max_safe_slope_deg || 25;

    /* Factores por dimensión (0..1+, >1 = peor) */
    const fSlope = segment.slope_deg ? Math.min(3, segment.slope_deg / maxSafe) : 0;
    const fMet = Math.min(3, agg.max_metabolic_fraction ?? agg.max_metabolic_w / group.cfg.max_sustainable_m_w);
    const fHR = Math.min(3, agg.max_hr_fraction ?? agg.max_hr_bpm / group.cfg.hr_max_bpm);
    const fO2 = Math.max(0, 1 - agg.min_o2_remaining_l / group.cfg.o2_capacity_l_equiv);
    const fTh = Math.min(3, Math.max(0, (agg.max_t_core_c - 37) / 2));
    const fHyd = Math.min(3, agg.max_dehydration_pct / (group.cfg.dehydration_critical_pct_body_mass || 4.0));

    /* Radiación GCR ∝ tiempo; contingencia sin modelo → 0 */
    const fRad = (group.cfg.surface_dose_rate_usv_h ?? 27.9) / 27.9, fCont = 0;

    const w = weights;
    const weighted =
        (w.slope ? w.slope * fSlope : 0) +
        w.oxygen * fO2 +
        w.metabolic * fMet +
        w.heart_rate * fHR +
        w.thermal * fTh +
        w.hydration * fHyd +
        w.radiation * fRad +
        w.contingency * fCont;

    if (mode === 'balanced') return 1.0 + 0.5 * weighted;
    return 1.0 + weighted; // health
}

/* A* wrapper — grafo en la grid DEM, coste = distancia × factor de salud.
 * No duplica el A* de terrain.js; se puede usar como drop-in cuando routeCostMode !== 'oxygen'. */
export function computeHealthOptimalRoute(path_m, dem, group, mode, opts = {}) {
    if (mode === 'oxygen') return null;

    const weights = group.cfg.route_weights;
    const step = opts.step_m || dem.resolution_m || 20;
    const maxSlope = opts.max_slope_deg || group.cfg.max_safe_slope_deg || 25;

    /* Interpolar path_m a pasos de `step` para simular cada sub-segmento */
    const densePath = [];
    for (let i = 0; i < path_m.length - 1; i++) {
        const [x0, z0] = path_m[i], [x1, z1] = path_m[i + 1];
        const dist = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.ceil(dist / step));
        for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n;
            const xa = x0 + (x1 - x0) * t0, za = z0 + (z1 - z0) * t0;
            const xb = x0 + (x1 - x0) * t1, zb = z0 + (z1 - z0) * t1;
            const dx = xb - xa, dz = zb - za;
            const dh = Math.hypot(dx, dz);
            if (dh < 1e-6) continue;
            const ea = dem.sample_elevation_m ? dem.sample_elevation_m(xa, za) : 0;
            const eb = dem.sample_elevation_m ? dem.sample_elevation_m(xb, zb) : 0;
            const slope = dem.sample_slope_deg ? dem.sample_slope_deg((xa + xb) / 2, (za + zb) / 2) : 0;
            const deltaElev = eb - ea;
            const segment = {
                walking_time_h: dh / group.cfg.walk_speed_ms / 3600,
                slope_deg: slope, delta_elev_m: deltaElev,
                surface_distance_m: dh,
                walk_speed_ms: group.cfg.walk_speed_ms,
            };
            const factor = computeHealthCostFactor(segment, group, weights, mode);
            densePath.push({ from: [xa, za], to: [xb, zb], cost: dh * factor, factor, slope });
        }
    }

    const totalCost = densePath.reduce((s, e) => s + e.cost, 0);
    const totalDistance = densePath.reduce((s, e) => s + Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]), 0);
    const maxSlopeEncountered = densePath.reduce((m, e) => Math.max(m, e.slope), 0);

    /* Simular el estado final del grupo tras la ruta densa */
    let sim = group;
    for (const edge of densePath) {
        sim = advanceGroupState(sim, {
            walking_time_h: Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]) / group.cfg.walk_speed_ms / 3600,
            slope_deg: edge.slope, delta_elev_m: 0, surface_distance_m: Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]),
        });
    }
    const finalAgg = aggregateGroupState(sim);

    return {
        mode, path_m, densePath,
        metrics: {
            total_cost: totalCost, total_distance_m: totalDistance,
            max_slope_deg: maxSlopeEncountered,
            safe: maxSlopeEncountered <= maxSlope,
        },
        final_group: finalAgg,
        weights,
        source: 'health_route_v1',
    };
}