/* Catálogo de trajes EVA y su traducción a parámetros del modelo de salud.
 *
 * Cada spec lleva `conf`:
 *   'publicado' → cifra tomada de una fuente pública (ver `sources`).
 *   'estimado'  → valor de diseño del modelo MarsWalk, razonable pero sin cifra pública exacta.
 * El catálogo empieza con el xEMU de NASA; F3 agrega el resto de trajes seleccionables.
 */

export const PSI_TO_KPA = 6.894757;

export const SUIT_CATALOG = {
    xemu: {
        id: 'xemu',
        name: 'xEMU',
        full_name: 'Exploration Extravehicular Mobility Unit',
        agency: 'NASA',
        era: 'Artemis (prototipo 2019–2022)',
        summary: 'Traje de exploración de NASA para superficie lunar/planetaria: entrada trasera, '
            + 'rodamientos en cadera y tobillo para caminar, eliminación continua de CO₂ y enfriamiento por evaporación.',

        /* --- Parámetros globales que alimentan el modelo --- */
        total_mass_kg: 170,
        operating_pressure_kpa: 4.3 * PSI_TO_KPA,   // 29.6 kPa, O₂ puro
        max_pressure_kpa: 8.2 * PSI_TO_KPA,         // 56.5 kPa, diseño del pressure garment
        atmosphere: '100 % O₂',
        eva_nominal_h: 8,
        o2_primary_l_equiv: 580,                    // equivalente del modelo: 8 h + margen
        o2_secondary_min: 30,                       // reserva de emergencia
        co2_removal: 'continuous',                  // RCA: lechos de amina alternos, sin límite por CO₂
        co2_capacity_l: null,
        cooling: 'SWME (evaporación de agua) + LCVG',
        lcvg_efficiency: 0.85,
        potable_water_l: 2.0,
        mobility_factor: 1.0,                       // multiplicador sobre terrain_factor (1 = referencia)
        pressure_overhead_fraction: 0.30,           // coste extra de mover articulaciones presurizadas

        components: [
            {
                id: 'helmet', name: 'Casco y visor',
                description: 'Burbuja de policarbonato con conjunto de visores (protector UV/IR dorado), luces y cámara HD.',
                specs: [
                    { label: 'Burbuja', value: 'Policarbonato, campo de visión amplio', conf: 'publicado' },
                    { label: 'Visor solar', value: 'Recubrimiento de oro (UV/IR)', conf: 'publicado' },
                    { label: 'Masa del conjunto', value: '≈ 6 kg', conf: 'estimado' },
                ],
                affects: [
                    { param: 'thermal', text: 'El visor reduce la carga solar sobre la cabeza; el modelo lo absorbe en la eficiencia térmica.' },
                ],
            },
            {
                id: 'plss', name: 'Mochila PLSS',
                description: 'Portable Life Support System: oxígeno, eliminación de CO₂, control térmico, ventilación y telemetría.',
                specs: [
                    { label: 'Masa en seco (sin DCU)', value: '≈ 95 kg (209 lbm)', conf: 'publicado' },
                    { label: 'O₂ primario', value: '580 L equiv. (8 h + margen)', conf: 'estimado' },
                    { label: 'O₂ secundario', value: '30 min de emergencia', conf: 'estimado' },
                    { label: 'CO₂', value: 'Rapid Cycle Amine: continuo, sin límite por CO₂', conf: 'publicado' },
                    { label: 'Enfriamiento', value: 'SWME: evaporación de agua por membrana', conf: 'publicado' },
                ],
                affects: [
                    { param: 'o2_capacity_l_equiv', text: 'Define el O₂ disponible de cada astronauta.' },
                    { param: 'suit_mass_kg', text: 'Es la mayor parte de la carga que el modelo Pandolf suma al cuerpo.' },
                    { param: 'co2', text: 'Con RCA el CO₂ no limita la duración de la EVA.' },
                ],
            },
            {
                id: 'torso', name: 'Torso duro (HUT) de entrada trasera',
                description: 'Torso superior rígido; el astronauta entra por una escotilla trasera donde se acopla la PLSS.',
                specs: [
                    { label: 'Presión de operación', value: '4.3 psi (29.6 kPa), O₂ puro', conf: 'publicado' },
                    { label: 'Presión de diseño', value: '8.2 psi (56.5 kPa)', conf: 'publicado' },
                ],
                affects: [
                    { param: 'suit_pressure_kpa', text: 'A mayor presión, más rígidas las articulaciones: más coste metabólico.' },
                ],
            },
            {
                id: 'dcu', name: 'Unidad de display y control (DCU)',
                description: 'Panel al pecho con controles del traje, alertas y comunicaciones.',
                specs: [
                    { label: 'Funciones', value: 'Control de PLSS, alarmas, radio', conf: 'publicado' },
                ],
                affects: [
                    { param: 'alerts', text: 'Muestra al astronauta las banderas del modelo (O₂ bajo, FC alta, térmico).' },
                ],
            },
            {
                id: 'gloves', name: 'Guantes',
                description: 'Guantes presurizados con palma reforzada; el trabajo manual cansa antebrazos y manos.',
                specs: [
                    { label: 'Calefacción', value: 'Puntas de dedos calefactadas', conf: 'estimado' },
                ],
                affects: [
                    { param: 'not_modeled', text: 'La fatiga de manos no está en el modelo (sin fuente cuantitativa).' },
                ],
            },
            {
                id: 'lower', name: 'Torso inferior y botas',
                description: 'Rodamientos en cadera, muslo y tobillo para caminar y arrodillarse; botas con suela de tracción.',
                specs: [
                    { label: 'Movilidad', value: 'Cadera y tobillo con rodamientos', conf: 'publicado' },
                    { label: 'Factor de movilidad', value: '1.00 (referencia)', conf: 'estimado' },
                ],
                affects: [
                    { param: 'terrain_factor', text: 'La movilidad multiplica el factor de terreno de Pandolf (η).' },
                ],
            },
            {
                id: 'lcvg', name: 'Prenda de enfriamiento (LCVG)',
                description: 'Prenda interior con tubos de agua que retira el calor del cuerpo.',
                specs: [
                    { label: 'Eficiencia de retiro de calor', value: '85 %', conf: 'estimado' },
                ],
                affects: [
                    { param: 'thermal_lcvg_efficiency', text: 'Controla cuánto sube la temperatura corporal.' },
                ],
            },
        ],

        sources: [
            { label: 'NASA NTRS — Mars Mass, ICES 2026 (masa xEMU y PLSS)', url: 'https://ntrs.nasa.gov/citations/20260003038' },
            { label: 'Universe Today — Martian space suits will need to be 40% lighter', url: 'https://www.universetoday.com/articles/martian-space-suits-will-need-to-be-40-lighter' },
            { label: 'NASA NTRS — xEMU Testing Overview, ICES 2024', url: 'https://ntrs.nasa.gov/api/citations/20240007384/downloads/xEMU%20Testing%20Overview%20ICES%20Updated1.pdf' },
            { label: 'Aerospace America — Inside NASA\'s moon suit plan (RCA)', url: 'https://aerospaceamerica.aiaa.org/departments/inside-nasas-moon-suit-plan/' },
        ],
    },
};

