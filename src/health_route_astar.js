/* A* con coste ponderado por salud del astronauta. Reemplaza el comportamiento de solo medir
 * (G2.5 original) por un rerouting real: el camino cambia según las dimensiones activas.
 *
 * Comparación apples-to-apples: usa el mismo A* para ambas rutas; solo cambian las dimensiones. */

import { advanceGroupState, aggregateGroupState, routeWalkSpeed } from './health_group.js';

export const DIMENSION_KEYS = ['slope', 'metabolic', 'heart_rate', 'oxygen', 'thermal', 'hydration', 'radiation'];

export const DIMENSION_LABELS = {
    slope: 'Pendiente (clásico)',
    metabolic: 'Metabólico (M)',
    heart_rate: 'Frecuencia cardíaca',
    oxygen: 'Consumo O₂',
    thermal: 'Térmico (T_core)',
    hydration: 'Hidratación',
    radiation: 'Radiación (GCR, RAD)',
};

export const PRESETS = {
    classic: { slope: true, metabolic: false, heart_rate: false, oxygen: false, thermal: false, hydration: false, radiation: false },
    safety: { slope: true, metabolic: true, heart_rate: true, oxygen: true, thermal: true, hydration: true, radiation: true },
    balanced: { slope: true, metabolic: true, heart_rate: true, oxygen: true, thermal: false, hydration: false, radiation: false },
    science: { slope: true, metabolic: false, heart_rate: false, oxygen: true, thermal: false, hydration: false, radiation: false },
};

const PRESET_LABELS = {
    classic: '🏁 Clásico (solo pendiente)',
    safety: '🛡️ Seguridad máxima (7 dims)',
    balanced: '⚖️ Balanceado (4 dims)',
    science: '🔬 Científico (O₂ optimizado)',
};

export { PRESET_LABELS };

/* MinHeap para A* — O(log n) push/pop */
class MinHeap {
    constructor() { this.a = []; }
    push(item) { this.a.push(item); this._up(this.a.length - 1); }
    pop() {
        if (this.a.length === 0) return null;
        const top = this.a[0];
        const last = this.a.pop();
        if (this.a.length > 0) { this.a[0] = last; this._down(0); }
        return top;
    }
    get size() { return this.a.length; }
    _up(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.a[p].f <= this.a[i].f) break;
            [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
            i = p;
        }
    }
    _down(i) {
        const n = this.a.length;
        for (; ;) {
            let l = i * 2 + 1, r = i * 2 + 2, s = i;
            if (l < n && this.a[l].f < this.a[s].f) s = l;
            if (r < n && this.a[r].f < this.a[s].f) s = r;
            if (s === i) break;
            [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
            i = s;
        }
    }
}

/* Esfuerzo relativo: cuadrático hasta el límite sostenible; por encima, penalización fuerte
 * (ese tramo no se puede sostener ni bajando al ritmo mínimo). */
export function metabolicPenalty(frac) {
    return frac <= 1 ? frac * frac : 1 + 10 * (frac - 1);
}

const STATUS_SEVERITY = { nominal: 0, low_o2: 1, elevated: 2, at_risk_over_sustainable: 3, critical: 4 };
export function worseStatus(a, b) {
    return (STATUS_SEVERITY[b] ?? 0) > (STATUS_SEVERITY[a] ?? 0) ? b : a;
}

