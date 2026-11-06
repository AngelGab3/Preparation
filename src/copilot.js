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

/* ------------------------------------------- Banco de Datos Curiosos de Robert (Rover Perseverance) */
let factIndex = Math.floor(Math.random() * 18);
let autoFactTimer_s = 0;
let welcomedInFP = false;
let audioCtx = null;

function getNextRoverFunFact(snap) {
  const elev = snap.traje_plss.elevacion_actual_m;
  const temp = snap.clima_meda.temp_c;
  const o2 = snap.traje_plss.o2_pct;
  const ltst = snap.astronomia_solar.ltst;

  const facts = [
    `🤖 DATO CURIOSO (Jezero Paleo-Lago): Hace unos 3,700 millones de años, el suelo donde estamos parados (${elev} m) estaba bajo decenas de metros de agua líquida. El cráter Jezero tenía un río de entrada y otro de salida.`,
    `🤖 DATO CURIOSO (Batería Nuclear MMRTG): No uso paneles solares como los rovers antiguos; mi generador trasero lleva 4.8 kg de dióxido de plutonio-238 que me da 110 W de electricidad y mantiene mi electrónica caliente a ${temp} °C.`,
    `🤖 DATO CURIOSO (Experimento MOXIE): En mi interior llevo el instrumento MOXIE, que ya demostró fabricar oxígeno respirable directamente del CO₂ marciano (95% de la atmósfera) a 800 °C. ¡El futuro de tu reserva PLSS (${o2}%)!`,
    `🤖 DATO CURIOSO (Atardeceres Azules): En Marte el cielo diurno es color caramelo por el polvo rico en óxidos de hierro, pero al atardecer el cono alrededor del Sol se vuelve azul brillante por la dispersión Mie del polvo fino.`,
    `🤖 DATO CURIOSO (Láser SuperCam): El ojo grande en mi cabeza puede disparar pulsos láser infrarrojos a rocas hasta a 7 metros de distancia, calentándolas a 10,000 °C para leer su composición química por el destello de plasma.`,
    `🤖 DATO CURIOSO (Helicóptero Ingenuity): Mi compañero Ingenuity viajó plegado bajo mi panza. Logró 72 vuelos en una atmósfera con apenas el 1% de la densidad de la Tierra haciendo girar sus rotores a 2,537 rpm.`,
    `🤖 DATO CURIOSO (Gravedad Marciana): Aquí la gravedad es de 3.71 m/s² (un 38% de la terrestre). Aunque tu traje EVA completo pesa unos 130 kg en la Tierra, aquí en Marte lo sientes como de solo 49 kg.`,
    `🤖 DATO CURIOSO (Ruedas Todo Terreno): Mis 6 ruedas de aluminio de 52.5 cm tienen listones curvos de titanio y motores individuales. Si miras mis huellas, dejan un patrón que sirve para medir con precisión cuánto patino en las dunas.`,
    `🤖 DATO CURIOSO (Sonidos en Marte): Llevo dos micrófonos reales. En Marte el sonido viaja más lento (~240 m/s frente a 343 m/s en la Tierra) y el CO₂ absorbe los sonidos agudos mucho antes que los graves.`,
    `🤖 DATO CURIOSO (Radar Subterráneo RIMFAX): Mientras camino a tu lado, mi radar RIMFAX penetra hasta 10 metros bajo nuestros pies revelando capas de sedimentos lacustres e ígneos invisibles desde la superficie.`,
    `🤖 DATO CURIOSO (Carbonatos Marginales): El borde interno del cráter Jezero conserva una franja de carbonatos precipitados en la antigua orilla del lago; en la Tierra, estos minerales son excelentes para atrapar microfósiles.`,
    `🤖 DATO CURIOSO (SHERLOC & WATSON): En la punta de mi brazo robótico llevo un espectrómetro UV llamado SHERLOC que busca compuestos orgánicos y aminoácidos sin siquiera tocar la roca.`,
    `🤖 DATO CURIOSO (Día Marciano - Sol): Ahora son las ${ltst} LTST. Un día solar en Marte (llamado "Sol") dura 24 horas, 39 minutos y 35 segundos: ¡casi idéntico al ritmo circadiano humano!`,
    `🤖 DATO CURIOSO (Tubos de Titanio): Llevo 43 tubos ultra-limpios recubiertos de nitruro de titanio dorado para reflejar el calor solar y conservar muestras intactas hasta que una misión humana como la tuya las recoja.`,
    `🤖 DATO CURIOSO (Remolinos Dust Devils): Aunque el viento marciano a 60 km/h apenas empuja como una brisa suave por la baja presión (${snap.clima_meda.presion_hpa} hPa), levanta remolinos de polvo de hasta 2 km de altura.`,
    `🤖 DATO CURIOSO (Fisiología en Pendientes): Subir una ladera de más de 15° con traje presurizado duplica tu gasto metabólico y tu temperatura corporal central; por eso nuestro algoritmo busca rutas suaves.`,
    `🤖 DATO CURIOSO (Cerebro Resistente a Radiación): Mi computadora de vuelo usa un procesador RAD750 blindado contra rayos cósmicos, capaz de operar sin fallos en medio de tormentas solares.`,
    `🤖 DATO CURIOSO (HiRISE 1 m/px): La cámara orbital HiRISE a bordo del MRO fotografía Marte desde 300 km de altura con tal nitidez que puede distinguirme a mí y a tus huellas sobre el regolito.`,
  ];

  const fact = facts[factIndex % facts.length];
  factIndex = (factIndex + 1) % facts.length;
  return fact;
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

  if (q.includes('curioso') || q.includes('dato') || q.includes('robert') || q.includes('rover') || q.includes('sabias') || q.includes('cuéntame') || q.includes('cuentame')) {
    return getNextRoverFunFact(snap);
  }

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
    return `🔬 OFICIAL CIENTÍFICO ARES: El objetivo prioritario detectado es ${snap.navegacion.poi_cercano}. Has completado ${snap.navegacion.muestras_completadas} objetivos de muestreo. Recomiendo aproximarte al afloramiento cercano y pulsar [E] para espectroscopía.`;
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

  return `${getNextRoverFunFact(snap)} (Telemetría: O₂ ${o2}%, ${temp}°C, ${ltst} LTST).`;
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

/* ------------------------------------------- Síntesis de Voz y Chirp Robótico (Opcional) */
function playRoverChirp() {
  if (!voiceEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const notes = [587.33, 880.0, 1174.66]; // Re5 - La5 - Re6 (chirp amigable de rover)
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      gain.gain.setValueAtTime(0.001, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.045, now + i * 0.065 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.065);
    });
  } catch (_) {
    /* Ignorar si el navegador bloquea AudioContext */
  }
}

