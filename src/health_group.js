import { DEFAULT_HEALTH, DEFAULT_MEMBER, deriveHRMax } from './health_defaults.js';
import { advanceMemberState, initMemberState, deriveMemberPhysiology, sustainableSpeedMs } from './health.js';
import { getSuit, suitToHealthOverrides } from './suits.js';

const STORAGE_KEY_MODE = 'marswalk_health_mode';

/* Orden de precedencia: defaults < traje (suits.js) < overrides del dataset/usuario. */
export function resolveHealthConfig(overrides = {}) {
    const suitId = overrides.suit_id || DEFAULT_HEALTH.suit_id;
    const gravity = overrides.gravity_ms2 ?? DEFAULT_HEALTH.gravity_ms2;
    const suitCfg = suitId ? suitToHealthOverrides(getSuit(suitId), gravity, DEFAULT_HEALTH.gravity_earth_ms2) : {};
    const merged = { ...DEFAULT_HEALTH, ...suitCfg, ...overrides };
    if (merged.route_weights) merged.route_weights = { ...DEFAULT_HEALTH.route_weights, ...overrides.route_weights };
    if (merged.hr_max_bpm == null) merged.hr_max_bpm = deriveHRMax(merged.age_years);
    return merged;
}

export function resolveMember(m, cfg, index = 0) {
    const fromCfg = {
        body_mass_kg: cfg.body_mass_kg, age_years: cfg.age_years,
        sex: cfg.sex, fitness_level: cfg.fitness_level,
    };
    const member = { ...DEFAULT_MEMBER, ...fromCfg, ...m, id: m.id || `member_${index}` };
    if (member.cumulative_career_dose_msv == null || (m.cumulative_career_dose_msv == null && m.cumulative_career_dose_mgy != null)) {
        /* Compatibilidad: configs viejos daban mGy; se convierte con el factor de calidad de RAD. */
        member.cumulative_career_dose_msv = (m.cumulative_career_dose_mgy ?? 0) * (cfg.gy_to_sv_quality_factor ?? 3.2);
    }
    if (member.o2_capacity_l_equiv == null) member.o2_capacity_l_equiv = cfg.o2_capacity_l_equiv;
    member.physiology = deriveMemberPhysiology(member, cfg);
    if (member.hr_max_bpm == null) member.hr_max_bpm = member.physiology.hr_max_bpm;
    return member;
}

export function createSoloHealth(configOverrides = {}, memberOverrides = {}) {
    const cfg = resolveHealthConfig(configOverrides);
    const member = resolveMember({ ...memberOverrides, id: memberOverrides.id || 'solo' }, cfg, 0);
    return {
        mode: 'solo', cfg,
        members: [{ ...member, ...initMemberState(member, cfg) }],
        leaderIndex: 0, rotationClockMin: 0, totalRotations: 0,
        formation: 'solo', resourceTopology: 'per_suit',
    };
}

export function createGroupHealth(memberOverridesList = [], configOverrides = {}) {
    const cfg = resolveHealthConfig(configOverrides);
    const list = memberOverridesList.length
        ? memberOverridesList
        : Array.from({ length: cfg.group_size }, (_, i) => ({ id: `member_${i}` }));
    const members = list.map((m, i) => {
        const member = resolveMember(m, cfg, i);
        return { ...member, ...initMemberState(member, cfg) };
    });
    return {
        mode: 'group', cfg, members,
        leaderIndex: 0, rotationClockMin: 0, totalRotations: 0,
        formation: cfg.formation, resourceTopology: cfg.resource_topology,
    };
}

/* Ritmo del grupo = el del miembro más limitado (el grupo no deja a nadie atrás).
 * El líder abre camino con su terrain_factor; los demás con el de seguidor. */
export function groupSustainablePace(health, slope_deg = 0, v_max = health.cfg.walk_speed_ms) {
    const cfg = health.cfg;
    const isGroup = health.mode === 'group';
    let pace = v_max, bindingId = null;
    health.members.forEach((m, idx) => {
        const tf = isGroup ? (idx === health.leaderIndex ? cfg.leader_terrain_factor : cfg.follower_terrain_factor) : cfg.terrain_factor;
        const v = sustainableSpeedMs(m, { ...cfg, terrain_factor: tf }, slope_deg, v_max);
        if (v < pace) { pace = v; bindingId = m.id; }
    });
    return { pace_ms: pace, binding_member_id: bindingId };
}

