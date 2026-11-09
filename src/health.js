/* Modelo fisiológico Fase G2/G3: metabólico + cardiovascular + O2 + CO2 + térmico + hidratación + radiación.
 * G2.1 gravedad · G2.2 presión · G2.3 térmico · G2.4 hidratación ·
 * G3.1 capacidad aeróbica por miembro · G3.2 radiación GCR · G3.3 CO2 y autonomía de O2. */

export function slopeToGradePercent(slope_deg) {
    return Math.tan(slope_deg * Math.PI / 180) * 100;
}

export function calculateMetabolicRateW(inputs, cfg = null) {
    const W = inputs.body_mass_kg, L = inputs.suit_mass_kg, V = inputs.walk_speed_ms;
    const G = slopeToGradePercent(inputs.signed_slope_deg);
    const baseline = 1.5 * W + 2.0 * (W + L) * (L / W) ** 2;
    const effort = inputs.terrain_factor * (W + L) * (1.5 * V * V + 0.35 * V * G);
    let raw = baseline + effort;
    let m = Math.max(raw, 0.5 * baseline);

    let gravityFactor = 1.0, pressureOverheadW = 0.0;
    if (cfg) {
        if (cfg.gravity_correction_mode === 'linear_vertical') {
            gravityFactor = cfg.gravity_ms2 / cfg.gravity_earth_ms2;
            raw = baseline + effort * gravityFactor;
            m = Math.max(raw, 0.5 * baseline);
        } else if (cfg.gravity_correction_mode === 'empirical') {
            gravityFactor = cfg.gravity_empirical_factor;
            raw *= gravityFactor;
            m *= gravityFactor;
        } else if (cfg.gravity_correction_mode === 'split') {
            /* Marcha plana × factor de marcha; trabajo vertical con masa real × g_Marte.
             * El término de pendiente de Pandolf es trabajo contra la gravedad: escala con g. */
            const gRatio = cfg.gravity_ms2 / cfg.gravity_earth_ms2;
            const trueSuit = inputs.suit_true_mass_kg ?? cfg.suit_true_mass_kg ?? L / gRatio;
            const level = inputs.terrain_factor * (W + L) * 1.5 * V * V * cfg.gravity_empirical_factor;
            const grade = inputs.terrain_factor * (W + trueSuit) * 0.35 * V * G * gRatio;
            gravityFactor = gRatio;
            raw = baseline + level + grade;
            m = Math.max(raw, 0.5 * baseline);
        }
        if (cfg.suit_pressure_overhead_mode === 'percent_overhead') {
            pressureOverheadW = m * cfg.suit_pressure_overhead_fraction;
            raw += pressureOverheadW;
            m += pressureOverheadW;
        }
    }

    return {
        baseline_w: baseline,
        effort_w: effort,
        metabolic_rate_raw_w: raw,
        metabolic_rate_w: m,
        grade_percent: G,
        gravity_factor_applied: gravityFactor,
        pressure_overhead_w: pressureOverheadW,
    };
}

export function oxygenEnergyKjPerL(rer = 0.82) {
    const rerC = Math.max(0.7, Math.min(1.0, rer));
    return 19.6 + (rerC - 0.7) / 0.3 * 1.5;
}

export function metabolicToVO2Lmin(M_w, rer = 0.82) {
    return M_w * 60 / (oxygenEnergyKjPerL(rer) * 1000);
}

export function vo2LminToMetabolicW(vo2_l_min, rer = 0.82) {
    return vo2_l_min * oxygenEnergyKjPerL(rer) * 1000 / 60;
}

/* G3.1 — Capacidad aeróbica de cada miembro a partir de sexo, edad y condición física.
 * VO₂máx(edad) = VO₂máx(25) × (1 − d·max(0, edad − 25)); FCmáx = 220 − edad;
 * M sostenible = fracción de VO₂máx convertida a W. */
