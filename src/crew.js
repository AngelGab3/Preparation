/* Tripulación EVA: roles, generador, validación y persistencia.
 * Módulo puro (sin DOM ni Three.js) para poder probarlo con node --test.
 * El miembro 0 es el jugador; en modo solo es el único que camina. */

import { createGroupHealth, createSoloHealth } from './health_group.js';

export const CREW_MIN = 2;
export const CREW_MAX = 6;
const STORAGE_KEY_CREW = 'marswalk_crew';

export const ROLES = {
    commander: { label: 'Comandante', short: 'CDR', color: '#ff6a3d' },
    pilot: { label: 'Piloto', short: 'PLT', color: '#66fcf1' },
    geologist: { label: 'Geología', short: 'GEO', color: '#f6c945' },
    medic: { label: 'Medicina', short: 'MED', color: '#55f29b' },
    engineer: { label: 'Ingeniería', short: 'ENG', color: '#b48cff' },
    biologist: { label: 'Astrobiología', short: 'BIO', color: '#ff8fc7' },
};
export const ROLE_IDS = Object.keys(ROLES);
/* Roles de configs antiguos */
const ROLE_ALIASES = { leader: 'commander', mission_spec: 'geologist', follower: 'engineer' };

export const FITNESS_LEVELS = { low: 'Baja', nominal: 'Media', fit: 'Alta', elite: 'Élite' };
export const SEXES = { female: 'Mujer', male: 'Hombre', unspecified: 'Sin especificar' };

export const LIMITS = {
    age_years: [25, 65],
    body_mass_kg: [45, 120],
    cumulative_career_dose_msv: [0, 600],
};

const NAMES = {
    female: ['Valentina', 'Sofía', 'Mariana', 'Camila', 'Ximena', 'Elena', 'Aiko', 'Nadia', 'Ingrid', 'Zuri', 'Leila', 'Renata'],
    male: ['Mateo', 'Diego', 'Emilio', 'Andrés', 'Rodolfo', 'Kenji', 'Tariq', 'Lars', 'Kwame', 'Iván', 'Joaquín', 'Samuel'],
};
const SURNAMES = ['Ochoa', 'Neri', 'Hernández', 'Chang-Díaz', 'Ríos', 'Tanaka', 'Okafor', 'Lindqvist', 'Haddad', 'Moreno', 'Castillo', 'Vega', 'Salazar', 'Iwata', 'Mendoza', 'Petrova'];