/* Factor de salud para UNA arista. Cache por grado con signo (181 entradas). */
function buildEdgeHealthFactor(dimensions, group, ambientC) {
    const cache = new Map();
    const maxSafe = group.cfg.max_safe_slope_deg || 25;
    const activeW = DIMENSION_KEYS.reduce((s, k) => s + (dimensions[k] ? (group.cfg.route_weights[k] ?? 0.15) : 0), 0);
    const simGroup = { ...group, cfg: { ...group.cfg, health_smoothing_alpha: 1.0 } };

    return function edgeHealthFactor(slope_deg, dist_m, deltaElev_m) {
        const sign = deltaElev_m >= 0 ? 1 : -1;
        const key = Math.round(slope_deg) * sign;
        if (cache.has(key)) return cache.get(key);

        const v = routeWalkSpeed(group, slope_deg * sign);
        const seg = {
            walking_time_h: dist_m / v / 3600,
            slope_deg, delta_elev_m: deltaElev_m, surface_distance_m: dist_m,
            walk_speed_ms: v,
            ambient_temp_c: ambientC,
        };
        const sim = advanceGroupState(simGroup, seg);
        const agg = aggregateGroupState(sim);

        const f = {
            slope: slope_deg > maxSafe
                ? 5.0 + (slope_deg - maxSafe) * 0.5
                : 1 + (slope_deg / maxSafe) ** 2,
            /* Fracciones por miembro: manda el miembro más limitado, no un máximo genérico */
            metabolic: metabolicPenalty(agg.max_metabolic_fraction ?? agg.max_metabolic_w / group.cfg.max_sustainable_m_w),
            heart_rate: (agg.max_hr_fraction ?? agg.max_hr_bpm / group.cfg.hr_max_bpm) ** 2,
            /* O₂ por METRO (no por minuto): ir más lento cuesta más tiempo respirando. Ref: 600 W a 1.2 m/s */
            oxygen: (agg.max_metabolic_w / v) / (600 / 1.2),
            thermal: Math.max(0, (agg.max_t_core_c - 37) / 1.5),
            hydration: agg.max_dehydration_pct / (group.cfg.dehydration_warning_pct_body_mass || 2.0),
            /* GCR de fondo: dosis ∝ tiempo de exposición → coste por metro relativo a la tasa de Gale */
            radiation: ((group.cfg.surface_dose_rate_usv_h ?? 27.9) / 27.9) * (1.2 / v),
        };

        let num = 0;
        for (const k of DIMENSION_KEYS) {
            if (dimensions[k]) num += (group.cfg.route_weights[k] ?? 0.15) * f[k];
        }
        const factor = activeW > 0 ? 1 + num / activeW : 1.0;
        const result = { factor, components: f };
        cache.set(key, result);
        return result;
    };
}

/**
 * A* real sobre el grid DEM. Devuelve un camino distinto según las dimensiones activas.
 *
 * @param {object} args
 *   sampleElevation(x_m, z_m) → elevación (m)
 *   sampleSlope(x_m, z_m) → pendiente (deg)
 *   resolution_m, cols, rows
 *   start_m: [x,z], goal_m: [x,z]
 *   group: objeto state.health (o createSoloHealth())
 *   dimensions: { slope, metabolic, ... } booleans
 *   options: { ambient_temp_c, max_iter, window_margin_pct, step_m }
 */
