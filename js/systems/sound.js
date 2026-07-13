const MASTER_GAIN = 0.32;

const MATERIAL_PITCH = {
  stone: { placeFreq: 180, breakMul: 1.15 },
  cobblestone: { placeFreq: 170, breakMul: 1.12 },
  dirt: { placeFreq: 240, breakMul: 1.1 },
  grass: { placeFreq: 230, breakMul: 1.08 },
  sand: { placeFreq: 300, breakMul: 1.05 },
  gravel: { placeFreq: 220, breakMul: 1.14 },
  wood: { placeFreq: 200, breakMul: 1.1 },
  log: { placeFreq: 200, breakMul: 1.1 },
  organic: { placeFreq: 210, breakMul: 1.06 },
  coal: { placeFreq: 190, breakMul: 1.12 },
  coal_ore: { placeFreq: 185, breakMul: 1.14 },
  iron: { placeFreq: 160, breakMul: 1.18 },
  iron_ore: { placeFreq: 165, breakMul: 1.16 },
  glass: { placeFreq: 420, breakMul: 1.2 },
  water: { placeFreq: 380, breakMul: 1.05 },
};

const DEFAULT_PITCH = { placeFreq: 220, breakMul: 1.12 };

function getPitch(materialId) {
  return MATERIAL_PITCH[materialId] ?? DEFAULT_PITCH;
}

function createNoiseBuffer(ctx, duration) {
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class SoundSystem {
  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    this.resumed = false;
    this.rainGain = null;
    this.rainSource = null;
    this.rainLevel = 0;
  }

  async resume() {
    if (this.resumed || this.ctx.state === 'running') {
      this.resumed = true;
      return;
    }
    await this.ctx.resume();
    this.resumed = true;
  }

  playBlockBreak(materialId) {
    if (this.ctx.state === 'closed') return;

    const pitch = getPitch(materialId);
    const now = this.ctx.currentTime;
    const duration = 0.055;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch.placeFreq, now);
    osc.frequency.exponentialRampToValueAtTime(pitch.placeFreq * 0.6, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.7, now + 0.004);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const noise = this.ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(this.ctx, duration * 0.5);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.5);

    osc.connect(oscGain);
    oscGain.connect(this.master);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration);
    noise.start(now);
    noise.stop(now + duration * 0.5);
  }

  playJump() {
    if (this.ctx.state === 'closed') return;

    const now = this.ctx.currentTime;
    const duration = 0.09;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + duration * 0.45);
    osc.frequency.exponentialRampToValueAtTime(280, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.85, now + 0.008);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const noise = this.ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(this.ctx, duration * 0.5);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 600;
    noiseFilter.Q.value = 1.5;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.4);

    osc.connect(oscGain);
    oscGain.connect(this.master);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration);
    noise.start(now);
    noise.stop(now + duration * 0.5);
  }

  playHurt() {
    if (this.ctx.state === 'closed') return;

    const now = this.ctx.currentTime;
    const duration = 0.18;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.55, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const noise = this.ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(this.ctx, duration * 0.7);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 480;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6);

    osc.connect(oscGain);
    oscGain.connect(this.master);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration);
    noise.start(now);
    noise.stop(now + duration * 0.7);
  }

  playExplosion() {
    if (this.ctx.state === 'closed') return;

    const now = this.ctx.currentTime;
    const duration = 0.45;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.7, now + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const noise = this.ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(this.ctx, duration);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(1400, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(220, now + duration);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(this.master);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration);
    noise.start(now);
    noise.stop(now + duration);
  }

  playLootPickup() {
    if (this.ctx.state === 'closed') return;

    const now = this.ctx.currentTime;
    // Bright two-note chime — no noise burst, unlike break/place/hurt.
    const notes = [
      { freq: 880, start: 0, dur: 0.07 },
      { freq: 1320, start: 0.045, dur: 0.09 },
    ];

    for (const note of notes) {
      const t0 = now + note.start;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.freq, t0);
      osc.frequency.exponentialRampToValueAtTime(note.freq * 1.06, t0 + note.dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(note.freq * 0.92, t0 + note.dur);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, t0);
      filter.frequency.exponentialRampToValueAtTime(1400, t0 + note.dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.42, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + note.dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      osc.start(t0);
      osc.stop(t0 + note.dur + 0.01);
    }
  }

  playBlockPlace(materialId) {
    if (this.ctx.state === 'closed') return;

    const pitch = getPitch(materialId);
    const freq = pitch.placeFreq * pitch.breakMul;
    const now = this.ctx.currentTime;
    const duration = 0.085;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.48, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.75, now + 0.006);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const noise = this.ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(this.ctx, duration * 0.65);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = freq * 1.35;
    noiseFilter.Q.value = 1.1;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.55);

    osc.connect(oscGain);
    oscGain.connect(this.master);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration);
    noise.start(now);
    noise.stop(now + duration * 0.65);
  }

  /**
   * Looping rain ambience. level 0…1; 0 fades the loop out.
   */
  setRainLevel(level) {
    if (this.ctx.state === 'closed') return;

    const target = Math.max(0, Math.min(1, level));
    this.rainLevel = target;

    if (target <= 0.01) {
      if (this.rainGain) {
        const now = this.ctx.currentTime;
        this.rainGain.gain.cancelScheduledValues(now);
        this.rainGain.gain.linearRampToValueAtTime(0.001, now + 0.35);
      }
      return;
    }

    if (!this.rainSource) {
      const source = this.ctx.createBufferSource();
      source.buffer = createNoiseBuffer(this.ctx, 1.5);
      source.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.55;

      const low = this.ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 2800;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.001;

      source.connect(filter);
      filter.connect(low);
      low.connect(gain);
      gain.connect(this.master);
      source.start();

      this.rainSource = source;
      this.rainGain = gain;
    }

    const now = this.ctx.currentTime;
    const vol = 0.018 + target * 0.11;
    this.rainGain.gain.cancelScheduledValues(now);
    this.rainGain.gain.linearRampToValueAtTime(vol, now + 0.2);
  }

  dispose() {
    if (this.rainSource) {
      try {
        this.rainSource.stop();
      } catch {
        /* already stopped */
      }
      this.rainSource = null;
      this.rainGain = null;
    }
    if (this.ctx.state !== 'closed') {
      this.ctx.close();
    }
  }
}