/* PRNG determinista (mulberry32) para que una semilla genere siempre la misma tripulación */
export function makeRng(seed = Date.now()) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = (v, [lo, hi], fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function sanitizeMember(m = {}, index = 0) {
    const role = ROLES[m.role] ? m.role : (ROLE_ALIASES[m.role] || ROLE_IDS[index % ROLE_IDS.length]);
    const sex = SEXES[m.sex] ? m.sex : 'unspecified';
    const fitness_level = FITNESS_LEVELS[m.fitness_level] ? m.fitness_level : 'fit';
    const name = String(m.name ?? '').trim().slice(0, 28) || `${ROLES[role].label} ${index + 1}`;
    const out = {
        id: String(m.id || `crew_${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || `crew_${index}`,
        name, role, sex, fitness_level,
        age_years: Math.round(clamp(m.age_years, LIMITS.age_years, 40)),
        body_mass_kg: Math.round(clamp(m.body_mass_kg, LIMITS.body_mass_kg, 75)),
        cumulative_career_dose_msv: Math.round(clamp(m.cumulative_career_dose_msv, LIMITS.cumulative_career_dose_msv, 0)),
    };
    if (m.cumulative_career_dose_msv == null && m.cumulative_career_dose_mgy != null) {
        out.cumulative_career_dose_msv = Math.round(clamp(m.cumulative_career_dose_mgy * 3.2, LIMITS.cumulative_career_dose_msv, 0));
    }
    return out;
}

/* Garantiza lista válida: ids únicos, 1..CREW_MAX miembros */
export function sanitizeCrew(list) {
    const src = Array.isArray(list) ? list.slice(0, CREW_MAX) : [];
    const seen = new Set();
    return src.map((m, i) => {
        const clean = sanitizeMember(m, i);
        let id = clean.id, k = 2;
        while (seen.has(id)) id = `${clean.id}_${k++}`;
        seen.add(id);
        return { ...clean, id };
    });
}

export function generateMember(rng, index, usedNames = new Set()) {
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const sex = rng() < 0.5 ? 'female' : 'male';
    let name = '';
    for (let tries = 0; tries < 20; tries++) {
        name = `${pick(NAMES[sex])} ${pick(SURNAMES)}`;
        if (!usedNames.has(name)) break;
    }
    usedNames.add(name);
    const fitRoll = rng();
    /* Astronautas seleccionados: mayoría en forma alta */
    const fitness_level = fitRoll < 0.15 ? 'nominal' : fitRoll < 0.8 ? 'fit' : 'elite';
    const [massLo, massHi] = sex === 'female' ? [54, 78] : [66, 95];
    return sanitizeMember({
        id: `crew_${index}_${Math.floor(rng() * 1e6).toString(36)}`,
        name, sex, fitness_level,
        role: ROLE_IDS[index % ROLE_IDS.length],
        age_years: 30 + Math.floor(rng() * 26),             // 30–55
        body_mass_kg: massLo + Math.floor(rng() * (massHi - massLo + 1)),
        cumulative_career_dose_msv: Math.floor(rng() * 5) * 40, // 0–160 mSv de misiones previas
    }, index);
}

export function generateCrew(size = 3, rng = makeRng()) {
    const n = Math.max(1, Math.min(CREW_MAX, Math.round(size) || 3));
    const used = new Set();
    return Array.from({ length: n }, (_, i) => generateMember(rng, i, used));
}

/* ------------------------------------------------------------ persistencia */
function storage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

export function loadCrew() {
    try {
        const raw = storage()?.getItem(STORAGE_KEY_CREW);
        if (!raw) return null;
        const crew = sanitizeCrew(JSON.parse(raw));
        return crew.length ? crew : null;
    } catch {
        return null;
    }
}

export function saveCrew(crew) {
    try { storage()?.setItem(STORAGE_KEY_CREW, JSON.stringify(sanitizeCrew(crew))); } catch { /* almacenamiento no disponible */ }
}

export function clearSavedCrew() {
    try { storage()?.removeItem(STORAGE_KEY_CREW); } catch { /* nada que borrar */ }
}

/* ------------------------------------------------------------ salud */
const CARRY_KEYS = [
    'o2_remaining_l', 'o2_consumed_l_total', 'energy_kj_total', 'total_time_h', 'total_distance_m',
    't_core_c', 'hydration_deficit_l', 'dehydration_pct_body_mass', 'dose_usv', 'co2_produced_l_total',
];

/* Construye el estado de salud desde la tripulación. Si se pasa `prev`, los miembros que siguen
 * (mismo id) conservan lo ya consumido en la EVA: editar un nombre no recarga el tanque. */
export function buildHealthFromCrew(mode, crew, cfgOverrides = {}, prev = null) {
    const clean = sanitizeCrew(crew);
    const health = mode === 'group' && clean.length > 1
        ? createGroupHealth(clean, cfgOverrides)
        : createSoloHealth(cfgOverrides, clean[0] || {});
    if (prev?.members) {
        const prevById = new Map(prev.members.map((m) => [m.id, m]));
        health.members = health.members.map((m) => {
            const old = prevById.get(m.id);
            if (!old) return m;
            const carried = {};
            for (const k of CARRY_KEYS) if (old[k] != null) carried[k] = old[k];
            if (carried.o2_remaining_l != null) carried.o2_remaining_l = Math.min(carried.o2_remaining_l, m.o2_capacity_l_equiv);
            return { ...m, ...carried };
        });
    }
    return health;
}
