/* Copiloto de Misión EVA ARES-AI (Meta Llama 3 vía API Groq / OpenAI compatible + Motor Heurístico Offline) */

import { state } from './state.js';

const STORAGE_KEY_API     = 'marswalk_llama_key';
const STORAGE_KEY_MODEL   = 'marswalk_llama_model';
const STORAGE_KEY_VOICE   = 'marswalk_copilot_voice';
const DEFAULT_MODEL       = 'llama-3.3-70b-versatile';
const GROQ_ENDPOINT       = 'https://api.groq.com/openai/v1/chat/completions';

let voiceEnabled = localStorage.getItem(STORAGE_KEY_VOICE) === '1';
let isThinking   = false;

/* ------------------------------------------- Contexto de Telemetría en Tiempo Real */
export function getCopilotMissionSnapshot() {
  const h  = state.hud || {};
  const w  = state.weather || {};
  const s  = state.solar || {};
  const r  = state.routeAlgorithm === 'qaoa' ? (state.qaoaRoute || state.route) : state.route;
  const px = state.astronautPosition?.x ?? 0;
  const pz = state.astronautPosition?.z ?? 0;

  /* Buscar POI más cercano y refugio más cercano */
  let nearestPOI = null;
  let nearestShelter = null;
  let minPoiDist = Infinity;
  let minShelterDist = Infinity;

  if (Array.isArray(state.pois)) {
    for (const p of state.pois) {
      if (!Array.isArray(p.position_m)) continue;
      const d = Math.hypot(p.position_m[0] - px, p.position_m[1] - pz);
      if (d < minPoiDist) { minPoiDist = d; nearestPOI = p; }
      if (p.type === 'shelter' && d < minShelterDist) { minShelterDist = d; nearestShelter = p; }
    }
  }

  const formatLTST = (hours) => {
    const hh = Math.floor(hours % 24);
    const mm = Math.floor(((hours % 24) - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  return {
    sitio: state.metadata?.label || state.datasetId || 'Jezero Crater',
    coords: `${s.lat_deg ?? 18.38}° N, ${s.lon_deg ?? 77.58}° E`,
    traje_plss: {
      o2_restante_l: Number((h.o2Remaining_l ?? 580).toFixed(1)),
      o2_pct: Math.round(((h.o2Remaining_l ?? 580) / (state.fisio?.o2_reserve_l || 580)) * 100),
      flujo_o2_l_h: Number((h.o2Rate_l_h ?? 50).toFixed(1)),
      velocidad_ms: Number((h.speed_ms ?? 0).toFixed(2)),
      pendiente_actual_deg: Number((h.slope_deg ?? 0).toFixed(1)),
      elevacion_m: Number((h.elev_m ?? 0).toFixed(0)),
      alerta_pendiente: (h.slope_deg ?? 0) > (state.fisio?.max_safe_slope_deg || 25),
    },
    clima_meda: {
      modo: w.mode || 'nominal',
      temp_c: w.temp_c ?? -63,
      viento_ms: w.wind_ms ?? 5.2,
      polvo_tau: w.dust_tau ?? 0.45,
      presion_hpa: w.pressure_hpa ?? 7.4,
      alerta_tormenta: w.mode === 'dust_storm',
    },
    astronomia_solar: {
      ltst: formatLTST(s.ltst_h ?? 10.5),
      fase: s.phase || 'DIA',
      distancia_sol_au: Number((s.distance_au ?? 1.56).toFixed(3)),
      irradiancia_sup_wm2: Number((s.surface_irradiance_wm2 ?? 400).toFixed(0)),
      elevacion_solar_deg: Number((s.elevation_deg ?? 45).toFixed(1)),
    },
    navegacion: {
      algoritmo_ruta: state.routeAlgorithm || 'astar',
      ruta_activa: Boolean(r),
      distancia_ruta_m: r?.metrics?.distance_m ? Math.round(r.metrics.distance_m) : null,
      oxigeno_est_l: r?.metrics?.oxygen_l ? Number(r.metrics.oxygen_l.toFixed(1)) : null,
      pendiente_max_deg: r?.metrics?.max_slope_deg ? Number(r.metrics.max_slope_deg.toFixed(1)) : null,
      refugio_cercano_m: nearestShelter ? Math.round(minShelterDist) : null,
      poi_cercano: nearestPOI ? `${nearestPOI.name} (${Math.round(minPoiDist)} m)` : 'Ninguno',
      muestras_completadas: state.completedPOIs ? state.completedPOIs.size : 0,
    },
  };
}

/* ------------------------------------------- Motor Heurístico Offline (Fallback Inteligente) */
function getOfflineAresResponse(query, snap) {
  const q = query.toLowerCase();
  const o2 = snap.traje_plss.o2_pct;
  const storm = snap.clima_meda.alerta_tormenta;
  const slopeWarn = snap.traje_plss.alerta_pendiente;
  const tau = snap.clima_meda.polvo_tau;
  const temp = snap.clima_meda.temp_c;
  const ltst = snap.astronomia_solar.ltst;

  if (q.includes('seguro') || q.includes('estado') || q.includes('viabilidad') || q.includes('riesgo')) {
    if (storm) {
      return `🚨 ALERTA CRÍTICA CAPCOM: Tormenta de polvo activa (τ = ${tau}, viento ${snap.clima_meda.viento_ms} m/s). Visibilidad < 300 m y sobrecosto térmico +35%. Recomiendo abortar travesía de inmediato y dirigirse al Refugio EVA más cercano a ${snap.navegacion.refugio_cercano_m ?? 120} m.`;
    }
    if (o2 < 25) {
      return `⚠️ PRECAUCIÓN PLSS: Nivel de oxígeno en reserva baja al ${o2}% (${snap.traje_plss.o2_restante_l} L). Tu tasa metabólica actual es ${snap.traje_plss.flujo_o2_l_h} L/h. Da la vuelta inmediatamente hacia el domo hábitat para recarga presurizada.`;
    }
    if (slopeWarn) {
      return `⚠️ ALERTA GEOTÉCNICA: La ladera actual excede los 25° de inclinación segura (${snap.traje_plss.pendiente_actual_deg}°). Riesgo elevado de desprendimiento de regolito y gasto cardíaco. Reajusta tu vector hacia terreno con pendiente menor al 15°.`;
    }
    return `✅ CONDICIONES NOMINALES: Traje PLSS al ${o2}% de O₂, hora marciana ${ltst} LTST e irradiancia ${snap.astronomia_solar.irradiancia_sup_wm2} W/m². Temperatura de ${temp}°C dentro de los límites de tolerancia de las capas térmicas. La caminata es segura.`;
  }

  if (q.includes('clima') || q.includes('tormenta') || q.includes('meda') || q.includes('temperatura')) {
    return `📡 TELEMETRÍA MEDA (Mars 2020): Presión atmosférica en ${snap.clima_meda.presion_hpa} hPa, vientos de ${snap.clima_meda.viento_ms} m/s y opacidad de polvo en τ = ${tau}. ${storm ? 'Tormenta de polvo severa en curso.' : 'Atmósfera diurna despejada; radiación UV nominal.'}`;
  }

  if (q.includes('poi') || q.includes('ciencia') || q.includes('muestra') || q.includes('perseverance')) {
    return `🔬 OFICIAL CIENTÍFICO ARES: El objetivo prioritario detectado es ${snap.navegacion.poi_cercano}. Has completado ${snap.navegacion.muestras_completadas} objetivos de muestreo. Recomiendo aproximarte al Rover Perseverance para enlace de telemetría por radio o al afloramiento CRISM para espectroscopía de filosilicatos.`;
  }

  if (q.includes('retorno') || q.includes('evacuar') || q.includes('refugio') || q.includes('volver')) {
    return `🚨 VECTOR DE RETORNO: Tu refugio más próximo se encuentra a ${snap.navegacion.refugio_cercano_m ?? 85} metros. He proyectado el corredor de evacuación en tu HUD hacia el domo presurizado. Mantén paso constante sin correr para no disparar el consumo metabólico.`;
  }

  if (q.includes('qaoa') || q.includes('ruta') || q.includes('astar')) {
    if (snap.navegacion.ruta_activa) {
      return `🗺️ PLANIFICADOR DE NAVEGACIÓN: Ruta activa ${snap.navegacion.algoritmo_ruta.toUpperCase()} de ${snap.navegacion.distancia_ruta_m} metros. Demanda estimada: ${snap.navegacion.oxigeno_est_l} L de O₂ y pendiente máxima ${snap.navegacion.pendiente_max_deg}°. El algoritmo cuántico QAOA minimiza la exposición a laderas escarpadas.`;
    }
    return `🗺️ PLANIFICADOR DE NAVEGACIÓN: No hay ruta activa fijada en este momento. Selecciona un punto de Inicio (A) y Destino (B) en el mapa o haz clic en "Travesía Científica" para encadenar los POIs.`;
  }

  return `🎙️ ARES-AI (CAPCOM): Recibido, astronauta. Telemetría de vuelo: O₂ al ${o2}%, clima ${storm ? 'HOSTIL' : 'NOMINAL'} (${temp}°C), hora ${ltst} LTST en ${snap.sitio}. Mantente atento a los avisos de inclinación en el visor. ¿Deseas análisis de ruta o soporte científico?`;
}

/* ------------------------------------------- Consulta a la API de Meta Llama 3 (Groq) */
export async function queryAresCopilot(userPrompt) {
  const snap = getCopilotMissionSnapshot();
  const apiKey = (localStorage.getItem(STORAGE_KEY_API) || '').trim();
  const model  = localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL;

  /* Si no hay API key de Llama configurada, usar de inmediato el motor offline determinista */
  if (!apiKey) {
    const offlineReply = getOfflineAresResponse(userPrompt, snap);
    return {
      text: offlineReply,
      source: 'offline_heuristic',
      model: 'Motor Experto Aeroespacial (Offline)',
    };
  }

  const systemInstructions =
    `Eres ARES-AI (Autonomous Reconnaissance & EVA Specialist), la inteligencia artificial integrada en el traje espacial PLSS y centro de control de vuelo de la misión Marswalk (NASA Space Apps Challenge). ` +
    `Tu astronauta está explorando la superficie de Marte en tiempo real. ` +
    `Respondes como un oficial de vuelo CAPCOM de la NASA: técnico, sereno, enfocado en la supervivencia (reserva de oxígeno O2, pendientes peligrosas >25°, tormentas de polvo MEDA) y en el éxito astrobiológico (capas CRISM/THEMIS, Rover Perseverance, tubos de muestras). ` +
    `REGLAS CRÍTICAS: Responde en español, sé directo (máximo 2 a 4 oraciones concisas estilo transmisión de radio espacial), cita números reales de la telemetría actual. ` +
    `TELEMETRÍA EN VIVO DE LA MISIÓN: ${JSON.stringify(snap)}`;

  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstructions },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      console.warn('[ARES-AI] Error de API Llama/Groq:', response.status, errJson);
      const fallback = getOfflineAresResponse(userPrompt, snap);
      return {
        text: `${fallback} (Aviso: Error en API Llama ${response.status}, respaldo offline activado).`,
        source: 'offline_fallback',
        model: 'Llama Fallback Offline',
      };
    }

    const data = await response.json();
    const replyText = data?.choices?.[0]?.message?.content?.trim() || getOfflineAresResponse(userPrompt, snap);
    return {
      text: replyText,
      source: 'llama_api',
      model,
    };
  } catch (err) {
    console.warn('[ARES-AI] Fallo de conexión con Groq/Llama:', err);
    return {
      text: getOfflineAresResponse(userPrompt, snap),
      source: 'offline_fallback',
      model: 'Llama Fallback Offline (Sin Conexión)',
    };
  }
}

