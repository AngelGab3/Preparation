import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateMetabolicRateW, metabolicToVO2Lmin, deriveMemberPhysiology, heartRateFromVO2Reserve,
    sustainableSpeedMs, advanceMemberState, initMemberState,
} from '../src/health.js';
import {
    resolveHealthConfig, resolveMember, createSoloHealth, createGroupHealth,
    advanceGroupState, aggregateGroupState, groupSustainablePace,
} from '../src/health_group.js';
import { simulateRouteMetrics } from '../src/health_route_astar.js';
import { SUIT_CATALOG, getSuit, suitToHealthOverrides } from '../src/suits.js';

const CFG = resolveHealthConfig();
const base = { body_mass_kg: 80, walk_speed_ms: 1.2, terrain_factor: 1.1 };

test('xEMU: el traje fija masa, presión y O₂ del modelo', () => {
    const o = suitToHealthOverrides(getSuit('xemu'));
    assert.equal(o.suit_true_mass_kg, 170);
    assert.ok(Math.abs(o.suit_mass_kg - 170 * 3.71 / 9.81) < 1e-9);       // 64.3 kg equivalente Tierra
    assert.ok(Math.abs(o.suit_pressure_kpa - 29.65) < 0.01);              // 4.3 psi
    assert.equal(CFG.suit_id, 'xemu');
    assert.equal(CFG.suit_true_mass_kg, 170);
    assert.equal(CFG.co2_removal, 'continuous');
    for (const c of SUIT_CATALOG.xemu.components) {
        assert.ok(c.id && c.name && c.specs.length && c.affects.length, `componente ${c.id} completo`);
        for (const sp of c.specs) assert.ok(['publicado', 'estimado'].includes(sp.conf));
    }
});

test('overrides del dataset ganan sobre el traje', () => {
    const cfg = resolveHealthConfig({ o2_capacity_l_equiv: 400 });
    assert.equal(cfg.o2_capacity_l_equiv, 400);
});

test('split: la cuesta escala con g de Marte y masa real; plano con factor de marcha', () => {
    const cfg = { ...CFG, suit_pressure_overhead_mode: 'none' };
    const earth = { ...cfg, gravity_correction_mode: 'none' };
    const up = (c) => calculateMetabolicRateW({ ...base, suit_mass_kg: CFG.suit_mass_kg, suit_true_mass_kg: 170, signed_slope_deg: 10 }, c);
    const flat = (c) => calculateMetabolicRateW({ ...base, suit_mass_kg: CFG.suit_mass_kg, suit_true_mass_kg: 170, signed_slope_deg: 0 }, c);
    assert.ok(up(cfg).metabolic_rate_w > flat(cfg).metabolic_rate_w);
    /* El término de pendiente en Marte = (W + L_real)·g_ratio frente a (W + L_eq) en Tierra */
    const gR = 3.71 / 9.81;
    const gradeMars = up(cfg).metabolic_rate_w - flat(cfg).metabolic_rate_w;
    const gradeEarth = up(earth).metabolic_rate_w - flat(earth).metabolic_rate_w;
    const expected = gradeEarth * ((80 + 170) * gR) / (80 + CFG.suit_mass_kg);
    assert.ok(Math.abs(gradeMars - expected) < 1e-6);
    /* Cross-check físico: potencia vertical m·g·v_vert / eficiencia muscular ≈ 0.25 */
    const vVert = 1.2 * Math.sin(10 * Math.PI / 180);
    const mechanical = (80 + 170) * 3.71 * vVert;
    const ratio = gradeMars / (mechanical / 0.25);
    assert.ok(ratio > 0.8 && ratio < 1.3, `término de pendiente coherente con mgh (ratio ${ratio.toFixed(2)})`);
});

test('VO₂máx: baja con la edad, sube con la condición física, depende del sexo', () => {
    const p = (m) => deriveMemberPhysiology({ body_mass_kg: 75, ...m }, CFG);
    assert.ok(p({ age_years: 30, fitness_level: 'nominal', sex: 'male' }).vo2max_ml_kg_min
        > p({ age_years: 55, fitness_level: 'nominal', sex: 'male' }).vo2max_ml_kg_min);
    assert.ok(p({ age_years: 40, fitness_level: 'fit', sex: 'male' }).vo2max_ml_kg_min
        > p({ age_years: 40, fitness_level: 'low', sex: 'male' }).vo2max_ml_kg_min);
    assert.ok(p({ age_years: 40, sex: 'male' }).vo2max_ml_kg_min > p({ age_years: 40, sex: 'female' }).vo2max_ml_kg_min);
    const young = p({ age_years: 25, fitness_level: 'nominal', sex: 'male' });
    assert.equal(young.vo2max_ml_kg_min, 45);
    assert.equal(young.hr_max_bpm, 195);
    /* Valores desconocidos caen a defaults seguros */
    const odd = p({ age_years: 40, fitness_level: '???', sex: '???' });
    assert.equal(odd.fitness_used, 'nominal');
    assert.equal(odd.sex_used, 'unspecified');
});