export function speakCopilotRadio(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;

  playRoverChirp();
  window.speechSynthesis.cancel();

  // Limpiar emojis y símbolos técnicos para lectura fluida en español
  const cleanText = text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/DATO CURIOSO/gi, 'Dato curioso:')
    .replace(/m\/s²/g, 'metros por segundo al cuadrado')
    .replace(/m\/s/g, 'metros por segundo')
    .replace(/O₂/g, 'oxígeno')
    .replace(/CO₂/g, 'dióxido de carbono')
    .trim();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'es-MX';

  const voices = window.speechSynthesis.getVoices();
  const esVoice =
    voices.find((v) => v.lang.startsWith('es') && /paulina|monica|mónica|jorge|angelica|juan/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith('es')) ||
    voices[0];
  if (esVoice) utterance.voice = esVoice;

  utterance.rate = 1.04;
  utterance.pitch = 1.02;
  window.speechSynthesis.speak(utterance);
}

export function syncVoiceButtonsUI() {
  const voiceBtn = document.getElementById('copilot-voice-btn');
  const hudAudioBtn = document.getElementById('hud-audio-btn');
  if (voiceBtn) {
    voiceBtn.classList.toggle('active', voiceEnabled);
    voiceBtn.textContent = voiceEnabled ? '🔊 Voz ON' : '🔇 Voz OFF';
  }
  if (hudAudioBtn) {
    hudAudioBtn.classList.toggle('active', voiceEnabled);
    hudAudioBtn.textContent = voiceEnabled ? '🔊 Audio ON [U]' : '🔇 Audio OFF [U]';
  }
}