export function deriveMemberPhysiology(member, cfg) {
    const sex = cfg.vo2max_25y_ml_kg_min?.[member.sex] ? member.sex : 'unspecified';
    const table = cfg.vo2max_25y_ml_kg_min?.[sex] || { nominal: 41.5 };
    const fitness = table[member.fitness_level] != null ? member.fitness_level : 'nominal';
    const age = member.age_years ?? 40;
    const decline = Math.max(0.4, 1 - (cfg.vo2max_decline_per_year ?? 0.01) * Math.max(0, age - 25));
    const vo2max_ml_kg_min = table[fitness] * decline;
    const vo2max_l_min = vo2max_ml_kg_min * member.body_mass_kg / 1000;
    const vo2_rest_l_min = (cfg.vo2_rest_ml_kg_min ?? 3.5) * member.body_mass_kg / 1000;
    const hr_max_bpm = member.hr_max_bpm ?? (220 - age);
    const hr_rest_bpm = member.hr_rest_bpm ?? cfg.hr_rest_by_fitness_bpm?.[fitness] ?? cfg.hr_rest_bpm;
    const max_sustainable_m_w = vo2LminToMetabolicW(vo2max_l_min * (cfg.sustainable_vo2max_fraction ?? 0.6), cfg.rer_assumed);
    return {
        sex_used: sex, fitness_used: fitness,
        vo2max_ml_kg_min, vo2max_l_min, vo2_rest_l_min,
        hr_max_bpm, hr_rest_bpm, max_sustainable_m_w,
    };
}

/* G3.4 — Ritmo sostenible: mayor velocidad (≤ v_max) con M ≤ M_sostenible en esa pendiente.
 * Bisección sobre el modelo metabólico; nunca baja de v_min (paso mínimo de marcha). */
export function sustainableSpeedMs(member, cfg, slope_deg = 0, v_max = cfg.walk_speed_ms, v_min = 0.3) {
    const phys = member.physiology || deriveMemberPhysiology(member, cfg);
    const limit = phys.max_sustainable_m_w;
    const mAt = (v) => calculateMetabolicRateW({
        body_mass_kg: member.body_mass_kg, suit_mass_kg: cfg.suit_mass_kg, suit_true_mass_kg: cfg.suit_true_mass_kg,
        walk_speed_ms: v, signed_slope_deg: slope_deg,
        terrain_factor: cfg.terrain_factor * (cfg.suit_mobility_factor ?? 1),
    }, cfg).metabolic_rate_w;
    if (mAt(v_max) <= limit) return v_max;
    if (mAt(v_min) > limit) return v_min;
    let lo = v_min, hi = v_max;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (mAt(mid) <= limit) lo = mid; else hi = mid;
    }
    return lo;
}

/* FC por reserva de VO₂ (Swain & Leutholtz 1997): %FCR ≈ %VO₂R. */
export function heartRateFromVO2Reserve(vo2_l_min, phys) {
    const frac = (vo2_l_min - phys.vo2_rest_l_min) / Math.max(1e-6, phys.vo2max_l_min - phys.vo2_rest_l_min);
    const f = Math.max(0, Math.min(1, frac));
    return phys.hr_rest_bpm + (phys.hr_max_bpm - phys.hr_rest_bpm) * f;
}

export function estimateHeartRateBpm(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.hr_rest_bpm + (cfg.hr_walk_target_bpm - cfg.hr_rest_bpm) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.hr_walk_target_bpm + (cfg.hr_max_bpm - cfg.hr_walk_target_bpm) * t;
}

export function estimateStrokeVolumeMl(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * (0.5 + 0.5 * t);
}

/* G2.3 — Térmico (Gagge simplificado).
 * k_loss = 0.5 W/K refleja la resistencia térmica efectiva del MLI del traje
 * (antes 2.0 W/K, irreal: enfriaba incluso a M=600 W). Con 0.5 W/K, flat walking
 * produce +41 W de calor neto y LCVG failure eleva T_core como debe. */
export function advanceThermalState(prevT, M_w, ambient_temp_c, t_h, member, cfg) {
    if (cfg.thermal_mode === 'nominal') {
        const targetT = cfg.t_core_initial_c + Math.min(0.4, Math.max(0, (M_w - 300) / 1500) * 0.4);
        return Math.min(cfg.t_core_initial_c + 0.4, Math.max(cfg.t_core_initial_c, prevT + (targetT - prevT) * Math.min(1, t_h * 2)));
    }
    const m_kg = member.body_mass_kg;
    const c_p = cfg.body_c_p_kj_kg_k * 1000;
    const k_loss = 0.5;
    const heatInput = M_w * (1 - cfg.thermal_lcvg_efficiency);
    const heatLoss = k_loss * (prevT - ambient_temp_c);
    const netHeatW = heatInput - heatLoss;
    const dT = (netHeatW / (m_kg * c_p)) * t_h * 3600;
    return Math.min(45, prevT + dT);
}

