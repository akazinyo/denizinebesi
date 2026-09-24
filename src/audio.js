// Hybrid real-time sound engine for Denizinebesi:
// - Four recorded Mavi 52 engine layers, with synthesis as a quiet body/fallback
// - Six recorded Kıyı 28 outboard-engine layers, with synthesis as a quiet body/fallback
// - Mavi 52 (Gezi gemisi): Heavy marine diesel engine with deep rhythmic chug and hull rumble
// - Dynamic wake water rush scaling with speed, wave splash on impact, and marine horn

export function shipEngineMix(speed, throttle, available = [true, true, true, true]) {
  const speedRatio = Math.min(1, Math.max(0, speed / 13));
  const load = Math.min(1, Math.max(0, throttle * 0.78 + speedRatio * 0.22));
  const hasRecording = available.some(Boolean);
  return {
    speedRatio,
    load,
    weights: engineStateWeights(load, available),
    frequency: 14 + throttle * 8 + speedRatio * 20,
    playbackRate: 0.99 + load * 0.025,
    sampleFilter: 1800 + load * 2400,
    sampleGain: 0.42 + load * 0.18,
    synthGain: hasRecording
      ? 0.035 + load * 0.02
      : 0.52 + speedRatio * 0.26 + throttle * 0.15,
    lowpass: 180 + speedRatio * 220 + throttle * 80,
    churnGain: 0.08 + speedRatio * 0.12 + throttle * 0.05,
  };
}

export function boatEngineMix(speed, throttle, isAirborne = false, available = [true, true, true, true, true, true]) {
  const speedRatio = Math.min(1, Math.max(0, speed / 21));
  const load = Math.min(1, Math.max(0, throttle * 0.82 + speedRatio * 0.18));
  let frequency = 28 + throttle * 25 + speedRatio * 82;
  if (isAirborne && throttle > 0.2) frequency = Math.min(155, frequency * 1.22);
  const hasRecording = available.some(Boolean);

  return {
    speedRatio,
    load,
    weights: engineStateWeights(load, available),
    frequency,
    playbackRate: 0.99 + load * 0.025 + (isAirborne && throttle > 0.2 ? 0.012 : 0),
    sampleFilter: 1500 + load * 2200 + (isAirborne && throttle > 0.2 ? 350 : 0),
    sampleGain: 0.34 + load * 0.16,
    synthGain: hasRecording
      ? 0.045 + load * 0.02
      : 0.38 + speedRatio * 0.28 + throttle * 0.18,
    mufflerCutoff: 260 + speedRatio * 680 + throttle * 220,
  };
}

function engineStateWeights(load, available) {
  const availableIndices = available.flatMap((isAvailable, index) => isAvailable ? [index] : []);
  const weights = new Array(available.length).fill(0);
  if (!availableIndices.length) return weights;

  const trackPosition = Math.min(1, Math.max(0, load)) * (available.length - 1);
  const lower = [...availableIndices].reverse().find(index => index <= trackPosition) ?? availableIndices[0];
  const upper = availableIndices.find(index => index >= trackPosition) ?? availableIndices.at(-1);
  if (lower === upper) {
    weights[lower] = 1;
  } else {
    const blend = (trackPosition - lower) / (upper - lower);
    weights[lower] = Math.cos(blend * Math.PI * 0.5);
    weights[upper] = Math.sin(blend * Math.PI * 0.5);
  }
  return weights;
}

// Match average levels so the low layer does not dip during crossfades.
const DIESEL_SAMPLE_NORMALIZATION = [1, 1.9, 1.03, 1.1];
const BOAT_SAMPLE_NORMALIZATION = [1, 1, 1, 1, 1, 1];

