/* Local synthesized EVA ambience. Audio starts only from a user gesture. */
export function createSignalAudio() {
  let ctx, master, breath, pulse, radio, capture, enabled = false, disposed = false;
  const sources = [];
  function initialize() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Este navegador no permite audio Web Audio.');
    ctx = new Audio();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 650;
    breath = ctx.createGain(); breath.gain.value = 0;
    noise.connect(filter).connect(breath).connect(master);
    const radioFilter = ctx.createBiquadFilter(); radioFilter.type = 'bandpass';
    radioFilter.frequency.value = 1900; radioFilter.Q.value = 2;
    radio = ctx.createGain(); radio.gain.value = 0;
    noise.connect(radioFilter).connect(radio).connect(master);
    noise.start(); sources.push(noise);
    const oscillator = ctx.createOscillator(); oscillator.frequency.value = 740;
    pulse = ctx.createGain(); pulse.gain.value = 0;
    oscillator.connect(pulse).connect(master); oscillator.start(); sources.push(oscillator);
  }
  return {
    async toggle() {
      if (disposed) return false;
      if (!ctx) initialize();
      if (enabled) {
        enabled = false;
        master.gain.setTargetAtTime(0, ctx.currentTime, .025);
        return false;
      }
      await ctx.resume();
      if (disposed) return false;
      enabled = ctx.state === 'running';
      if (!enabled) throw new Error('El navegador no pudo activar el sonido.');
      return true;
    },
    update(time_s, paused) {
      if (!ctx || disposed) return;
      const now = ctx.currentTime;
      master.gain.setTargetAtTime(enabled && !paused ? .55 : 0, now, .04);
      const breathing = Math.max(0, Math.sin(time_s * 1.3));
      breath.gain.setTargetAtTime(.025 + breathing * .10, now, .07);
      const phase = time_s % 3;
      const on = phase < .12 || (phase > .25 && phase < .37);
      pulse.gain.setTargetAtTime(on ? .045 : 0, now, .015);
      radio.gain.setTargetAtTime(on ? .012 : 0, now, .02);
    },
    stream() {
      if (!ctx || disposed) return null;
      if (!capture) { capture = ctx.createMediaStreamDestination(); master.connect(capture); }
      return capture.stream;
    },
    silence() { if (ctx && !disposed) master.gain.setTargetAtTime(0, ctx.currentTime, .025); },
    dispose() {
      disposed = true; enabled = false;
      if (!ctx) return;
      master.gain.value = 0;
      sources.forEach(source => { source.stop(); source.disconnect(); });
      master.disconnect(); ctx.close().catch(() => {});
    },
  };
}