export function toggleCopilotVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem(STORAGE_KEY_VOICE, voiceEnabled ? '1' : '0');
  syncVoiceButtonsUI();
  if (!voiceEnabled && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  } else if (voiceEnabled) {
    const hudTextEl = document.getElementById('hud-radio-text');
    const hudToast = document.getElementById('hud-radio-toast');
    if (hudToast && !hudToast.classList.contains('hidden') && hudTextEl?.textContent) {
      speakCopilotRadio(hudTextEl.textContent);
    }
  }
  return voiceEnabled;
}

export function isCopilotVoiceActive() {
  return voiceEnabled;
}

/* Hace que Robert (el Rover mascota) comparta un dato curioso en la barra inferior y, si el audio está activo, lo hable */
export function triggerRoverFunFact() {
  const snap = getCopilotMissionSnapshot();
  const fact = getNextRoverFunFact(snap);
  appendCopilotMessage('ares', fact, 'Rover Robert · Ciencia NASA');
  showTransmissionOnHUD(fact, '🤖 ROBERT · ROVER PERSEVERANCE');
  speakCopilotRadio(fact);
  autoFactTimer_s = 0;
  return fact;
}

/* Temporizador automático para que Robert comparta datos curiosos mientras te acompaña en la superficie */
export function tickRoverCompanionFacts(dt) {
  if (state.mode !== 'fp') {
    welcomedInFP = false;
    autoFactTimer_s = 0;
    return;
  }

  autoFactTimer_s += dt;
  if (!welcomedInFP && autoFactTimer_s >= 2.2) {
    welcomedInFP = true;
    autoFactTimer_s = 0;
    triggerRoverFunFact();
  } else if (welcomedInFP && autoFactTimer_s >= 32.0) {
    autoFactTimer_s = 0;
    triggerRoverFunFact();
  }
}

/* ------------------------------------------- Interfaz de Usuario de ARES-AI */
export function initCopilotUI() {
  const sendBtn       = document.getElementById('copilot-send-btn');
  const inputEl       = document.getElementById('copilot-input');
  const settingsBtn   = document.getElementById('copilot-settings-btn');
  const voiceBtn      = document.getElementById('copilot-voice-btn');
  const hudAudioBtn   = document.getElementById('hud-audio-btn');
  const hudFactBtn    = document.getElementById('hud-fact-btn');
  const quickPillBtns = document.querySelectorAll('.copilot-quick-btn');

  if (window.speechSynthesis && 'onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // Modal de configuración de clave API de Llama
  const modalEl     = document.getElementById('copilot-modal');
  const apiKeyInput = document.getElementById('copilot-api-key-input');
  const modelSelect = document.getElementById('copilot-model-select');
  const saveKeyBtn  = document.getElementById('copilot-save-key-btn');
  const closeModBtn = document.getElementById('copilot-close-modal-btn');

  syncVoiceButtonsUI();

  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      toggleCopilotVoice();
    });
  }

  if (hudAudioBtn) {
    hudAudioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCopilotVoice();
    });
  }

  if (hudFactBtn) {
    hudFactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRoverFunFact();
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

  // Mensaje inicial de bienvenida de Robert & ARES-AI
  appendCopilotMessage(
    'ares',
    '🤖 Rover Robert (Perseverance) y ARES-AI en línea. En 1ª/3ª persona te seguiré por la superficie marciana compartiendo datos científicos en la barra inferior. Pulsa [R] para un dato curioso, [U] para activar/silenciar la bocina o [C] para telemetría.',
    localStorage.getItem(STORAGE_KEY_API) ? 'Meta Llama 3 Conectado' : 'Rover Robert + Motor Offline'
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

/* ------------------------------------------- Barra Inferior de Subtítulos (Robert & ARES-AI) */
export function showTransmissionOnHUD(text, speakerLabel = '🤖 ROBERT · ROVER PERSEVERANCE') {
  const hudToast   = document.getElementById('hud-radio-toast');
  const hudText    = document.getElementById('hud-radio-text');
  const hudSpeaker = document.getElementById('hud-radio-speaker');
  if (!hudToast || !hudText) return;

  if (hudSpeaker) hudSpeaker.textContent = speakerLabel;
  hudText.textContent = text;
  hudToast.classList.remove('hidden');
  hudToast.classList.add('visible');

  clearTimeout(hudToast._hideTimer);
  hudToast._hideTimer = setTimeout(() => {
    hudToast.classList.remove('visible');
    setTimeout(() => hudToast.classList.add('hidden'), 350);
  }, 14000);
}