export function crossfadeLoopSamples(samples, fadeFrames) {
  const fade = Math.min(Math.floor(fadeFrames), Math.floor(samples.length / 4));
  if (fade < 1) return samples.slice();
  const loop = new Float32Array(samples.length - fade);
  const straightLength = samples.length - fade * 2;
  loop.set(samples.subarray(fade, samples.length - fade));
  for (let i = 0; i < fade; i++) {
    const mix = (i + 1) / fade;
    loop[straightLength + i] = samples[samples.length - fade + i] * (1 - mix) + samples[i] * mix;
  }
  return loop;
}

export class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.shipMode = false;
    this.engineHz = 28;
    this.dieselHz = 14;
    this.hornActive = false;
    this.impactCooldown = 0;
    this.lastImpact = 0;
    this.shipAssetsPromise = null;
    this.boatSampleSources = [];
    this.boatSampleBuffers = [];
    this.dieselSampleSources = [];
    this.dieselSampleBuffers = [];
    this.shipHornSource = null;
    this.shipHornBuffer = null;
    this.shipSplashBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    const ctx = this.ctx;

    // Master bus & dynamics compressor (prevents harsh distortion and keeps output clean)
    this.masterCompressor = ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -12;
    this.masterCompressor.knee.value = 10;
    this.masterCompressor.ratio.value = 4;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.15;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Sub-buses
    this.boatBus = ctx.createGain();
    this.boatBus.gain.value = 1;
    this.boatBus.connect(this.masterCompressor);

    this.shipBus = ctx.createGain();
    this.shipBus.gain.value = 0;
    this.shipBus.connect(this.masterCompressor);

    this.waterBus = ctx.createGain();
    this.waterBus.gain.value = 0.45;
    this.waterBus.connect(this.masterCompressor);

    this.hornBus = ctx.createGain();
    this.hornBus.gain.value = 0;
    this.hornBus.connect(this.masterCompressor);

    this.splashBus = ctx.createGain();
    this.splashBus.gain.value = 0.65;
    this.splashBus.connect(this.masterCompressor);

    // Shared noise buffer for water rush, sea ambient, and splash
    this.noiseBuffer = this._createNoiseBuffer(3);

    this._buildBoatEngine();
    this._buildShipEngine();
    this._buildWaterAndSea();
    this._buildSplash();
    this._buildHorn();
    this._loadShipAssets();
  }

  _loadShipAssets() {
    if (this.shipAssetsPromise) return this.shipAssetsPromise;
    this.shipAssetsPromise = Promise.all([
      Promise.all([
        this._loadAudioBuffer('/audio/mavi52-engine-idle.mp3'),
        this._loadAudioBuffer('/audio/mavi52-engine-low.mp3'),
        this._loadAudioBuffer('/audio/mavi52-engine-mid.mp3'),
        this._loadAudioBuffer('/audio/mavi52-engine-high.mp3'),
      ]),
      Promise.all([
        this._loadAudioBuffer('/audio/kiyi28-engine-idle.mp3'),
        this._loadAudioBuffer('/audio/kiyi28-engine-low.mp3'),
        this._loadAudioBuffer('/audio/kiyi28-engine-low-mid.mp3'),
        this._loadAudioBuffer('/audio/kiyi28-engine-mid.mp3'),
        this._loadAudioBuffer('/audio/kiyi28-engine-high.mp3'),
        this._loadAudioBuffer('/audio/kiyi28-engine-top.mp3'),
      ]),
      this._loadAudioBuffer('/audio/ship_horn.mp3'),
      this._loadAudioBuffer('/audio/water_splash.mp3'),
    ]).then(([engines, boatEngines, horn, splash]) => {
      this.dieselSampleBuffers = engines.map(engine => engine ? this._makeLoopBuffer(engine, 0.24) : null);
      this._startDieselSamples();
      this.boatSampleBuffers = boatEngines.map(engine => engine ? this._makeLoopBuffer(engine, 0.24) : null);
      this._startBoatSamples();
      this.shipHornBuffer = horn;
      this.shipSplashBuffer = splash;
    });
    return this.shipAssetsPromise;
  }

  async _loadAudioBuffer(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await this.ctx.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn(`Ses kaydı yüklenemedi (${url}); sentez kullanılacak.`, error);
      return null;
    }
  }

  _makeLoopBuffer(buffer, crossfadeSeconds) {
    const ctx = this.ctx;
    const fadeFrames = Math.min(Math.floor(buffer.sampleRate * crossfadeSeconds), Math.floor(buffer.length / 4));
    const loop = ctx.createBuffer(buffer.numberOfChannels, buffer.length - fadeFrames, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel);
      loop.copyToChannel(crossfadeLoopSamples(input, fadeFrames), channel);
    }
    return loop;
  }

  _startDieselSamples() {
    if (this.dieselSampleSources.length || !this.dieselSampleBuffers.length) return;
    this.dieselSampleSources = this.dieselSampleBuffers.map((buffer, index) => {
      if (!buffer) return null;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = 0.99;
      source.connect(this.dieselStateGains[index]);
      source.start();
      return source;
    });
  }

  _startBoatSamples() {
    if (this.boatSampleSources.length || !this.boatSampleBuffers.length) return;
    this.boatSampleSources = this.boatSampleBuffers.map((buffer, index) => {
      if (!buffer) return null;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = 0.99;
      source.connect(this.boatStateGains[index]);
      source.start();
      return source;
    });
  }

  _createNoiseBuffer(seconds) {
    const length = this.ctx.sampleRate * seconds;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.08) * 0.94;
      data[i] = last * 0.7 + (Math.random() * 2 - 1) * 0.3;
    }
    return buffer;
  }

  _makeTanhCurve(samples = 256, drive = 1.8) {
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  // ==========================================
  // 1. KIYI 28 (MOTORBOT) - OUTBOARD MOTOR SYNTH
  // ==========================================
  _buildBoatEngine() {
    const ctx = this.ctx;

    // Harmonic wave for warm, throaty cylinder combustion
    const n = 16;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      imag[i] = (1 / Math.pow(i, 0.85)) * (i % 2 === 0 ? 0.9 : 0.6);
    }
    const wave = ctx.createPeriodicWave(real, imag);

    this.boatOsc = ctx.createOscillator();
    this.boatOsc.setPeriodicWave(wave);
    this.boatOsc.frequency.value = 28;

    // Subtle detuned secondary oscillator for natural mechanical phasing
    this.boatOscDetune = ctx.createOscillator();
    this.boatOscDetune.type = 'triangle';
    this.boatOscDetune.frequency.value = 28.3;

    this.boatDetuneGain = ctx.createGain();
    this.boatDetuneGain.gain.value = 0.3;
    this.boatOscDetune.connect(this.boatDetuneGain);

    // Soft saturation for warm engine purr (no harsh digital buzz)
    this.boatShaper = ctx.createWaveShaper();
    this.boatShaper.curve = this._makeTanhCurve(256, 1.8);

    this.boatOsc.connect(this.boatShaper);
    this.boatDetuneGain.connect(this.boatShaper);

    // Underwater exhaust water-jacket filter:
    // Lowpass that opens up smoothly from 260 Hz to 1100 Hz with speed & throttle
    this.boatMuffler = ctx.createBiquadFilter();
    this.boatMuffler.type = 'lowpass';
    this.boatMuffler.frequency.value = 280;
    this.boatMuffler.Q.value = 1.8;

    // Deep hull body warmth
    this.boatHullRes = ctx.createBiquadFilter();
    this.boatHullRes.type = 'peaking';
    this.boatHullRes.frequency.value = 70;
    this.boatHullRes.Q.value = 1.4;
    this.boatHullRes.gain.value = 4.5;

    this.boatGain = ctx.createGain();
    this.boatGain.gain.value = 0.55;

    this.boatSampleFilter = ctx.createBiquadFilter();
    this.boatSampleFilter.type = 'lowpass';
    this.boatSampleFilter.frequency.value = 1500;
    this.boatSampleFilter.Q.value = 0.7;
    this.boatSampleGain = ctx.createGain();
    this.boatSampleGain.gain.value = 0;
    this.boatStateGains = [0, 1, 2, 3, 4, 5].map(() => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.boatSampleFilter);
      return gain;
    });

    this.boatShaper.connect(this.boatMuffler);
    this.boatMuffler.connect(this.boatHullRes);
    this.boatHullRes.connect(this.boatGain);
    this.boatGain.connect(this.boatBus);
    this.boatSampleFilter.connect(this.boatSampleGain);
    this.boatSampleGain.connect(this.boatBus);

    this.boatOsc.start();
    this.boatOscDetune.start();
  }

  // ==========================================
  // 2. MAVI 52 (GEZİ GEMİSİ) - RECORDED MARINE DIESEL
  // ==========================================
  _buildShipEngine() {
    const ctx = this.ctx;

    // Quiet synthesized low-frequency body; the recordings carry the engine sound.
    const n = 12;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      imag[i] = 1 / Math.pow(i, 0.9);
    }
    const wave = ctx.createPeriodicWave(real, imag);

    this.dieselOsc = ctx.createOscillator();
    this.dieselOsc.setPeriodicWave(wave);
    this.dieselOsc.frequency.value = 14;

    this.dieselShaper = ctx.createWaveShaper();
    this.dieselShaper.curve = this._makeTanhCurve(256, 1.6);
    this.dieselOsc.connect(this.dieselShaper);

    // Low-frequency support for the recorded engine layers.
    this.dieselHull = ctx.createBiquadFilter();
    this.dieselHull.type = 'peaking';
    this.dieselHull.frequency.value = 45;
    this.dieselHull.Q.value = 3.0;
    this.dieselHull.gain.value = 7.5;

    // Stack muffler lowpass
    this.dieselLowpass = ctx.createBiquadFilter();
    this.dieselLowpass.type = 'lowpass';
    this.dieselLowpass.frequency.value = 220;
    this.dieselLowpass.Q.value = 1.5;

    this.dieselGain = ctx.createGain();
    this.dieselGain.gain.value = 0.65;

    this.dieselSampleFilter = ctx.createBiquadFilter();
    this.dieselSampleFilter.type = 'lowpass';
    this.dieselSampleFilter.frequency.value = 180;
    this.dieselSampleFilter.Q.value = 0.6;
    this.dieselSampleGain = ctx.createGain();
    this.dieselSampleGain.gain.value = 0;
    this.dieselStateGains = [0, 1, 2, 3].map(() => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.dieselSampleFilter);
      return gain;
    });

    this.dieselShaper.connect(this.dieselHull);
    this.dieselHull.connect(this.dieselLowpass);
    this.dieselLowpass.connect(this.dieselGain);
    this.dieselGain.connect(this.shipBus);
    this.dieselSampleFilter.connect(this.dieselSampleGain);
    this.dieselSampleGain.connect(this.shipBus);

    // Deep water churn noise (propeller screw displacing tons of water)
    this.churnNoise = ctx.createBufferSource();
    this.churnNoise.buffer = this.noiseBuffer;
    this.churnNoise.loop = true;

    this.churnFilter = ctx.createBiquadFilter();
    this.churnFilter.type = 'lowpass';
    this.churnFilter.frequency.value = 95;
    this.churnFilter.Q.value = 2.0;

    this.churnGain = ctx.createGain();
    this.churnGain.gain.value = 0.3;

    this.churnNoise.connect(this.churnFilter);
    this.churnFilter.connect(this.churnGain);
    this.churnGain.connect(this.shipBus);

    this.dieselOsc.start();
    this.churnNoise.start();
  }

  // ==========================================
  // 3. WATER, SEA AMBIENT & HULL WAKE RUSH
  // ==========================================
  _buildWaterAndSea() {
    const ctx = this.ctx;

    // Ambient open sea breathing noise
    this.seaNoise = ctx.createBufferSource();
    this.seaNoise.buffer = this.noiseBuffer;
    this.seaNoise.loop = true;

    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = 'lowpass';
    this.seaFilter.frequency.value = 420;

    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.3;

    this.seaNoise.connect(this.seaFilter);
    this.seaFilter.connect(this.seaGain);
    this.seaGain.connect(this.waterBus);

    // Wake rushing sound along the hull (smoothly scales with speed)
    this.wakeNoise = ctx.createBufferSource();
    this.wakeNoise.buffer = this.noiseBuffer;
    this.wakeNoise.loop = true;

    this.wakeFilter = ctx.createBiquadFilter();
    this.wakeFilter.type = 'bandpass';
    this.wakeFilter.frequency.value = 550;
    this.wakeFilter.Q.value = 1.0;

    this.wakeGain = ctx.createGain();
    this.wakeGain.gain.value = 0;

    this.wakeNoise.connect(this.wakeFilter);
    this.wakeFilter.connect(this.wakeGain);
    this.wakeGain.connect(this.waterBus);

    this.seaNoise.start();
    this.wakeNoise.start();
  }

  // ==========================================
  // 4. WAVE IMPACT SPLASH & HULL SLAP
  // ==========================================
  _buildSplash() {
    const ctx = this.ctx;

    // Hull low-frequency thud
    this.thudOsc = ctx.createOscillator();
    this.thudOsc.type = 'sine';
    this.thudOsc.frequency.value = 85;

    this.thudGain = ctx.createGain();
    this.thudGain.gain.value = 0;
    this.thudOsc.connect(this.thudGain);
    this.thudGain.connect(this.splashBus);

    // Spray crash noise
    this.sprayNoise = ctx.createBufferSource();
    this.sprayNoise.buffer = this.noiseBuffer;
    this.sprayNoise.loop = true;

    this.sprayFilter = ctx.createBiquadFilter();
    this.sprayFilter.type = 'bandpass';
    this.sprayFilter.frequency.value = 950;
    this.sprayFilter.Q.value = 1.2;

    this.sprayGain = ctx.createGain();
    this.sprayGain.gain.value = 0;

    this.sprayNoise.connect(this.sprayFilter);
    this.sprayFilter.connect(this.sprayGain);
    this.sprayGain.connect(this.splashBus);

    this.thudOsc.start();
    this.sprayNoise.start();
  }

  // ==========================================
  // 5. NAUTICAL HORNS
  // ==========================================
  _buildHorn() {
    const ctx = this.ctx;

    this.hornOsc1 = ctx.createOscillator();
    this.hornOsc1.type = 'sawtooth';
    this.hornOsc1.frequency.value = 440;

    this.hornOsc2 = ctx.createOscillator();
    this.hornOsc2.type = 'sawtooth';
    this.hornOsc2.frequency.value = 554;

    this.hornFilter = ctx.createBiquadFilter();
    this.hornFilter.type = 'lowpass';
    this.hornFilter.frequency.value = 2200;

    this.hornOsc1.connect(this.hornFilter);
    this.hornOsc2.connect(this.hornFilter);
    this.hornFilter.connect(this.hornBus);

    this.shipHornGain = ctx.createGain();
    this.shipHornGain.gain.value = 0;
    this.shipHornGain.connect(this.hornBus);

    this.hornOsc1.start();
    this.hornOsc2.start();
  }

  _playOneShot(buffer, bus, peakGain, releaseSeconds) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(bus);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + releaseSeconds);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
  }

  triggerHorn(active) {
    if (!this.ctx || !this.enabled) return;
    this.hornActive = active;
    const now = this.ctx.currentTime;

    if (active) {
      if (this.shipMode) {
        if (this.shipHornBuffer) {
          const source = this.ctx.createBufferSource();
          source.buffer = this.shipHornBuffer;
          source.connect(this.shipHornGain);
          source.onended = () => { if (this.shipHornSource === source) this.shipHornSource = null; };
          this.shipHornSource = source;
          this.shipHornGain.gain.cancelScheduledValues(now);
          this.shipHornGain.gain.setValueAtTime(0, now);
          this.shipHornGain.gain.linearRampToValueAtTime(0.65, now + 0.035);
          this.hornBus.gain.cancelScheduledValues(now);
          this.hornBus.gain.setTargetAtTime(1, now, 0.035);
          source.start(now);
        } else {
          // Procedural foghorn remains available while the recording loads or if it is missing.
          this.hornOsc1.frequency.setTargetAtTime(82, now, 0.02);
          this.hornOsc2.frequency.setTargetAtTime(110, now, 0.02);
          this.hornFilter.frequency.setTargetAtTime(750, now, 0.02);
          this.hornBus.gain.cancelScheduledValues(now);
          this.hornBus.gain.setTargetAtTime(0.55, now, 0.08);
        }
      } else {
        // Motorboat dual-tone air horn
        this.hornOsc1.frequency.setTargetAtTime(440, now, 0.02);
        this.hornOsc2.frequency.setTargetAtTime(554, now, 0.02);
        this.hornFilter.frequency.setTargetAtTime(2200, now, 0.02);
        this.hornBus.gain.cancelScheduledValues(now);
        this.hornBus.gain.setTargetAtTime(0.40, now, 0.04);
      }
    } else {
      this.hornBus.gain.cancelScheduledValues(now);
      this.hornBus.gain.setTargetAtTime(0, now, 0.12);
      if (this.shipHornSource) {
        const source = this.shipHornSource;
        this.shipHornSource = null;
        source.onended = null;
        this.shipHornGain.gain.cancelScheduledValues(now);
        this.shipHornGain.gain.setTargetAtTime(0, now, 0.035);
        source.stop(now + 0.14);
      }
    }
  }

  toggle() {
    if (!this.ctx) {
      this.init();
    }
    this.ctx.resume();
    this.enabled = !this.enabled;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.enabled ? 0.85 : 0, now, 0.12);
    return this.enabled;
  }

  update(state, body, dt, ship, settings) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    this.shipMode = ship;

    const throttle = Math.max(0, state.throttle);
    const speed = Math.abs(state.speed);
    const isAirborne = body.airborne;

    // Crossfade between Kıyı 28 (Motorbot) and Mavi 52 (Gemi)
    this.boatBus.gain.setTargetAtTime(ship ? 0 : 1, now, 0.12);
    this.shipBus.gain.setTargetAtTime(ship ? 1 : 0, now, 0.12);

    if (!ship) {
      // ----------------------------------------------------
      // KIYI 28 - SMOOTH CONTINUOUS OUTBOARD MOTOR DYNAMICS
      // ----------------------------------------------------
      const maxBoatSpeed = 21.0;
      const speedRatio = Math.min(1, Math.max(0, speed / maxBoatSpeed));

      const engineMix = boatEngineMix(speed, throttle, isAirborne, this.boatSampleSources.map(Boolean));

      this.engineHz += (engineMix.frequency - this.engineHz) * (1 - Math.exp(-dt * 6.0));

      this.boatOsc.frequency.setTargetAtTime(this.engineHz, now, 0.04);
      this.boatOscDetune.frequency.setTargetAtTime(this.engineHz * 1.014, now, 0.04);
      this.boatMuffler.frequency.setTargetAtTime(engineMix.mufflerCutoff, now, 0.06);
      this.boatGain.gain.setTargetAtTime(engineMix.synthGain, now, 0.06);

      this.boatSampleSources.forEach((source, index) => {
        if (source) source.playbackRate.setTargetAtTime(engineMix.playbackRate, now, 0.35);
        this.boatStateGains[index].gain.setTargetAtTime(
          engineMix.weights[index] * BOAT_SAMPLE_NORMALIZATION[index],
          now,
          0.24,
        );
      });
      this.boatSampleFilter.frequency.setTargetAtTime(engineMix.sampleFilter, now, 0.2);
      this.boatSampleGain.gain.setTargetAtTime(engineMix.sampleGain, now, 0.25);

    } else {
      // ----------------------------------------------------
      // MAVI 52 - RECORDED DIESEL STATE CROSSFADE
      // ----------------------------------------------------
      const engineMix = shipEngineMix(speed, throttle, this.dieselSampleSources.map(Boolean));
      this.dieselHz += (engineMix.frequency - this.dieselHz) * (1 - Math.exp(-dt * 2.5));

      this.dieselOsc.frequency.setTargetAtTime(this.dieselHz, now, 0.06);
      this.dieselLowpass.frequency.setTargetAtTime(engineMix.lowpass, now, 0.12);
      this.dieselGain.gain.setTargetAtTime(engineMix.synthGain, now, 0.18);

      this.dieselSampleSources.forEach((source, index) => {
        if (source) source.playbackRate.setTargetAtTime(engineMix.playbackRate, now, 0.45);
        this.dieselStateGains[index].gain.setTargetAtTime(
          engineMix.weights[index] * DIESEL_SAMPLE_NORMALIZATION[index],
          now,
          0.3,
        );
      });
      this.dieselSampleFilter.frequency.setTargetAtTime(engineMix.sampleFilter, now, 0.25);
      this.dieselSampleGain.gain.setTargetAtTime(engineMix.sampleGain, now, 0.3);

      this.churnFilter.frequency.setTargetAtTime(80 + engineMix.speedRatio * 110, now, 0.18);
      const churnVariation = 1 + Math.sin(now * 0.63) * 0.025 + Math.sin(now * 0.37 + 1.2) * 0.015;
      this.churnGain.gain.setTargetAtTime(engineMix.churnGain * churnVariation, now, 0.28);
    }

    // ----------------------------------------------------
    // WATER RUSH, SEA AMBIENT & IMPACT SPLASH
    // ----------------------------------------------------
    // Hull water rush: volume and brightness scale directly with speed
    const currentSpeedRatio = Math.min(1, speed / (ship ? 13.0 : 21.0));
    this.wakeFilter.frequency.setTargetAtTime(350 + currentSpeedRatio * 750, now, 0.08);
    const wakeGain = currentSpeedRatio * (ship ? 0.3 : 0.48);
    const wakeVariation = ship ? 1 + Math.sin(now * 0.41) * 0.025 : 1;
    this.wakeGain.gain.setTargetAtTime(wakeGain * wakeVariation, now, ship ? 0.24 : 0.08);

    // Ocean swell
    const waveStrength = settings.waves ?? 1.15;
    this.seaGain.gain.setTargetAtTime(0.2 + waveStrength * 0.14, now, 0.1);
    this.seaFilter.frequency.setTargetAtTime(340 + waveStrength * 120, now, 0.1);

    // Wave impact / splash
    this.impactCooldown -= dt;
    if (body.impact > 0.8 && this.impactCooldown <= 0 && (body.impact - this.lastImpact > 0.35 || body.impact > 1.8)) {
      this.impactCooldown = 0.35;
      const intensity = Math.min(1, body.impact / 3.5);

      // Hull thud
      this.thudOsc.frequency.cancelScheduledValues(now);
      this.thudOsc.frequency.setValueAtTime(ship ? 50 : 85, now);
      this.thudOsc.frequency.exponentialRampToValueAtTime(ship ? 32 : 45, now + 0.18);

      this.thudGain.gain.cancelScheduledValues(now);
      this.thudGain.gain.setValueAtTime(intensity * 0.5, now);
      this.thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      // Water spray burst
      if (ship && this.shipSplashBuffer) {
        this._playOneShot(this.shipSplashBuffer, this.splashBus, intensity * 0.45, 0.55);
      } else {
        this.sprayFilter.frequency.setValueAtTime(750 + intensity * 600, now);
        this.sprayGain.gain.cancelScheduledValues(now);
        this.sprayGain.gain.setValueAtTime(intensity * 0.45, now);
        this.sprayGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      }
    }
    this.lastImpact = body.impact;
  }
}
