// Every sound is synthesised here with WebAudio — no files, nothing loaded. Short one-shot effects
// are plucked oscillators and shaped noise; the music is a 32-step loop (kick, snare, hats, bass,
// lead) driven by a look-ahead scheduler that adds layers as the waves get harder. The AudioContext
// is created lazily on the first user gesture; every method is safe to call before that and simply
// stays silent, so the staged screenshots make no sound and trigger no autoplay warnings.

const BPM = 132;
const SIXTEENTH = 60 / BPM / 4;

// Two bars of 8 beats: Am — F — C — G. MIDI note numbers.
const BASSLINE = [45, 45, 41, 41, 48, 48, 43, 43];
const ARP = [57, 60, 64, 67, 69, 67, 64, 60];

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfx = null;
  let music = null;
  let noise = null;
  let muted = false;
  let intensity = 0;
  let playing = false;
  let timer = 0;
  let nextTime = 0;
  let stepIndex = 0;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(comp);
    sfx = ctx.createGain();
    sfx.gain.value = 0.85;
    sfx.connect(master);
    music = ctx.createGain();
    music.gain.value = 0.42;
    music.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  /** One oscillator with a plucked envelope, optionally behind a lowpass. */
  function tone(bus, type, f0, f1, at, dur, vol, filter) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let out = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      f.Q.value = 1;
      osc.connect(f);
      out = f;
    }
    out.connect(g);
    g.connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  /** Shaped white noise: the filter does the colour, the envelope does the punch. */
  function hiss(bus, at, dur, vol, type, f0, f1, q = 0.9) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(at);
    src.stop(at + dur + 0.03);
  }

  const ready = () => ctx !== null && !muted;
  const now = () => ctx.currentTime + 0.02;

  function scheduleStep(t, i) {
    const bar = i % 16;
    if (i % 4 === 0) tone(music, 'sine', 150, 42, t, 0.16, 0.5); // kick
    if (bar === 4 || bar === 12) hiss(music, t, 0.1, 0.22, 'bandpass', 1900, 1200, 1.1); // snare
    if (intensity >= 2 || i % 2 === 1) hiss(music, t, 0.03, i % 2 === 1 ? 0.07 : 0.05, 'highpass', 6500, 6500); // hats
    if (i % 4 === 0) {
      const f = midi(BASSLINE[(i / 4) % 8]);
      tone(music, 'square', f, f, t, SIXTEENTH * 3.4, 0.26, 340); // bass
    }
    if (intensity >= 1 && i % 2 === 0) {
      const up = intensity >= 2 && i % 8 === 0 ? 2 : 1;
      const f = midi(ARP[(i / 2) % 8]) * up;
      tone(music, 'square', f, f, t, SIXTEENTH * 0.9, 0.055, 1400); // lead
    }
  }

  const api = {
    unlock,
    setMuted(m) {
      muted = m;
      if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
    },
    /** Harder waves thicken the loop: 0 = rhythm only, 1 = lead joins, 2 = full hats, octave up. */
    setIntensity(wave) {
      intensity = Math.min(2, Math.floor(wave / 4));
    },
    shoot() {
      if (!ready()) return;
      tone(sfx, 'square', 560 + Math.random() * 120, 140, now(), 0.08, 0.12);
    },
    eshoot() {
      if (!ready()) return;
      tone(sfx, 'triangle', 320, 150, now(), 0.14, 0.07);
    },
    dash() {
      if (!ready()) return;
      hiss(sfx, now(), 0.22, 0.16, 'bandpass', 320, 2600, 1.4);
    },
    hurt() {
      if (!ready()) return;
      const t = now();
      tone(sfx, 'sawtooth', 300, 55, t, 0.32, 0.3);
      hiss(sfx, t, 0.25, 0.22, 'highpass', 700, 700);
    },
    explode(big) {
      if (!ready()) return;
      const t = now();
      if (big) {
        hiss(sfx, t, 0.9, 0.5, 'lowpass', 1200, 60);
        tone(sfx, 'sine', 130, 30, t, 0.8, 0.4);
        hiss(sfx, t + 0.05, 0.5, 0.25, 'bandpass', 400, 90, 1.2);
      } else {
        hiss(sfx, t, 0.32, 0.3, 'lowpass', 900, 90);
        tone(sfx, 'sine', 170, 45, t, 0.28, 0.2);
      }
    },
    pickup() {
      if (!ready()) return;
      const t = now();
      tone(sfx, 'sine', 660, 660, t, 0.09, 0.2);
      tone(sfx, 'sine', 990, 990, t + 0.08, 0.16, 0.2);
    },
    milestone() {
      if (!ready()) return;
      tone(sfx, 'square', 880, 1660, now(), 0.12, 0.1);
    },
    waveClear() {
      if (!ready()) return;
      const t = now();
      [523, 659, 784].forEach((f, i) => tone(sfx, 'triangle', f, f, t + i * 0.09, 0.14, 0.18));
    },
    waveStart() {
      if (!ready()) return;
      const t = now();
      tone(sfx, 'triangle', 392, 392, t, 0.1, 0.14);
      tone(sfx, 'triangle', 523, 523, t + 0.1, 0.14, 0.14);
    },
    eliteIn() {
      if (!ready()) return;
      const t = now();
      tone(sfx, 'sawtooth', 110, 52, t, 1.1, 0.32, 500);
      tone(sfx, 'square', 440, 440, t + 0.15, 0.12, 0.12);
      tone(sfx, 'square', 440, 440, t + 0.38, 0.12, 0.12);
    },
    gameOver() {
      if (!ready()) return;
      const t = now();
      [392, 311, 262, 196].forEach((f, i) => tone(sfx, 'sawtooth', f, f * 0.97, t + i * 0.21, 0.28, 0.16, 900));
    },
    startMusic() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (playing) return;
      playing = true;
      stepIndex = 0;
      nextTime = ctx.currentTime + 0.08;
      timer = setInterval(() => api.tickMusic(), 25);
    },
    stopMusic() {
      playing = false;
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
    },
    tickMusic() {
      if (!playing || !ctx) return;
      while (nextTime < ctx.currentTime + 0.14) {
        scheduleStep(nextTime, stepIndex);
        nextTime += SIXTEENTH;
        stepIndex = (stepIndex + 1) % 32;
      }
    },
  };

  return api;
}