export const DEFAULT_SUIT_ID = 'xemu';

export function getSuit(id) {
    return SUIT_CATALOG[id] || SUIT_CATALOG[DEFAULT_SUIT_ID];
}

/* Traduce un traje a overrides del modelo de salud.
 * suit_mass_kg es la carga equivalente Tierra para Pandolf (masa × g_Marte/g_Tierra);
 * suit_true_mass_kg es la masa real, usada para el trabajo vertical en modo 'split'. */
export function suitToHealthOverrides(suit, gravity_ms2 = 3.71, gravity_earth_ms2 = 9.81) {
    const gRatio = gravity_ms2 / gravity_earth_ms2;
    return {
        suit_id: suit.id,
        suit_true_mass_kg: suit.total_mass_kg,
        suit_mass_kg: suit.total_mass_kg * gRatio,
        suit_pressure_kpa: suit.operating_pressure_kpa,
        suit_pressure_overhead_fraction: suit.pressure_overhead_fraction,
        suit_mobility_factor: suit.mobility_factor,
        o2_capacity_l_equiv: suit.o2_primary_l_equiv,
        o2_critical_threshold_l: suit.o2_primary_l_equiv * 0.10,
        o2_secondary_min: suit.o2_secondary_min,
        co2_removal: suit.co2_removal,
        co2_capacity_l: suit.co2_capacity_l,
        thermal_lcvg_efficiency: suit.lcvg_efficiency,
        potable_water_capacity_l: suit.potable_water_l,
    };
}
