/* Panel "Tripulación": interruptor Solo/Grupo, generador y editor de astronautas.
 * Cada cambio reconstruye state.health, se guarda en el navegador y actualiza a los compañeros 3D. */

import { state } from './state.js';
import {
  ROLES, FITNESS_LEVELS, SEXES, LIMITS, CREW_MIN, CREW_MAX,
  generateCrew, generateMember, makeRng, sanitizeCrew, saveCrew, buildHealthFromCrew,
} from './crew.js';
import { groupSustainablePace, aggregateGroupState, saveHealthModePreference } from './health_group.js';
import { sustainableSpeedMs } from './health.js';
import { syncCrewFollowers } from './crew_followers.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function options(map, selected, labelOf = (v) => v) {
  return Object.entries(map).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(labelOf(v))}</option>`).join('');
}

/* Aplica state.crew + state.healthMode al modelo y a todo lo que depende de él */
export function applyCrew({ keepProgress = true } = {}) {
  state.crew = sanitizeCrew(state.crew);
  if (state.crew.length < 2) state.healthMode = 'solo';
  state.health = buildHealthFromCrew(state.healthMode, state.crew, state.healthCfgOverrides || {}, keepProgress ? state.health : null);
  state.healthLastAggregate = aggregateGroupState(state.health);
  saveCrew(state.crew);
  saveHealthModePreference(state.healthMode);
  syncCrewFollowers();
  /* Las rutas ya calculadas con la tripulación anterior quedan desactualizadas */
  if (state.routeComparison) {
    const st = $('hrc-status');
    if (st) st.textContent = '↻ Tripulación cambió · recalcula';
  }
  renderSummary();
}

function memberStats(m) {
  const hm = state.health?.members.find((x) => x.id === m.id);
  if (!hm?.physiology) return '';
  const p = hm.physiology;
  const v = sustainableSpeedMs(hm, state.health.cfg, 0);
  return `VO₂máx ${p.vo2max_ml_kg_min.toFixed(0)} mL/kg/min · FCmáx ${p.hr_max_bpm.toFixed(0)} · sostiene ${p.max_sustainable_m_w.toFixed(0)} W · plano ${v.toFixed(2)} m/s`;
}

function renderSummary() {
  const isGroup = state.healthMode === 'group';
  const meta = $('crew-meta');
  if (meta) meta.textContent = isGroup ? `Grupo · ${state.crew.length}` : 'Solo';

  const sumEl = $('crew-summary');
  if (sumEl && state.health) {
    const pace = groupSustainablePace(state.health, 0);
    const binding = state.health.members.find((m) => m.id === pace.binding_member_id);
    const cfg = state.health.cfg;
    const limited = binding ? ` · limita <b>${esc(binding.name || binding.id)}</b>` : ' · nadie limitado';
    sumEl.innerHTML = `Ritmo ${isGroup ? 'del grupo' : ''} en plano: <b>${pace.pace_ms.toFixed(2)} m/s</b> de ${cfg.walk_speed_ms.toFixed(1)}${limited}<br>`
      + `Traje ${esc((cfg.suit_id || '').toUpperCase())}: ${cfg.suit_true_mass_kg ?? '—'} kg · O₂ ${cfg.o2_capacity_l_equiv} L por traje`;
  }

  document.querySelectorAll('#crew-list .crew-card').forEach((card) => {
    const m = state.crew.find((x) => x.id === card.dataset.id);
    const statsEl = card.querySelector('.crew-stats');
    if (m && statsEl) statsEl.textContent = memberStats(m);
  });
}

function renderList() {
  const list = $('crew-list');
  if (!list) return;
  const isGroup = state.healthMode === 'group';
  const shown = isGroup ? state.crew : state.crew.slice(0, 1);
  list.innerHTML = shown.map((m, i) => `
    <div class="crew-card" data-id="${esc(m.id)}" style="--role-color:${ROLES[m.role].color}">
      <div class="crew-card-head">
        <span class="crew-badge" title="${i === 0 ? 'Tú (jugador)' : 'Compañero'}">${i === 0 ? 'TÚ' : ROLES[m.role].short}</span>
        <input class="crew-input crew-name" data-field="name" type="text" maxlength="28" value="${esc(m.name)}" aria-label="Nombre" />
        ${isGroup && state.crew.length > CREW_MIN ? `<button class="crew-del" type="button" data-action="remove" title="Quitar de la tripulación" aria-label="Quitar a ${esc(m.name)}">✕</button>` : ''}
      </div>
      <div class="crew-grid">
        <label>Rol<select class="crew-input" data-field="role">${options(ROLES, m.role, (r) => r.label)}</select></label>
        <label>Sexo<select class="crew-input" data-field="sex">${options(SEXES, m.sex)}</select></label>
        <label>Edad<input class="crew-input" data-field="age_years" type="number" min="${LIMITS.age_years[0]}" max="${LIMITS.age_years[1]}" value="${m.age_years}" /></label>
        <label>Masa kg<input class="crew-input" data-field="body_mass_kg" type="number" min="${LIMITS.body_mass_kg[0]}" max="${LIMITS.body_mass_kg[1]}" value="${m.body_mass_kg}" /></label>
        <label>Condición<select class="crew-input" data-field="fitness_level">${options(FITNESS_LEVELS, m.fitness_level)}</select></label>
        <label title="Dosis de radiación acumulada en misiones previas">Dosis mSv<input class="crew-input" data-field="cumulative_career_dose_msv" type="number" min="0" max="600" step="10" value="${m.cumulative_career_dose_msv}" /></label>
      </div>
      <div class="crew-stats"></div>
    </div>`).join('');

  $('crew-mode-solo')?.classList.toggle('active', !isGroup);
  $('crew-mode-group')?.classList.toggle('active', isGroup);
  const groupTools = $('crew-group-tools');
  if (groupTools) groupTools.hidden = !isGroup;
  const addBtn = $('crew-add-btn');
  if (addBtn) addBtn.disabled = state.crew.length >= CREW_MAX;
  const sizeSel = $('crew-size');
  if (sizeSel) sizeSel.value = String(Math.max(CREW_MIN, state.crew.length));
  renderSummary();
}

function setMode(mode) {
  state.healthMode = mode;
  if (mode === 'group' && state.crew.length < CREW_MIN) {
    const rng = makeRng();
    const used = new Set(state.crew.map((m) => m.name));
    while (state.crew.length < 3) state.crew.push(generateMember(rng, state.crew.length, used));
  }
  applyCrew();
  renderList();
}

export function initCrewUI() {
  const list = $('crew-list');
  if (!list) return;

  const sizeSel = $('crew-size');
  if (sizeSel) {
    sizeSel.innerHTML = Array.from({ length: CREW_MAX - CREW_MIN + 1 }, (_, i) => `<option value="${i + CREW_MIN}">${i + CREW_MIN}</option>`).join('');
  }

  $('crew-mode-solo')?.addEventListener('click', () => setMode('solo'));
  $('crew-mode-group')?.addEventListener('click', () => setMode('group'));

  $('crew-generate-btn')?.addEventListener('click', () => {
    state.crew = generateCrew(Number(sizeSel?.value) || 3);
    state.healthMode = 'group';
    applyCrew({ keepProgress: false });
    renderList();
  });

  $('crew-add-btn')?.addEventListener('click', () => {
    if (state.crew.length >= CREW_MAX) return;
    const used = new Set(state.crew.map((m) => m.name));
    state.crew.push(generateMember(makeRng(), state.crew.length, used));
    applyCrew();
    renderList();
  });

  /* Edición: se aplica al confirmar el campo (change), no en cada tecla */
  list.addEventListener('change', (e) => {
    const input = e.target.closest('[data-field]');
    const card = e.target.closest('.crew-card');
    if (!input || !card) return;
    const m = state.crew.find((x) => x.id === card.dataset.id);
    if (!m) return;
    m[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value;
    applyCrew();
    /* Reflejar el valor saneado (límites) y el color/etiqueta del rol */
    const clean = state.crew.find((x) => x.id === card.dataset.id);
    if (clean) {
      input.value = clean[input.dataset.field];
      if (input.dataset.field === 'role') renderList();
    }
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    const card = e.target.closest('.crew-card');
    if (!btn || !card || state.crew.length <= CREW_MIN) return;
    state.crew = state.crew.filter((m) => m.id !== card.dataset.id);
    applyCrew();
    renderList();
  });

  renderList();
}