test('FC por reserva de VO₂: reposo → FC reposo, VO₂máx → FCmáx', () => {
    const phys = deriveMemberPhysiology({ body_mass_kg: 80, age_years: 40, fitness_level: 'fit', sex: 'male' }, CFG);
    assert.equal(heartRateFromVO2Reserve(phys.vo2_rest_l_min, phys), phys.hr_rest_bpm);
    assert.equal(heartRateFromVO2Reserve(phys.vo2max_l_min, phys), phys.hr_max_bpm);
    assert.equal(heartRateFromVO2Reserve(99, phys), phys.hr_max_bpm);
});

test('mismo esfuerzo: el miembro en mejor forma tiene menor FC', () => {
    const seg = { walking_time_h: 0.05, slope_deg: 3, delta_elev_m: 5, surface_distance_m: 200, walk_speed_ms: 1.0 };
    const run = (fitness) => {
        const m = resolveMember({ id: fitness, body_mass_kg: 80, age_years: 40, fitness_level: fitness }, CFG);
        return advanceMemberState(seg, initMemberState(m, CFG), m, CFG);
    };
    assert.ok(run('elite').heart_rate_bpm < run('low').heart_rate_bpm);
    assert.ok(run('elite').metabolic_fraction_of_max < run('low').metabolic_fraction_of_max);
});

test('FCmáx en grupo es por miembro (edad), no global', () => {
    const h = createGroupHealth([{ id: 'young', age_years: 30 }, { id: 'old', age_years: 60 }]);
    const after = advanceGroupState(h, { walking_time_h: 0.05, slope_deg: 20, delta_elev_m: 30, surface_distance_m: 200, walk_speed_ms: 1.2 });
    const young = after.members.find((m) => m.id === 'young');
    const old = after.members.find((m) => m.id === 'old');
    assert.equal(young.hr_max_bpm, 190);
    assert.equal(old.hr_max_bpm, 160);
    assert.ok(old.heart_rate_bpm <= 160);
});

test('el miembro solo usa masa/edad del config del dataset', () => {
    const solo = createSoloHealth({ body_mass_kg: 82, age_years: 45 });
    assert.equal(solo.members[0].body_mass_kg, 82);
    assert.equal(solo.members[0].age_years, 45);
});

test('radiación: dosis GCR acumulada y fracción del límite de carrera', () => {
    const m = resolveMember({ id: 'a', cumulative_career_dose_msv: 300 }, CFG);
    const next = advanceMemberState({ walking_time_h: 2, slope_deg: 0, surface_distance_m: 5000, walk_speed_ms: 0.7 }, initMemberState(m, CFG), m, CFG);
    assert.ok(Math.abs(next.dose_usv - 55.8) < 1e-9);                     // 27.9 µSv/h × 2 h
    assert.ok(Math.abs(next.career_dose_fraction - (300 + 0.0558) / 600) < 1e-9);
    /* Compatibilidad con configs en mGy */
    const legacy = resolveMember({ id: 'b', cumulative_career_dose_mgy: 100 }, CFG);
    assert.equal(legacy.cumulative_career_dose_msv, 320);
});

test('CO₂: RCA continuo no se agota; cartucho sí', () => {
    const seg = { walking_time_h: 4, slope_deg: 0, surface_distance_m: 10000, walk_speed_ms: 0.7 };
    const m = resolveMember({ id: 'a' }, CFG);
    assert.equal(advanceMemberState(seg, initMemberState(m, CFG), m, CFG).co2_cartridge_used_frac, 0);
    const lioh = { ...CFG, co2_removal: 'cartridge', co2_capacity_l: 300 };
    const r = advanceMemberState(seg, initMemberState(m, lioh), m, lioh);
    assert.ok(r.co2_cartridge_used_frac > 0.85);
    assert.equal(r.flags.co2_cartridge_low, true);
});

test('autonomía de O₂ = O₂ restante / VO₂ actual', () => {
    const m = resolveMember({ id: 'a' }, CFG);
    const r = advanceMemberState({ walking_time_h: 0.1, slope_deg: 0, surface_distance_m: 300, walk_speed_ms: 0.8 }, initMemberState(m, CFG), m, CFG);
    assert.ok(Math.abs(r.o2_time_remaining_min - r.o2_remaining_l / r.vo2_l_min) < 1e-9);
});

test('ritmo sostenible: más lento en cuesta y limitado por el miembro más débil', () => {
    const fit = resolveMember({ id: 'fit', body_mass_kg: 82, age_years: 40, fitness_level: 'fit', sex: 'male' }, CFG);
    const vFlat = sustainableSpeedMs(fit, CFG, 0);
    const vUp = sustainableSpeedMs(fit, CFG, 10);
    assert.ok(vUp < vFlat);
    const m = calculateMetabolicRateW({ body_mass_kg: 82, suit_mass_kg: CFG.suit_mass_kg, suit_true_mass_kg: 170, walk_speed_ms: vFlat, signed_slope_deg: 0, terrain_factor: CFG.terrain_factor }, CFG);
    assert.ok(m.metabolic_rate_w <= fit.physiology.max_sustainable_m_w + 0.5 || vFlat === CFG.walk_speed_ms);

    const h = createGroupHealth([
        { id: 'strong', body_mass_kg: 85, age_years: 35, fitness_level: 'elite', sex: 'male' },
        { id: 'weak', body_mass_kg: 62, age_years: 50, fitness_level: 'low', sex: 'female' },
    ]);
    const pace = groupSustainablePace(h, 0);
    assert.equal(pace.binding_member_id, 'weak');
});