export function computeHealthAwareRoute(args) {
    const {
        sampleElevation, sampleSlope,
        resolution_m, cols, rows,
        start_m, goal_m, group, dimensions,
        options = {},
    } = args;

    const baseRes_m = resolution_m || 20;
    const sizeW_m = cols * baseRes_m, sizeH_m = rows * baseRes_m;
    const directDist = Math.hypot(goal_m[0] - start_m[0], goal_m[1] - start_m[1]);
    const step_m = options.step_m || Math.max(baseRes_m, Math.min(100, Math.ceil(directDist / 120)));
    const gridCols = Math.max(16, Math.round(sizeW_m / step_m));
    const gridRows = Math.max(16, Math.round(sizeH_m / step_m));
    const ambientC = options.ambient_temp_c ?? -63;

    const worldToGrid = (x, z) => [
        Math.min(gridCols - 1, Math.max(0, Math.round((x + sizeW_m / 2) / step_m))),
        Math.min(gridRows - 1, Math.max(0, Math.round((z + sizeH_m / 2) / step_m))),
    ];
    const gridToWorld = (c, r) => [
        c * step_m - sizeW_m / 2,
        r * step_m - sizeH_m / 2,
    ];

    const [c0, r0] = worldToGrid(start_m[0], start_m[1]);
    const [c1, r1] = worldToGrid(goal_m[0], goal_m[1]);

    if (c0 < 0 || c0 >= gridCols || r0 < 0 || r0 >= gridRows || c1 < 0 || c1 >= gridCols || r1 < 0 || r1 >= gridRows) {
        return { path_m: [], metrics: { total_distance_m: 0 }, failed: true, error: 'Start/goal fuera del DEM' };
    }

    const marginPct = options.window_margin_pct ?? 0.4;
    const pad = Math.max(30, Math.ceil(Math.hypot(c1 - c0, r1 - r0) * marginPct));
    const cMin = Math.max(0, Math.min(c0, c1) - pad);
    const cMax = Math.min(gridCols - 1, Math.max(c0, c1) + pad);
    const rMin = Math.max(0, Math.min(r0, r1) - pad);
    const rMax = Math.min(gridRows - 1, Math.max(r0, r1) + pad);

    const edgeHF = buildEdgeHealthFactor(dimensions, group, ambientC);

    function costBetween(cA, rA, cB, rB) {
        const [xA, zA] = gridToWorld(cA, rA);
        const [xB, zB] = gridToWorld(cB, rB);
        const dx = xB - xA, dz = zB - zA;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-6) return 0;
        const mx = (xA + xB) / 2, mz = (zA + zB) / 2;
        const eA = sampleElevation(xA, zA);
        const eB = sampleElevation(xB, zB);
        const deltaElev = eB - eA;
        const slope = sampleSlope(mx, mz);
        const hf = edgeHF(slope, dist, deltaElev);
        return dist * hf.factor;
    }

    const startKey = r0 * gridCols + c0;
    const goalKey = r1 * gridCols + c1;
    const heur = (c, r) => Math.hypot(c - c1, r - r1) * step_m;

    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    const open = new MinHeap();
    open.push({ c: c0, r: r0, g: 0, f: heur(c0, r0), key: startKey });

    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    const maxIter = options.max_iter ?? 200000;
    let iter = 0;
    let reached = false;

    while (open.size > 0 && iter++ < maxIter) {
        const cur = open.pop();
        if (closed.has(cur.key)) continue;
        closed.add(cur.key);

        if (cur.c === c1 && cur.r === r1) { reached = true; break; }

        for (const [dc, dr] of DIRS) {
            const nc = cur.c + dc, nr = cur.r + dr;
            if (nc < cMin || nc > cMax || nr < rMin || nr > rMax) continue;
            const nKey = nr * gridCols + nc;
            if (closed.has(nKey)) continue;

            const step = costBetween(cur.c, cur.r, nc, nr);
            const tentativeG = cur.g + step;
            const prev = gScore.get(nKey);
            if (prev !== undefined && tentativeG >= prev) continue;

            gScore.set(nKey, tentativeG);
            cameFrom.set(nKey, cur.key);
            open.push({ c: nc, r: nr, g: tentativeG, f: tentativeG + heur(nc, nr), key: nKey });
        }
    }

    if (!reached) {
        return {
            path_m: [], failed: true, iterations: iter,
            error: iter >= maxIter ? 'A* alcanzó el límite de iteraciones' : 'Sin camino al destino',
        };
    }

    /* Reconstruir camino */
    const path = [];
    let k = goalKey;
    while (k !== undefined && k !== null) {
        const c = k % gridCols, r = Math.floor(k / gridCols);
        path.push(gridToWorld(c, r));
        k = cameFrom.get(k);
    }
    path.reverse();

    return finalizeRoute(path, sampleElevation, sampleSlope, group, dimensions, ambientC);
}

function finalizeRoute(path_m, sampleElevation, sampleSlope, group, dimensions, ambientC) {
    const edgeHF = buildEdgeHealthFactor(dimensions, group, ambientC);
    let totalDist = 0, totalCost = 0, maxSlope = 0;
    const compSum = {}, compCount = {};
    for (const k of DIMENSION_KEYS) { compSum[k] = 0; compCount[k] = 0; }

    for (let i = 0; i < path_m.length - 1; i++) {
        const [x0, z0] = path_m[i], [x1, z1] = path_m[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-6) continue;
        const e0 = sampleElevation(x0, z0);
        const e1 = sampleElevation(x1, z1);
        const slope = sampleSlope((x0 + x1) / 2, (z0 + z1) / 2);
        const hf = edgeHF(slope, dist, e1 - e0);
        totalDist += dist;
        totalCost += dist * hf.factor;
        maxSlope = Math.max(maxSlope, slope);
        for (const k of DIMENSION_KEYS) {
            if (dimensions[k]) { compSum[k] += hf.components[k] * dist; compCount[k] += dist; }
        }
    }

    const components_avg = {};
    for (const k of DIMENSION_KEYS) {
        components_avg[k] = compCount[k] > 0 ? compSum[k] / compCount[k] : 0;
    }

    return {
        path_m,
        metrics: { total_distance_m: totalDist, total_cost: totalCost, max_slope_deg: maxSlope },
        components_avg,
        failed: false,
    };
}

