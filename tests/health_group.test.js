import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSoloHealth, createGroupHealth, advanceGroupState, aggregateGroupState,
} from '../src/health_group.js';

const SEG = { walking_time_h: 0.25, slope_deg: 4, delta_elev_m: 15, surface_distance_m: 300, walk_speed_ms: 1.2 };

test('solo mode: exactly 1 member, no rotation', () => {
    const h = createSoloHealth();
    assert.equal(h.mode, 'solo');
    assert.equal(h.members.length, 1);
    const after = advanceGroupState(h, SEG);
    assert.equal(after.leaderIndex, 0);
    assert.equal(after.totalRotations, 0);
});

test('group mode: 3 members by default', () => {
    const h = createGroupHealth();
    assert.equal(h.members.length, 3);
    assert.equal(h.mode, 'group');
});

test('group mode: leader rotates every 20 min', () => {
    const h = createGroupHealth();
    const after = advanceGroupState(h, { walking_time_h: 25 / 60, slope_deg: 2, delta_elev_m: 5, surface_distance_m: 300, walk_speed_ms: 1.2 });
    assert.equal(after.totalRotations, 1);
    assert.equal(after.leaderIndex, 1);
});

test('group mode: leader gets higher HR than followers', () => {
    const h = createGroupHealth();
    const after = advanceGroupState(h, SEG);
    const leader = after.members[after.leaderIndex];
    const followers = after.members.filter((_, i) => i !== after.leaderIndex);
    assert.ok(leader.heart_rate_bpm >= Math.max(...followers.map(f => f.heart_rate_bpm)));
});

test('aggregateGroupState: binding members per dimension', () => {
    const h = createGroupHealth([
        { id: 'heavy', body_mass_kg: 100, age_years: 40 },
        { id: 'light', body_mass_kg: 60, age_years: 40 },
        { id: 'old', body_mass_kg: 75, age_years: 60 },
    ]);
    const seeded = { ...h, _smoothed: { slope_deg: 4, walk_speed_ms: 1.2 } };
    const movingSegment = { ...SEG, walk_speed_ms: 1.2 };
    const after = advanceGroupState(seeded, movingSegment);
    const agg = aggregateGroupState(after);
    /* G3.1: el limitante metabólico es el de mayor esfuerzo RELATIVO a su capacidad
     * (60 años → menor VO₂máx), aunque el más pesado gaste más watts y más O₂ */
    assert.equal(agg.binding_member_metabolic, 'old');
    assert.equal(agg.binding_member_o2, 'heavy');
    const heavy = agg.members.find((m) => m.id === 'heavy');
    assert.equal(agg.max_metabolic_w, heavy.metabolic_rate_w);
});

test('aggregateGroupState: flags propagate to status', () => {
    const h = createGroupHealth([{ id: 'a', o2_capacity_l_equiv: 60 }]);
    const after = advanceGroupState(h, { walking_time_h: 5, slope_deg: 15, delta_elev_m: 300, surface_distance_m: 2000, walk_speed_ms: 1.2 });
    const agg = aggregateGroupState(after);
    /* G2 reescribió status: 'critical' ahora agrupa o2_depleted + thermal_critical + dehydration_critical */
    assert.ok(['critical', 'critical_o2', 'at_risk_over_sustainable'].includes(agg.status));
});

test('aggregateGroupState: solo mode reports leader as solo', () => {
    const h = createSoloHealth();
    const after = advanceGroupState(h, SEG);
    const agg = aggregateGroupState(after);
    assert.equal(agg.mode, 'solo');
    assert.equal(agg.members[0].nav_role, 'solo');
});

test('sum_o2_consumed_l is additive, min_o2_remaining is not', () => {
    const h = createGroupHealth();
    const after = advanceGroupState(h, SEG);
    const agg = aggregateGroupState(after);
    assert.ok(agg.sum_o2_consumed_l > 0);
    assert.ok(agg.min_o2_remaining_l < 580);
    assert.ok(agg.sum_o2_consumed_l === after.members.reduce((s, m) => s + m.o2_consumed_l_total, 0));
});

test('advanceGroupState smooths slope between frames (HUD jitter fix)', () => {
    const h = createGroupHealth();
    const flat = { walking_time_h: 0.016, slope_deg: 0, delta_elev_m: 0, surface_distance_m: 0.02, walk_speed_ms: 1.2 };
    const steep = { walking_time_h: 0.016, slope_deg: 25, delta_elev_m: 0.1, surface_distance_m: 0.02, walk_speed_ms: 1.2 };

    let s = advanceGroupState(h, flat);
    s = advanceGroupState(s, steep);

    assert.ok(s._smoothed.slope_deg > 0);
    assert.ok(s._smoothed.slope_deg < 10, `esperado suavizado < 10°, recibido ${s._smoothed.slope_deg}`);

    for (let i = 0; i < 60; i++) s = advanceGroupState(s, steep);
    assert.ok(s._smoothed.slope_deg > 20, `esperado convergido > 20°, recibido ${s._smoothed.slope_deg}`);
});

test('advanceGroupState zeroes slope when standing still', () => {
    const h = createGroupHealth();
    const moving = { walking_time_h: 0.016, slope_deg: 20, delta_elev_m: 0.1, surface_distance_m: 0.02, walk_speed_ms: 1.2 };
    const still = { walking_time_h: 0.016, slope_deg: 20, delta_elev_m: 0, surface_distance_m: 0, walk_speed_ms: 0 };

    let s = advanceGroupState(h, moving);
    s = advanceGroupState(s, still);
    assert.equal(s._smoothed.slope_deg, 0);
    assert.equal(s._smoothed.walk_speed_ms, 0);
});