test('ruta: con ritmo sostenible tarda más pero nadie supera su límite en plano', () => {
    const path = [[0, 0], [500, 0], [1000, 0]];
    const flat = () => 0;
    const members = [{ id: 'a', body_mass_kg: 80, age_years: 40, fitness_level: 'fit', sex: 'male' }];
    const fixed = createGroupHealth(members, { route_pace_mode: 'fixed' });
    const sust = createGroupHealth(members, { route_pace_mode: 'sustainable' });
    const rf = simulateRouteMetrics(path, flat, flat, fixed);
    const rs = simulateRouteMetrics(path, flat, flat, sust);
    assert.ok(Math.abs(rf.total_time_h - 1000 / 1.2 / 3600) < 1e-9);
    assert.ok(rs.total_time_h >= rf.total_time_h);
    assert.ok(rs.final_group.members[0].metabolic_fraction_of_max <= 1.0001);
    assert.ok(rs.dose_usv > 0);
});

test('aggregate expone fracciones y autonomía mínima', () => {
    const h = createGroupHealth([{ id: 'a' }, { id: 'b', age_years: 58 }]);
    const agg = aggregateGroupState(advanceGroupState(h, { walking_time_h: 0.05, slope_deg: 5, delta_elev_m: 5, surface_distance_m: 150, walk_speed_ms: 1.0 }));
    assert.ok(agg.max_metabolic_fraction > 0);
    assert.ok(agg.max_hr_fraction > 0);
    assert.ok(Number.isFinite(agg.min_o2_time_remaining_min));
    assert.ok(agg.max_dose_usv > 0);
});

test('ruta: penalización fuerte sobre el límite y peor estado del recorrido', async () => {
    const { metabolicPenalty, worseStatus } = await import('../src/health_route_astar.js');
    assert.equal(metabolicPenalty(0.5), 0.25);
    assert.equal(metabolicPenalty(1), 1);
    assert.ok(metabolicPenalty(1.2) > 2.9);
    assert.equal(worseStatus('nominal', 'elevated'), 'elevated');
    assert.equal(worseStatus('critical', 'nominal'), 'critical');
});

test('catálogo: los 4 trajes son válidos y cambian el modelo', async () => {
    const { SUIT_IDS, tankPressureKpa } = await import('../src/suits.js');
    assert.deepEqual(SUIT_IDS, ['xemu', 'axemu', 'emu', 'orlan']);
    const member = { body_mass_kg: 80, age_years: 40, fitness_level: 'fit', sex: 'male' };
    const pace = {};
    for (const id of SUIT_IDS) {
        const suit = getSuit(id);
        assert.equal(suit.id, id);
        assert.ok(suit.total_mass_kg > 50 && suit.operating_pressure_kpa > 20 && suit.o2_primary_l_equiv > 100);
        assert.ok(suit.sources.length >= 2);
        const ids = suit.components.map((c) => c.id);
        for (const need of ['helmet', 'plss', 'torso', 'dcu', 'gloves', 'lower', 'boots', 'lcvg']) assert.ok(ids.includes(need), `${id} tiene ${need}`);
        for (const c of suit.components) for (const sp of c.specs) assert.ok(['publicado', 'estimado'].includes(sp.conf));
        if (suit.co2_removal === 'cartridge') assert.ok(suit.co2_capacity_l > 0);
        const cfg = resolveHealthConfig({ suit_id: id });
        assert.equal(cfg.suit_true_mass_kg, suit.total_mass_kg);
        assert.equal(cfg.o2_capacity_l_equiv, suit.o2_primary_l_equiv);
        pace[id] = sustainableSpeedMs(resolveMember(member, cfg), cfg, 3);
        assert.equal(tankPressureKpa(suit, suit.o2_primary_l_equiv / 2, suit.o2_primary_l_equiv), suit.o2_primary_pressure_kpa / 2);
    }
    /* Los trajes de microgravedad obligan a ir más lento que los de superficie */
    assert.ok(pace.axemu >= pace.xemu);
    assert.ok(pace.emu < pace.xemu && pace.orlan < pace.xemu);
    /* El EMU satura su cartucho de CO₂ en una EVA larga; el xEMU no */
    const seg = { walking_time_h: 7, slope_deg: 0, surface_distance_m: 9000, walk_speed_ms: 0.4 };
    const run = (id) => { const cfg = resolveHealthConfig({ suit_id: id }); const m = resolveMember(member, cfg); return advanceMemberState(seg, initMemberState(m, cfg), m, cfg); };
    assert.ok(run('emu').co2_cartridge_used_frac > 0.85);
    assert.equal(run('xemu').co2_cartridge_used_frac, 0);
});