/* Velocidad efectiva para simular rutas: fija o limitada por el ritmo sostenible (signed slope). */
export function routeWalkSpeed(health, signed_slope_deg) {
    const v = health.cfg.walk_speed_ms;
    if (health.cfg.route_pace_mode !== 'sustainable') return v;
    return groupSustainablePace(health, signed_slope_deg, v).pace_ms;
}

function ema(prev, next, alpha) {
    if (prev == null || !Number.isFinite(prev)) return next;
    return prev * (1 - alpha) + next * alpha;
}

export function advanceGroupState(health, segment) {
    const cfg = health.cfg;
    const isGroup = health.mode === 'group';
    const t_min = (segment.walking_time_h || 0) * 60;

    const alpha = cfg.health_smoothing_alpha ?? 0.12;
    const prevSm = health._smoothed || { slope_deg: 0, walk_speed_ms: 0 };
    const isMoving = (segment.surface_distance_m || 0) > 0.01;
    const smoothedSegment = isMoving
        ? {
            ...segment,
            slope_deg: ema(prevSm.slope_deg, segment.slope_deg || 0, alpha),
            walk_speed_ms: ema(prevSm.walk_speed_ms, segment.walk_speed_ms || 0, alpha)
        }
        : { ...segment, slope_deg: 0, walk_speed_ms: 0 };

    const members = health.members.map((m, idx) => {
        const isLeader = isGroup && idx === health.leaderIndex;
        const effectiveTerrain = isGroup
            ? (isLeader ? cfg.leader_terrain_factor : cfg.follower_terrain_factor)
            : cfg.terrain_factor;
        const extraHr = isGroup ? (isLeader ? cfg.leader_extra_hr_bpm : 0) + cfg.group_cognitive_hr_bump_bpm : 0;

        const prev = { ...m };
        const newState = advanceMemberState(smoothedSegment, prev, m, { ...cfg, terrain_factor: effectiveTerrain });
        const hrMax = newState.hr_max_bpm ?? cfg.hr_max_bpm;
        newState.heart_rate_bpm = Math.min(hrMax, newState.heart_rate_bpm + extraHr);
        newState.hr_fraction_of_max = newState.heart_rate_bpm / hrMax;
        newState.flags.hr_above_85pct_max = newState.heart_rate_bpm > 0.85 * hrMax;
        /* nav_role = posición en la marcha; role = rol de tripulación (comandante, piloto…) */
        newState.nav_role = isGroup ? (isLeader ? 'leader' : 'follower') : 'solo';
        return { ...m, ...newState };
    });

    let leaderIndex = health.leaderIndex;
    let rotationClockMin = health.rotationClockMin + t_min;
    let totalRotations = health.totalRotations;
    if (isGroup && cfg.leader_rotation_interval_min > 0 && members.length > 1) {
        while (rotationClockMin >= cfg.leader_rotation_interval_min) {
            leaderIndex = (leaderIndex + 1) % members.length;
            rotationClockMin -= cfg.leader_rotation_interval_min;
            totalRotations += 1;
        }
    }

    return {
        ...health, members, leaderIndex, rotationClockMin, totalRotations,
        _smoothed: { slope_deg: smoothedSegment.slope_deg, walk_speed_ms: smoothedSegment.walk_speed_ms }
    };
}

