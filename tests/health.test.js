import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateMetabolicRateW, metabolicToVO2Lmin, estimateHeartRateBpm,
    estimateStrokeVolumeMl, advanceMemberState, initMemberState, slopeToGradePercent,
} from '../src/health.js';
import { resolveHealthConfig } from '../src/health_group.js';

const CFG = resolveHealthConfig();
const MEMBER = { id: 'test', body_mass_kg: 80, age_years: 40, o2_capacity_l_equiv: 580 };

test('grade conversion', () => {
    assert.equal(slopeToGradePercent(0), 0);
    assert.ok(Math.abs(slopeToGradePercent(45) - 100) < 1e-9);
});

test('flat walking > standing', () => {
    const flat = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 0, terrain_factor: 1.1 });
    const stand = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 0, signed_slope_deg: 0, terrain_factor: 1.1 });
    assert.ok(flat.metabolic_rate_w > stand.metabolic_rate_w);
    assert.ok(Math.abs(stand.metabolic_rate_w - stand.baseline_w) < 1e-6);
});

test('uphill costs more than downhill', () => {
    const up = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 10, terrain_factor: 1.1 });
    const flat = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 0, terrain_factor: 1.1 });
    const down = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: -10, terrain_factor: 1.1 });
    assert.ok(up.metabolic_rate_w > flat.metabolic_rate_w);
    assert.ok(down.metabolic_rate_w < flat.metabolic_rate_w);
});

test('downhill floor prevents negative cost', () => {
    const cfg = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: -45, terrain_factor: 1.1 });
    const flat = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 0, signed_slope_deg: 0, terrain_factor: 1.1 });
    assert.ok(cfg.metabolic_rate_w >= 0.5 * flat.baseline_w);
});

test('VO2 within physiological range for M=600W', () => {
    const vo2 = metabolicToVO2Lmin(600, 0.82);
    assert.ok(vo2 > 1.0 && vo2 < 3.0);
});

test('HR clamps at knots', () => {
    assert.ok(Math.abs(estimateHeartRateBpm(0, CFG) - CFG.hr_rest_bpm) < 1e-6);
    assert.ok(Math.abs(estimateHeartRateBpm(CFG.hr_m_max_w, CFG) - CFG.hr_max_bpm) < 1e-6);
    assert.ok(Math.abs(estimateHeartRateBpm(99999, CFG) - CFG.hr_max_bpm) < 1e-6);
});

test('SV clamps at knots', () => {
    assert.ok(Math.abs(estimateStrokeVolumeMl(0, CFG) - CFG.sv_rest_ml) < 1e-6);
    assert.ok(Math.abs(estimateStrokeVolumeMl(CFG.hr_m_max_w, CFG) - CFG.sv_max_ml) < 1e-6);
});

test('advanceMemberState: O2 decreases over segment', () => {
    const initial = initMemberState(MEMBER, CFG);
    const next = advanceMemberState(
        { walking_time_h: 0.5, slope_deg: 5, delta_elev_m: 20, surface_distance_m: 600, walk_speed_ms: 1.2 },
        initial, MEMBER, CFG
    );
    assert.ok(next.o2_remaining_l < initial.o2_remaining_l);
    assert.ok(next.energy_kj_total > 0);
    assert.ok(next.heart_rate_bpm > CFG.hr_rest_bpm);
});

test('stationary segment at steep slope does not trigger metabolic flag', () => {
    const initial = initMemberState(MEMBER, CFG);
    const next = advanceMemberState(
        { walking_time_h: 0.1, slope_deg: 25, delta_elev_m: 0, surface_distance_m: 0, walk_speed_ms: 0 },
        initial, MEMBER, CFG
    );
    assert.equal(next.flags.over_sustainable_metabolic, false);
    assert.ok(next.metabolic_rate_w < 400);
});

test('advanceMemberState: G3 modela dosis GCR; incapacitación sigue sin modelo', () => {
    const initial = initMemberState(MEMBER, CFG);
    const next = advanceMemberState(
        { walking_time_h: 0.1, slope_deg: 0, delta_elev_m: 0, surface_distance_m: 100, walk_speed_ms: 1.2 },
        initial, MEMBER, CFG
    );
    /* G2 ya modela térmico e hidratación */
    assert.ok(typeof next.t_core_c === 'number');
    assert.ok(next.t_core_c >= 37.0 && next.t_core_c <= 37.5);
    assert.ok(typeof next.hydration_deficit_l === 'number');
    assert.ok(next.hydration_deficit_l >= 0);
    /* G3.2: dosis = tasa RAD (27.9 µSv/h) × 0.1 h */
    assert.ok(Math.abs(next.dose_usv - 2.79) < 1e-9);
    assert.equal(next.time_to_incapacitation_min, null);
});

test('advanceMemberState: over_sustainable_metabolic flag', () => {
    const initial = initMemberState(MEMBER, CFG);
    const hard = advanceMemberState(
        { walking_time_h: 0.1, slope_deg: 20, delta_elev_m: 60, surface_distance_m: 200, walk_speed_ms: 1.2 },
        initial, MEMBER, CFG
    );
    assert.equal(hard.flags.over_sustainable_metabolic, true);
});

test('Pandolf: at rest, lighter astronaut has higher M due to (L/W)^2 load term', () => {
    const light = calculateMetabolicRateW({ body_mass_kg: 60, suit_mass_kg: 60, walk_speed_ms: 0, signed_slope_deg: 0, terrain_factor: 1.1 });
    const heavy = calculateMetabolicRateW({ body_mass_kg: 100, suit_mass_kg: 60, walk_speed_ms: 0, signed_slope_deg: 0, terrain_factor: 1.1 });
    assert.ok(light.metabolic_rate_w > heavy.metabolic_rate_w,
        'en reposo, Pandolf predice M mayor para masa menor por término (L/W)²');

    const lightMv = calculateMetabolicRateW({ body_mass_kg: 60, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 4, terrain_factor: 1.1 });
    const heavyMv = calculateMetabolicRateW({ body_mass_kg: 100, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 4, terrain_factor: 1.1 });
    assert.ok(heavyMv.metabolic_rate_w > lightMv.metabolic_rate_w,
        'en movimiento, el término η(W+L)V² hace que el más pesado consuma más');
});