/* ------------------------------------------- Síntesis de Voz de Radio Espacial */
export function speakCopilotRadio(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();
  // Limpiar emojis para lectura fluida
  const cleanText = text.replace(/[\u{1F300}-\u{1F6FF}|[\u{2600}-\u{26FF}]/gu, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);

  // Buscar voz en español con tono espacial / técnico
  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => v.lang.startsWith('es')) || voices[0];
  if (esVoice) utterance.voice = esVoice;

  utterance.rate = 1.05;
  utterance.pitch = 0.95;
  window.speechSynthesis.speak(utterance);
}

export function toggleCopilotVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem(STORAGE_KEY_VOICE, voiceEnabled ? '1' : '0');
  if (!voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
  return voiceEnabled;
}

export function isCopilotVoiceActive() {
  return voiceEnabled;
}

/* ------------------------------------------- Interfaz de Usuario de ARES-AI */
export function initCopilotUI() {
  const sendBtn       = document.getElementById('copilot-send-btn');
  const inputEl       = document.getElementById('copilot-input');
  const logEl         = document.getElementById('copilot-messages');
  const settingsBtn   = document.getElementById('copilot-settings-btn');
  const voiceBtn      = document.getElementById('copilot-voice-btn');
  const quickPillBtns = document.querySelectorAll('.copilot-quick-btn');

  // Modal de configuración de clave API de Llama
  const modalEl     = document.getElementById('copilot-modal');
  const apiKeyInput = document.getElementById('copilot-api-key-input');
  const modelSelect = document.getElementById('copilot-model-select');
  const saveKeyBtn  = document.getElementById('copilot-save-key-btn');
  const closeModBtn = document.getElementById('copilot-close-modal-btn');

  if (voiceBtn) {
    voiceBtn.classList.toggle('active', voiceEnabled);
    voiceBtn.textContent = voiceEnabled ? '🔊 Voz Radio' : '🔇 Voz Radio';
    voiceBtn.addEventListener('click', () => {
      const active = toggleCopilotVoice();
      voiceBtn.classList.toggle('active', active);
      voiceBtn.textContent = active ? '🔊 Voz Radio' : '🔇 Voz Radio';
    });
  }

  if (settingsBtn && modalEl) {
    settingsBtn.addEventListener('click', () => {
      if (apiKeyInput) apiKeyInput.value = localStorage.getItem(STORAGE_KEY_API) || '';
      if (modelSelect) modelSelect.value = localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL;
      modalEl.classList.remove('hidden');
    });
  }

  if (closeModBtn && modalEl) {
    closeModBtn.addEventListener('click', () => {
      modalEl.classList.add('hidden');
    });
  }

  if (saveKeyBtn && modalEl && apiKeyInput) {
    saveKeyBtn.addEventListener('click', () => {
      const keyVal = apiKeyInput.value.trim();
      const modVal = modelSelect ? modelSelect.value : DEFAULT_MODEL;
      if (keyVal) {
        localStorage.setItem(STORAGE_KEY_API, keyVal);
      } else {
        localStorage.removeItem(STORAGE_KEY_API);
      }
      localStorage.setItem(STORAGE_KEY_MODEL, modVal);
      modalEl.classList.add('hidden');
      appendCopilotMessage(
        'system',
        keyVal
          ? `Configuración guardada: Modelo ${modVal} activado con API Key de Groq/Llama.`
          : 'Clave eliminada: Operando en modo Motor Heurístico Aeroespacial Offline (100% gratuito).'
      );
    });
  }

  const handleSend = async (customText = null) => {
    if (isThinking) return;
    const q = (customText !== null ? customText : inputEl?.value || '').trim();
    if (!q) return;

    if (inputEl) inputEl.value = '';
    appendCopilotMessage('user', q);

    isThinking = true;
    showTypingIndicator(true);

    try {
      const reply = await queryAresCopilot(q);
      showTypingIndicator(false);
      appendCopilotMessage('ares', reply.text, reply.model);
      speakCopilotRadio(reply.text);

      // Si estamos en 1ª persona, proyectar la transmisión en el HUD del casco
      showTransmissionOnHUD(reply.text);
    } catch (e) {
      showTypingIndicator(false);
      appendCopilotMessage('ares', 'Fallo temporal en el canal de radio. Mantén protocolos estándar.');
    } finally {
      isThinking = false;
    }
  };

  if (sendBtn) {
    sendBtn.addEventListener('click', () => handleSend());
  }

  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  quickPillBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || btn.textContent.trim();
      handleSend(prompt);
    });
  });

  // Mensaje inicial de bienvenida de ARES-AI
  appendCopilotMessage(
    'ares',
    'ARES-AI en línea. Monitorizando telemetría PLSS, climatología MEDA y navegación A*/QAOA en tiempo real. Pulsa [C] en 1ª persona para radio directa.',
    localStorage.getItem(STORAGE_KEY_API) ? 'Meta Llama 3 Conectado' : 'Motor Aeroespacial Offline'
  );
}