export function aggregateGroupState(health) {
    const members = health.members;
    if (!members.length) return null;

    const argmax = (key) => members.reduce((a, b) => a[key] > b[key] ? a : b);
    const argmin = (key) => members.reduce((a, b) => a[key] < b[key] ? a : b);

    const bindingMet = argmax('metabolic_fraction_of_max');
    const bindingHR = argmax('hr_fraction_of_max');
    const bindingO2 = argmin('o2_remaining_l');
    const bindingThermal = argmax('t_core_c');
    const bindingHydration = argmax('dehydration_pct_body_mass');

    const any = (key) => members.some((m) => m.flags?.[key]);

    let status = 'nominal';
    if (any('o2_depleted') || any('thermal_critical') || any('dehydration_critical')) status = 'critical';
    else if (any('over_sustainable_metabolic')) status = 'at_risk_over_sustainable';
    else if (any('thermal_warning') || any('dehydration_warning') || any('hr_above_85pct_max') || any('co2_cartridge_low') || any('career_dose_exceeded')) status = 'elevated';
    else if (any('o2_low')) status = 'low_o2';

    return {
        mode: health.mode, leaderIndex: health.leaderIndex,
        leaderId: members[health.leaderIndex]?.id, totalRotations: health.totalRotations,
        members: members.map((m) => ({
            id: m.id, name: m.name, role: m.role, nav_role: m.nav_role ?? (health.mode === 'solo' ? 'solo' : 'follower'),
            o2_remaining_l: m.o2_remaining_l, o2_consumed_l_total: m.o2_consumed_l_total,
            o2_capacity_l_equiv: m.o2_capacity_l_equiv, o2_time_remaining_min: m.o2_time_remaining_min,
            metabolic_rate_w: m.metabolic_rate_w, heart_rate_bpm: m.heart_rate_bpm,
            metabolic_fraction_of_max: m.metabolic_fraction_of_max, hr_fraction_of_max: m.hr_fraction_of_max,
            max_sustainable_m_w: m.max_sustainable_m_w, hr_max_bpm: m.hr_max_bpm,
            vo2_l_min: m.vo2_l_min, vo2_fraction_of_max: m.vo2_fraction_of_max,
            dose_usv: m.dose_usv, career_dose_fraction: m.career_dose_fraction,
            co2_cartridge_used_frac: m.co2_cartridge_used_frac,
            t_core_c: m.t_core_c, dehydration_pct_body_mass: m.dehydration_pct_body_mass,
            energy_kj_total: m.energy_kj_total, total_distance_m: m.total_distance_m,
            total_time_h: m.total_time_h, flags: m.flags,
        })),
        binding_member_metabolic: bindingMet.id,
        binding_member_hr: bindingHR.id,
        binding_member_o2: bindingO2.id,
        binding_member_thermal: bindingThermal.id,
        binding_member_hydration: bindingHydration.id,
        mean_metabolic_w: members.reduce((s, m) => s + m.metabolic_rate_w, 0) / members.length,
        max_metabolic_w: Math.max(...members.map((m) => m.metabolic_rate_w)),
        mean_hr_bpm: members.reduce((s, m) => s + m.heart_rate_bpm, 0) / members.length,
        max_hr_bpm: Math.max(...members.map((m) => m.heart_rate_bpm)),
        max_metabolic_fraction: Math.max(...members.map((m) => m.metabolic_fraction_of_max || 0)),
        max_hr_fraction: Math.max(...members.map((m) => m.hr_fraction_of_max || 0)),
        min_o2_time_remaining_min: Math.min(...members.map((m) => m.o2_time_remaining_min ?? Infinity)),
        max_dose_usv: Math.max(...members.map((m) => m.dose_usv || 0)),
        max_career_dose_fraction: Math.max(...members.map((m) => m.career_dose_fraction || 0)),
        min_o2_remaining_l: Math.min(...members.map((m) => m.o2_remaining_l)),
        max_t_core_c: Math.max(...members.map((m) => m.t_core_c)),
        max_dehydration_pct: Math.max(...members.map((m) => m.dehydration_pct_body_mass)),
        sum_o2_consumed_l: members.reduce((s, m) => s + m.o2_consumed_l_total, 0),
        sum_energy_kj: members.reduce((s, m) => s + m.energy_kj_total, 0),
        flags: {
            any_over_sustainable_metabolic: any('over_sustainable_metabolic'),
            any_hr_above_85pct_max: any('hr_above_85pct_max'),
            any_o2_low: any('o2_low'), any_o2_depleted: any('o2_depleted'),
            any_thermal_warning: any('thermal_warning'), any_thermal_critical: any('thermal_critical'),
            any_dehydration_warning: any('dehydration_warning'), any_dehydration_critical: any('dehydration_critical'),
            any_co2_cartridge_low: any('co2_cartridge_low'), any_career_dose_exceeded: any('career_dose_exceeded'),
        },
        status,
    };
}

export function loadHealthModePreference() {
    return localStorage.getItem(STORAGE_KEY_MODE) || 'solo';
}
export function saveHealthModePreference(mode) {
    if (mode === 'solo' || mode === 'group') localStorage.setItem(STORAGE_KEY_MODE, mode);
}