/* Simulación acumulada de una ruta: camina los edges en secuencia y acumula estado fisiológico. */
export function simulateRouteMetrics(path_m, sampleElevation, sampleSlope, group, ambientC = -63) {
    let sim = { ...group, cfg: { ...group.cfg, health_smoothing_alpha: 1.0 } };
    let totalDist = 0, maxSlope = 0, totalTimeH = 0, minPace = Infinity;
    let worst = 'nominal', overloadH = 0;
    let peakM = 0, peakHR = 0, peakTCore = 37, peakHyd = 0;
    let sumM = 0, sumHR = 0, n = 0;

    for (let i = 0; i < path_m.length - 1; i++) {
        const [x0, z0] = path_m[i], [x1, z1] = path_m[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-6) continue;
        const e0 = sampleElevation(x0, z0);
        const e1 = sampleElevation(x1, z1);
        const slope = sampleSlope((x0 + x1) / 2, (z0 + z1) / 2);

        const v = routeWalkSpeed(group, (e1 - e0) >= 0 ? slope : -slope);
        const seg = {
            walking_time_h: dist / v / 3600,
            slope_deg: slope, delta_elev_m: e1 - e0, surface_distance_m: dist,
            walk_speed_ms: v, ambient_temp_c: ambientC,
        };
        sim = advanceGroupState(sim, seg);
        const agg = aggregateGroupState(sim);
        totalDist += dist;
        totalTimeH += seg.walking_time_h;
        minPace = Math.min(minPace, v);
        worst = worseStatus(worst, agg.status);
        if (agg.max_metabolic_fraction > 1) overloadH += seg.walking_time_h;
        maxSlope = Math.max(maxSlope, slope);
        peakM = Math.max(peakM, agg.max_metabolic_w);
        peakHR = Math.max(peakHR, agg.max_hr_bpm);
        peakTCore = Math.max(peakTCore, agg.max_t_core_c);
        peakHyd = Math.max(peakHyd, agg.max_dehydration_pct);
        sumM += agg.max_metabolic_w;
        sumHR += agg.max_hr_bpm;
        n++;
    }

    const finalAgg = aggregateGroupState(sim);
    return {
        total_distance_m: totalDist,
        total_time_h: totalTimeH,
        mean_pace_ms: totalTimeH > 0 ? totalDist / (totalTimeH * 3600) : 0,
        min_pace_ms: Number.isFinite(minPace) ? minPace : 0,
        max_slope_deg: maxSlope,
        peak_metabolic_w: peakM,
        mean_metabolic_w: n ? sumM / n : 0,
        peak_hr_bpm: peakHR,
        mean_hr_bpm: n ? sumHR / n : 0,
        peak_t_core_c: peakTCore,
        peak_dehydration_pct: peakHyd,
        o2_used_l: finalAgg.sum_o2_consumed_l,
        o2_remaining_min_l: finalAgg.min_o2_remaining_l,
        dose_usv: finalAgg.max_dose_usv,
        energy_kj: finalAgg.sum_energy_kj,
        overload_time_min: overloadH * 60,
        status: worseStatus(worst, finalAgg.status),   // peor estado de TODO el recorrido
        final_status: finalAgg.status,
        final_group: finalAgg,
    };
}

export function compareRoutes(classicPath, healthPath, sampleElevation, sampleSlope, group, ambientC = -63) {
    const classic = classicPath?.length > 1 ? simulateRouteMetrics(classicPath, sampleElevation, sampleSlope, group, ambientC) : null;
    const health = healthPath?.length > 1 ? simulateRouteMetrics(healthPath, sampleElevation, sampleSlope, group, ambientC) : null;
    if (!classic || !health) return { classic, health, deltas: null };

    const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);
    const deltas = {
        distance_m: health.total_distance_m - classic.total_distance_m,
        distance_pct: pct(health.total_distance_m, classic.total_distance_m),
        time_h: health.total_time_h - classic.total_time_h,
        time_pct: pct(health.total_time_h, classic.total_time_h),
        max_slope_deg: health.max_slope_deg - classic.max_slope_deg,
        peak_metabolic_w: health.peak_metabolic_w - classic.peak_metabolic_w,
        peak_metabolic_pct: pct(health.peak_metabolic_w, classic.peak_metabolic_w),
        peak_hr_bpm: health.peak_hr_bpm - classic.peak_hr_bpm,
        peak_hr_pct: pct(health.peak_hr_bpm, classic.peak_hr_bpm),
        o2_used_l: health.o2_used_l - classic.o2_used_l,
        o2_used_pct: pct(health.o2_used_l, classic.o2_used_l),
        peak_t_core_c: health.peak_t_core_c - classic.peak_t_core_c,
        peak_dehydration_pct: health.peak_dehydration_pct - classic.peak_dehydration_pct,
        overload_time_min: health.overload_time_min - classic.overload_time_min,
        status_changed: health.status !== classic.status,
    };
    return { classic, health, deltas };
}