function appendCopilotMessage(sender, text, modelTag = '') {
  const logEl = document.getElementById('copilot-messages');
  if (!logEl) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `copilot-msg ${sender}`;

  const header = document.createElement('div');
  header.className = 'copilot-msg-header';

  if (sender === 'user') {
    header.textContent = 'ASTRONAUTA // CANAL EVA';
  } else if (sender === 'system') {
    header.textContent = 'SISTEMA // COMMS';
  } else {
    header.innerHTML = `🎙️ ARES-AI ${modelTag ? `<span class="model-badge">${modelTag}</span>` : ''}`;
  }

  const body = document.createElement('div');
  body.className = 'copilot-msg-body';
  body.textContent = text;

  msgDiv.appendChild(header);
  msgDiv.appendChild(body);
  logEl.appendChild(msgDiv);
  logEl.scrollTop = logEl.scrollHeight;
}

function showTypingIndicator(show) {
  let indicator = document.getElementById('copilot-typing');
  const logEl = document.getElementById('copilot-messages');
  if (show) {
    if (!indicator && logEl) {
      indicator = document.createElement('div');
      indicator.id = 'copilot-typing';
      indicator.className = 'copilot-typing';
      indicator.innerHTML = '<span>.</span><span>.</span><span>.</span> Transmitiendo con Llama 3';
      logEl.appendChild(indicator);
      logEl.scrollTop = logEl.scrollHeight;
    }
  } else if (indicator) {
    indicator.remove();
  }
}

/* ------------------------------------------- Proyección en el HUD de 1ª Persona (Visor del Casco) */
export function showTransmissionOnHUD(text) {
  const hudToast = document.getElementById('hud-radio-toast');
  const hudText  = document.getElementById('hud-radio-text');
  if (!hudToast || !hudText) return;

  hudText.textContent = text;
  hudToast.classList.remove('hidden');
  hudToast.classList.add('visible');

  clearTimeout(hudToast._hideTimer);
  hudToast._hideTimer = setTimeout(() => {
    hudToast.classList.remove('visible');
    setTimeout(() => hudToast.classList.add('hidden'), 350);
  }, 9500);
}
