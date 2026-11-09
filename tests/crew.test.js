import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ROLES, CREW_MAX, generateCrew, makeRng, sanitizeMember, sanitizeCrew, buildHealthFromCrew,
} from '../src/crew.js';
import { advanceGroupState, groupSustainablePace } from '../src/health_group.js';

test('generateCrew: tamaño, campos válidos, nombres e ids únicos', () => {
    const crew = generateCrew(6, makeRng(7));
    assert.equal(crew.length, 6);
    assert.equal(new Set(crew.map((m) => m.id)).size, 6);
    assert.equal(new Set(crew.map((m) => m.name)).size, 6);
    for (const m of crew) {
        assert.ok(ROLES[m.role]);
        assert.ok(m.age_years >= 30 && m.age_years <= 55);
        assert.ok(m.body_mass_kg >= 54 && m.body_mass_kg <= 95);
        assert.ok(['nominal', 'fit', 'elite'].includes(m.fitness_level));
        assert.ok(['female', 'male'].includes(m.sex));
    }
    assert.equal(crew[0].role, 'commander');
});

test('generateCrew: misma semilla → misma tripulación; tamaño acotado', () => {
    assert.deepEqual(generateCrew(4, makeRng(42)), generateCrew(4, makeRng(42)));
    assert.equal(generateCrew(99, makeRng(1)).length, CREW_MAX);
    assert.equal(generateCrew(0, makeRng(1)).length, 3);
});

test('sanitizeMember: acota rangos y repara valores inválidos', () => {
    const m = sanitizeMember({ name: '  ', role: 'pirata', sex: '?', fitness_level: 'x', age_years: 5, body_mass_kg: 999, cumulative_career_dose_msv: -4 }, 1);
    assert.equal(m.age_years, 25);
    assert.equal(m.body_mass_kg, 120);
    assert.equal(m.cumulative_career_dose_msv, 0);
    assert.equal(m.sex, 'unspecified');
    assert.equal(m.fitness_level, 'fit');
    assert.ok(ROLES[m.role]);
    assert.ok(m.name.length > 0);
    assert.equal(sanitizeMember({ age_years: 'abc' }).age_years, 40);
    /* roles e unidades de configs antiguos */
    assert.equal(sanitizeMember({ role: 'mission_spec' }).role, 'geologist');
    assert.equal(sanitizeMember({ cumulative_career_dose_mgy: 100 }).cumulative_career_dose_msv, 320);
});

test('sanitizeCrew: ids duplicados se separan y se respeta el máximo', () => {
    const crew = sanitizeCrew(Array.from({ length: 9 }, () => ({ id: 'a' })));
    assert.equal(crew.length, CREW_MAX);
    assert.equal(new Set(crew.map((m) => m.id)).size, CREW_MAX);
    assert.deepEqual(sanitizeCrew(null), []);
});

test('buildHealthFromCrew: solo usa al miembro 0; grupo usa a todos', () => {
    const crew = generateCrew(4, makeRng(3));
    const solo = buildHealthFromCrew('solo', crew);
    assert.equal(solo.mode, 'solo');
    assert.equal(solo.members.length, 1);
    assert.equal(solo.members[0].id, crew[0].id);
    assert.equal(solo.members[0].body_mass_kg, crew[0].body_mass_kg);
    const group = buildHealthFromCrew('group', crew);
    assert.equal(group.mode, 'group');
    assert.deepEqual(group.members.map((m) => m.name), crew.map((m) => m.name));
    /* un solo miembro no puede ser grupo */
    assert.equal(buildHealthFromCrew('group', crew.slice(0, 1)).mode, 'solo');
});

test('editar la tripulación cambia el modelo: el ritmo lo fija el miembro más limitado', () => {
    const crew = [
        { id: 'a', name: 'A', role: 'commander', sex: 'male', age_years: 32, body_mass_kg: 80, fitness_level: 'elite' },
        { id: 'b', name: 'B', role: 'pilot', sex: 'male', age_years: 32, body_mass_kg: 80, fitness_level: 'elite' },
    ];
    const fast = groupSustainablePace(buildHealthFromCrew('group', crew), 5);
    crew[1] = { ...crew[1], age_years: 62, fitness_level: 'low', sex: 'female', body_mass_kg: 55 };
    const slow = groupSustainablePace(buildHealthFromCrew('group', crew), 5);
    assert.ok(slow.pace_ms < fast.pace_ms);
    assert.equal(slow.binding_member_id, 'b');
});

test('editar conserva lo consumido por quien sigue en la tripulación', () => {
    const crew = generateCrew(3, makeRng(5));
    let h = buildHealthFromCrew('group', crew);
    h = advanceGroupState(h, { walking_time_h: 1, slope_deg: 3, delta_elev_m: 20, surface_distance_m: 2500, walk_speed_ms: 0.7 });
    const usedBefore = h.members[1].o2_consumed_l_total;
    assert.ok(usedBefore > 0);
    const edited = crew.map((m, i) => (i === 1 ? { ...m, name: 'Renombrado' } : m)).slice(0, 2);
    const h2 = buildHealthFromCrew('group', edited, {}, h);
    assert.equal(h2.members.length, 2);
    assert.equal(h2.members[1].name, 'Renombrado');
    assert.equal(h2.members[1].o2_consumed_l_total, usedBefore);
    assert.ok(h2.members[1].o2_remaining_l < h2.members[1].o2_capacity_l_equiv);
    /* sin prev → tanques llenos */
    assert.equal(buildHealthFromCrew('group', edited).members[1].o2_consumed_l_total, 0);
});