export function advanceHydrationState(prevDeficit, M_w, t_core, t_h, cfg) {
    const sweatRate = 0.4 * (M_w / 600) * (1 + Math.max(0, (t_core - 37)) * 0.2);
    const sweat = sweatRate * t_h;
    const provision = cfg.potable_water_provision_l_h * t_h;
    return Math.max(0, prevDeficit + sweat - provision);
}

export function advanceMemberState(segment, prevState, member, cfg) {
    const t_h = Math.max(0, segment.walking_time_h || 0);
    const slope = Math.max(0, Math.min(90, segment.slope_deg || 0));
    const delta = segment.delta_elev_m || 0;
    const signedSlope = delta >= 0 ? slope : -slope;
    const effectiveSpeed = segment.walk_speed_ms ?? cfg.walk_speed_ms;

    const metab = calculateMetabolicRateW({
        body_mass_kg: member.body_mass_kg,
        suit_mass_kg: cfg.suit_mass_kg,
        suit_true_mass_kg: cfg.suit_true_mass_kg,
        walk_speed_ms: effectiveSpeed,
        signed_slope_deg: signedSlope,
        terrain_factor: cfg.terrain_factor * (cfg.suit_mobility_factor ?? 1),
    }, cfg);

    const phys = member.physiology || (cfg.cardio_model === 'vo2_reserve' ? deriveMemberPhysiology(member, cfg) : null);
    const useReserve = cfg.cardio_model === 'vo2_reserve' && phys;
    const hrMax = useReserve ? phys.hr_max_bpm : cfg.hr_max_bpm;
    const maxSustainable = useReserve ? phys.max_sustainable_m_w : cfg.max_sustainable_m_w;

    const vo2 = metabolicToVO2Lmin(metab.metabolic_rate_w, cfg.rer_assumed);
    const vco2 = vo2 * cfg.rer_assumed;
    const hr = useReserve ? heartRateFromVO2Reserve(vo2, phys) : estimateHeartRateBpm(metab.metabolic_rate_w, cfg);
    const sv = estimateStrokeVolumeMl(metab.metabolic_rate_w, cfg);
    const co = hr * sv / 1000;
    const energy_kj = metab.metabolic_rate_w * t_h * 3.6;
    const o2_consumed_l = vo2 * 60 * t_h;
    const o2_capacity = member.o2_capacity_l_equiv ?? cfg.o2_capacity_l_equiv;
    const o2_remaining_l = Math.max(0, (prevState.o2_remaining_l ?? o2_capacity) - o2_consumed_l);
    /* Autonomía al ritmo actual (nunca menos que el VO₂ de reposo) */
    const vo2ForAutonomy = Math.max(vo2, phys ? phys.vo2_rest_l_min : 0.3);
    const o2_time_remaining_min = o2_remaining_l / vo2ForAutonomy;

    /* G3.3 — CO₂: con eliminación continua (RCA) no se acumula; con cartucho se consume capacidad. */
    const co2_produced_l_total = (prevState.co2_produced_l_total || 0) + vco2 * 60 * t_h;
    const co2_cartridge_used_frac = cfg.co2_removal === 'cartridge' && cfg.co2_capacity_l
        ? Math.min(1, co2_produced_l_total / cfg.co2_capacity_l)
        : 0;

    /* G3.2 — Radiación GCR de fondo (dosis equivalente). */
    const dose_usv = (prevState.dose_usv || 0) + (segment.dose_rate_usv_h ?? cfg.surface_dose_rate_usv_h ?? 0) * t_h;
    const careerMsv = member.cumulative_career_dose_msv ?? 0;
    const career_dose_fraction = (careerMsv + dose_usv / 1000) / (cfg.career_dose_limit_msv || 600);

    const ambient_temp_c = segment.ambient_temp_c ?? -63;
    const prevT = prevState.t_core_c ?? cfg.t_core_initial_c;
    const t_core_c = advanceThermalState(prevT, metab.metabolic_rate_w, ambient_temp_c, t_h, member, cfg);
    const prevDef = prevState.hydration_deficit_l ?? 0;
    const hydration_deficit_l = advanceHydrationState(prevDef, metab.metabolic_rate_w, t_core_c, t_h, cfg);
    const dehydrationPct = (hydration_deficit_l / member.body_mass_kg) * 100;

    return {
        member_id: member.id,
        o2_remaining_l,
        o2_consumed_l_total: (prevState.o2_consumed_l_total || 0) + o2_consumed_l,
        energy_kj_total: (prevState.energy_kj_total || 0) + energy_kj,
        metabolic_rate_w: metab.metabolic_rate_w,
        metabolic_fraction_of_max: metab.metabolic_rate_w / maxSustainable,
        max_sustainable_m_w: maxSustainable,
        gravity_factor_applied: metab.gravity_factor_applied,
        pressure_overhead_w: metab.pressure_overhead_w,
        vo2_l_min: vo2,
        vco2_l_min: vco2,
        heart_rate_bpm: hr,
        hr_max_bpm: hrMax,
        hr_fraction_of_max: hr / hrMax,
        vo2_fraction_of_max: phys ? vo2 / phys.vo2max_l_min : null,
        stroke_volume_ml: sv,
        cardiac_output_l_min: co,
        total_time_h: (prevState.total_time_h || 0) + t_h,
        total_distance_m: (prevState.total_distance_m || 0) + (segment.surface_distance_m || 0),
        t_core_c,
        hydration_deficit_l,
        dehydration_pct_body_mass: dehydrationPct,
        o2_time_remaining_min,
        co2_produced_l_total,
        co2_cartridge_used_frac,
        dose_usv,
        career_dose_fraction,
        time_to_incapacitation_min: null,
        flags: {
            over_sustainable_metabolic: metab.metabolic_rate_w > maxSustainable,
            hr_above_85pct_max: hr > 0.85 * hrMax,
            o2_low: o2_remaining_l < cfg.o2_critical_threshold_l,
            co2_cartridge_low: co2_cartridge_used_frac > 0.85,
            career_dose_exceeded: career_dose_fraction >= 1,
            o2_depleted: o2_remaining_l <= 0,
            thermal_warning: t_core_c > cfg.t_core_warning_c,
            thermal_critical: t_core_c > cfg.t_core_critical_c,
            dehydration_warning: dehydrationPct > cfg.dehydration_warning_pct_body_mass,
            dehydration_critical: dehydrationPct > cfg.dehydration_critical_pct_body_mass,
        },
    };
}

