/* Catálogo de trajes EVA y su traducción a parámetros del modelo de salud.
 *
 * Cada spec lleva `conf`:
 *   'publicado' → cifra tomada de una fuente pública (ver `sources`).
 *   'estimado'  → valor de diseño del modelo MarsWalk, razonable pero sin cifra pública exacta.
 * Trajes: xEMU (NASA, base), AxEMU (Axiom), EMU (transbordador/EEI) y Orlan-MKS (Roscosmos).
 */

export const PSI_TO_KPA = 6.894757;

export const SUIT_CATALOG = {
    xemu: {
        id: 'xemu',
        name: 'xEMU',
        full_name: 'Exploration Extravehicular Mobility Unit',
        agency: 'NASA',
        era: 'Artemis (prototipo 2019–2022)',
        designed_for: 'Superficie (Luna / Marte)',
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
        o2_primary_pressure_kpa: 3000 * PSI_TO_KPA, // tanque primario lleno (estimado)
        o2_secondary_pressure_kpa: 3000 * PSI_TO_KPA,
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
                id: 'lower', name: 'Torso inferior (cadera y piernas)',
                description: 'Rodamientos en cadera, muslo y rodilla para caminar, agacharse y arrodillarse.',
                specs: [
                    { label: 'Movilidad', value: 'Cadera y muslo con rodamientos', conf: 'publicado' },
                    { label: 'Factor de movilidad', value: '1.00 (referencia)', conf: 'estimado' },
                ],
                affects: [
                    { param: 'suit_mobility_factor', text: 'La movilidad multiplica el factor de terreno de Pandolf (η).' },
                ],
            },
            {
                id: 'boots', name: 'Botas',
                description: 'Botas de caminata con tobillo flexible y suela de tracción, aisladas contra el suelo frío.',
                specs: [
                    { label: 'Tobillo', value: 'Flexible, tipo bota de montaña', conf: 'publicado' },
                    { label: 'Suela', value: 'Tracción para regolito suelto', conf: 'estimado' },
                ],
                affects: [
                    { param: 'terrain_factor', text: 'El agarre en regolito suelto entra en el factor de terreno η.' },
                    { param: 'max_safe_slope_deg', text: 'La tracción limita la pendiente segura de marcha.' },
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

/* Los demás trajes reutilizan la estructura del xEMU y cambian lo que los distingue. */
function deriveSuit(base, overrides, componentOverrides = {}) {
    const components = base.components.map((c) => {
        const o = componentOverrides[c.id];
        return o ? { ...c, ...o } : c;
    });
    return { ...base, ...overrides, components };
}

const X = SUIT_CATALOG.xemu;

SUIT_CATALOG.axemu = deriveSuit(X, {
    id: 'axemu',
    name: 'AxEMU',
    full_name: 'Axiom Extravehicular Mobility Unit',
    agency: 'Axiom Space / NASA',
    era: 'Artemis III (en certificación)',
    designed_for: 'Superficie lunar (polo sur)',
    summary: 'Evolución comercial del xEMU para el alunizaje de Artemis III: misma arquitectura, más ajuste de tallas '
        + '(cubre al 90 % de la población) y resistencia al frío de las zonas en sombra permanente.',
    total_mass_kg: 160,
    mobility_factor: 0.95,
    sources: [
        { label: 'Axiom Space — Testing of Next-Gen Spacesuit Underway', url: 'https://www.axiomspace.com/news/axemu-spacesuit-testing' },
        { label: 'collectSPACE — Axiom AxEMU reveal', url: 'https://www.collectspace.com/news/news-031523a-axiom-axemu-artemis-astronaut-spacesuit-reveal.html' },
        { label: 'ASME — Axiom Space designs the spacesuit for Artemis III', url: 'https://www.asme.org/topics-resources/content/axiom-space-designs-the-most-advanced-spacesuit-for-artemis-iii' },
    ],
}, {
    plss: {
        specs: [
            { label: 'Masa total del traje', value: 'No publicada · modelo usa 160 kg', conf: 'estimado' },
            { label: 'O₂ primario', value: '580 L equiv. (≥ 8 h)', conf: 'estimado' },
            { label: 'O₂ secundario', value: '30 min de emergencia', conf: 'estimado' },
            { label: 'CO₂', value: 'Eliminación continua (herencia xEMU)', conf: 'estimado' },
            { label: 'Frío extremo', value: '≥ 2 h en sombra permanente', conf: 'publicado' },
        ],
    },
    torso: {
        specs: [
            { label: 'Presión de operación', value: '4.3 psi (29.6 kPa) · modelo', conf: 'estimado' },
            { label: 'Tallas', value: 'Cubre al 90 % de hombres y mujeres', conf: 'publicado' },
        ],
    },
    lower: {
        specs: [
            { label: 'Movilidad', value: 'Articulaciones mejoradas para caminar y arrodillarse', conf: 'publicado' },
            { label: 'Factor de movilidad', value: '0.95 (5 % mejor que xEMU)', conf: 'estimado' },
        ],
    },
});

SUIT_CATALOG.emu = deriveSuit(X, {
    id: 'emu',
    name: 'EMU',
    full_name: 'Extravehicular Mobility Unit (Transbordador / EEI)',
    agency: 'NASA',
    era: '1981 – hoy (Estación Espacial)',
    designed_for: 'Microgravedad (no para caminar)',
    summary: 'El traje de las caminatas espaciales del transbordador y la EEI. Está hecho para flotar: '
        + 'la parte inferior casi no flexiona, así que caminar con él en Marte cuesta mucho más.',
    total_mass_kg: 127,
    operating_pressure_kpa: 4.3 * PSI_TO_KPA,
    max_pressure_kpa: 4.3 * PSI_TO_KPA,
    eva_nominal_h: 7,
    o2_primary_l_equiv: 386,                         // 1.217 lb de O₂ ≈ 386 L en condiciones normales
    o2_secondary_min: 30,
    o2_primary_pressure_kpa: 900 * PSI_TO_KPA,
    o2_secondary_pressure_kpa: 6000 * PSI_TO_KPA,
    co2_removal: 'cartridge',
    co2_capacity_l: 340,                             // cartucho METOX/LiOH ≈ 0.67 kg de CO₂
    cooling: 'Sublimador de agua + LCVG',
    lcvg_efficiency: 0.85,
    potable_water_l: 0.95,                           // bolsa de bebida de 32 oz
    mobility_factor: 1.8,
    pressure_overhead_fraction: 0.35,
    sources: [
        { label: 'NASA NTRS — EMU PLSS (presiones de tanque 900 / 6000 psia)', url: 'https://ntrs.nasa.gov/api/citations/19920007771/downloads/19920007771.pdf' },
        { label: 'HowStuffWorks — How Space Suits Work (EMU)', url: 'https://science.howstuffworks.com/space-suit5.htm' },
        { label: 'NASA NTRS — Regulators, ICES 2023 (cartucho de CO₂)', url: 'https://ntrs.nasa.gov/api/citations/20230008922/downloads/Regulators_ICES2023_Presentation_Final.pdf' },
        { label: 'Wikipedia — Extravehicular Mobility Unit', url: 'https://en.wikipedia.org/wiki/Extravehicular_Mobility_Unit' },
    ],
}, {
    plss: {
        specs: [
            { label: 'Masa total del traje', value: '≈ 127 kg (280 lb)', conf: 'publicado' },
            { label: 'O₂ primario', value: '≈ 386 L · tanque a 900 psi', conf: 'publicado' },
            { label: 'O₂ secundario (SOP)', value: '1.2 kg a 6000 psi · 30 min', conf: 'publicado' },
            { label: 'CO₂', value: 'Cartucho METOX/LiOH · ≈ 340 L de CO₂', conf: 'estimado' },
            { label: 'Enfriamiento', value: 'Sublimador de agua', conf: 'publicado' },
        ],
        affects: [
            { param: 'o2_capacity_l_equiv', text: 'Tanque más pequeño: menos autonomía que el xEMU.' },
            { param: 'suit_mass_kg', text: 'Más ligero que el xEMU: menos carga en el modelo Pandolf.' },
            { param: 'co2', text: 'El cartucho se satura: el CO₂ sí limita la duración de la EVA.' },
        ],
    },
    torso: {
        name: 'Torso duro (HUT) de entrada por la cintura',
        description: 'Torso superior rígido de fibra de vidrio; el traje se cierra por un anillo en la cintura.',
        specs: [
            { label: 'Presión de operación', value: '4.3 psi (29.6 kPa), O₂ puro', conf: 'publicado' },
            { label: 'Autonomía', value: '7 h + 30 min de reserva', conf: 'publicado' },
        ],
    },
    lower: {
        description: 'Diseñado para microgravedad: las piernas apenas flexionan y no hay rodamiento de cadera para caminar.',
        specs: [
            { label: 'Movilidad', value: 'Limitada: pensado para flotar', conf: 'publicado' },
            { label: 'Factor de movilidad', value: '1.80 (80 % más esfuerzo al caminar)', conf: 'estimado' },
        ],
    },
    boots: {
        description: 'Botas para anclarse en reposapiés de la estación, no para caminar sobre regolito.',
        specs: [
            { label: 'Tobillo', value: 'Rígido', conf: 'publicado' },
            { label: 'Suela', value: 'Plana, sin tracción', conf: 'estimado' },
        ],
    },
});

SUIT_CATALOG.orlan = deriveSuit(X, {
    id: 'orlan',
    name: 'Orlan-MKS',
    full_name: 'Orlan-MKS (Орлан-МКС)',
    agency: 'Roscosmos / NPP Zvezda',
    era: '2017 – hoy (segmento ruso de la EEI)',
    designed_for: 'Microgravedad (no para caminar)',
    summary: 'Traje ruso semirrígido: se entra por la mochila, que abre como una puerta. Opera a más presión '
        + 'que los trajes de NASA (menos tiempo de prerrespiración, articulaciones más duras).',
    total_mass_kg: 110,
    operating_pressure_kpa: 40,
    max_pressure_kpa: 40,
    eva_nominal_h: 7,
    o2_primary_l_equiv: 700,                         // botella de ~1 kg de O₂
    o2_secondary_min: 30,
    o2_primary_pressure_kpa: 40000,                  // 40 MPa
    o2_secondary_pressure_kpa: 40000,
    co2_removal: 'cartridge',
    co2_capacity_l: 400,
    cooling: 'Sublimador + control térmico automático',
    lcvg_efficiency: 0.86,
    potable_water_l: 1.0,
    mobility_factor: 1.9,
    pressure_overhead_fraction: 0.40,
    sources: [
        { label: 'RussianSpaceWeb — Orlan-MKS', url: 'https://www.russianspaceweb.com/orlan_mks.html' },
        { label: 'RussianSpaceWeb — Familia Orlan', url: 'https://www.russianspaceweb.com/orlan.html' },
        { label: 'Wikipedia — Orlan space suit', url: 'https://en.wikipedia.org/wiki/Orlan_space_suit' },
    ],
}, {
    plss: {
        name: 'Mochila-escotilla',
        description: 'La mochila es la puerta del traje: abre hacia atrás y contiene el soporte vital.',
        specs: [
            { label: 'Masa total del traje', value: '110 kg', conf: 'publicado' },
            { label: 'Tanques de O₂ (principal y reserva)', value: '40 MPa', conf: 'publicado' },
            { label: 'O₂ primario', value: '≈ 700 L (≈ 1 kg)', conf: 'estimado' },
            { label: 'CO₂', value: 'Cartucho absorbente · ≈ 400 L de CO₂', conf: 'estimado' },
            { label: 'Control térmico', value: 'Automático', conf: 'publicado' },
        ],
        affects: [
            { param: 'o2_capacity_l_equiv', text: 'Botella de alta presión: más O₂ que el EMU.' },
            { param: 'suit_mass_kg', text: 'El más ligero del catálogo: menos carga en Pandolf.' },
            { param: 'co2', text: 'El cartucho se satura: el CO₂ limita la EVA.' },
        ],
    },
    torso: {
        name: 'Torso rígido de aluminio',
        description: 'Cuerpo rígido de una pieza con el casco integrado; talla única ajustable.',
        specs: [
            { label: 'Presión de operación', value: '400 hPa (40 kPa · 5.8 psi)', conf: 'publicado' },
            { label: 'Autonomía', value: '7 h', conf: 'publicado' },
        ],
        affects: [
            { param: 'suit_pressure_kpa', text: 'Más presión que los trajes de NASA: articulaciones más duras (40 % de sobrecoste).' },
        ],
    },
    helmet: {
        description: 'Casco integrado al torso (no gira con la cabeza), con visor solar y luces.',
        specs: [
            { label: 'Tipo', value: 'Integrado al torso rígido', conf: 'publicado' },
            { label: 'Visor solar', value: 'Filtro dorado abatible', conf: 'publicado' },
        ],
    },
    lower: {
        description: 'Piernas blandas pensadas para microgravedad; sin rodamientos de cadera para caminar.',
        specs: [
            { label: 'Movilidad', value: 'Limitada: pensado para flotar', conf: 'publicado' },
            { label: 'Factor de movilidad', value: '1.90 (90 % más esfuerzo al caminar)', conf: 'estimado' },
        ],
    },
    boots: {
        description: 'Botas blandas para sujetarse en la estación, no para regolito.',
        specs: [
            { label: 'Tobillo', value: 'Blando, sin soporte de marcha', conf: 'estimado' },
            { label: 'Suela', value: 'Plana', conf: 'estimado' },
        ],
    },
});

export const SUIT_IDS = ['xemu', 'axemu', 'emu', 'orlan'];

export const DEFAULT_SUIT_ID = 'xemu';

export function getSuit(id) {
    return SUIT_CATALOG[id] || SUIT_CATALOG[DEFAULT_SUIT_ID];
}

/* Presión del tanque primario: gas ideal a temperatura constante → proporcional al O₂ restante */
export function tankPressureKpa(suit, o2_remaining_l, o2_capacity_l) {
    if (!o2_capacity_l) return 0;
    return suit.o2_primary_pressure_kpa * Math.max(0, Math.min(1, o2_remaining_l / o2_capacity_l));
}

const STORAGE_KEY_SUIT = 'marswalk_suit';
export function loadSuitPreference() {
    try {
        const id = globalThis.localStorage?.getItem(STORAGE_KEY_SUIT);
        return SUIT_CATALOG[id] ? id : null;
    } catch {
        return null;
    }
}
export function saveSuitPreference(id) {
    try { if (SUIT_CATALOG[id]) globalThis.localStorage?.setItem(STORAGE_KEY_SUIT, id); } catch { /* sin almacenamiento */ }
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