export function initMemberState(member, cfg) {
    const phys = member.physiology || (cfg.cardio_model === 'vo2_reserve' ? deriveMemberPhysiology(member, cfg) : null);
    const hrRest = phys ? phys.hr_rest_bpm : cfg.hr_rest_bpm;
    const hrMax = phys ? phys.hr_max_bpm : cfg.hr_max_bpm;
    const o2 = member.o2_capacity_l_equiv ?? cfg.o2_capacity_l_equiv;
    const careerMsv = member.cumulative_career_dose_msv ?? 0;
    return {
        member_id: member.id,
        o2_remaining_l: o2,
        o2_consumed_l_total: 0,
        energy_kj_total: 0,
        metabolic_rate_w: 0,
        metabolic_fraction_of_max: 0,
        max_sustainable_m_w: phys ? phys.max_sustainable_m_w : cfg.max_sustainable_m_w,
        gravity_factor_applied: 1.0,
        pressure_overhead_w: 0,
        vo2_l_min: 0,
        vco2_l_min: 0,
        heart_rate_bpm: hrRest,
        hr_max_bpm: hrMax,
        hr_fraction_of_max: hrRest / hrMax,
        vo2_fraction_of_max: 0,
        stroke_volume_ml: cfg.sv_rest_ml,
        cardiac_output_l_min: 0,
        total_time_h: 0,
        total_distance_m: 0,
        t_core_c: cfg.t_core_initial_c,
        hydration_deficit_l: 0,
        dehydration_pct_body_mass: 0,
        o2_time_remaining_min: phys ? o2 / phys.vo2_rest_l_min : null,
        co2_produced_l_total: 0,
        co2_cartridge_used_frac: 0,
        dose_usv: 0,
        career_dose_fraction: careerMsv / (cfg.career_dose_limit_msv || 600),
        time_to_incapacitation_min: null,
        flags: {
            over_sustainable_metabolic: false,
            hr_above_85pct_max: false,
            o2_low: false,
            co2_cartridge_low: false,
            career_dose_exceeded: careerMsv >= (cfg.career_dose_limit_msv || 600),
            o2_depleted: false,
            thermal_warning: false,
            thermal_critical: false,
            dehydration_warning: false,
            dehydration_critical: false,
        },
    };
}