// Fully synthesised audio (no assets): thruster wind, a per-world ambient pad,
// and short cues for pickups, gate unlocks and wormhole transits.
const ROOTS = { water: 196.0, fire: 146.83, metal: 220.0, wood: 174.61, earth: 130.81, magic: 233.08 };

export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 300; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    src.connect(this.windF).connect(this.windG).connect(this.master); src.start();

    this.padG = ctx.createGain(); this.padG.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.padG.connect(lp).connect(this.master);
    this.pad = [1, 1.5, 2.005, 2.52].map((m, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine';
      const g = ctx.createGain(); g.gain.value = 0.2 / (i + 1);
      o.connect(g).connect(this.padG); o.start();
      return { o, m };
    });
    this.element = null;
  }

  update(speed, thrusting, element, nearW) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.min(1, Math.log10(1 + speed / 8) / 4);
    this.windG.gain.setTargetAtTime(v * 0.5 + (thrusting ? 0.04 : 0), t, 0.15);
    this.windF.frequency.setTargetAtTime(180 + v * 1900, t, 0.2);
    if (element !== this.element) {
      this.element = element;
      for (const p of this.pad) p.o.frequency.setTargetAtTime((ROOTS[element] || 160) * p.m * 0.5, t, 1.2);
    }
    this.padG.gain.setTargetAtTime(0.1 + 0.16 * nearW, t, 0.8);
  }

  tone(freq, dur, type = 'sine', gain = 0.25, delay = 0, slide = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  sweep(dur, f0, f1, gain = 0.5) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.1);
  }

  pickup(element) { const r = (ROOTS[element] || 200) * 2; this.tone(r, 0.25, 'sine', 0.22); this.tone(r * 1.5, 0.35, 'sine', 0.18, 0.07); }
  deliver(element) { const r = ROOTS[element] || 200; this.tone(r * 2, 0.3, 'triangle', 0.2, 0, 1.5); }
  unlock() { [1, 1.25, 1.5, 2, 2.5, 3].forEach((m, i) => this.tone(220 * m, 1.6, 'sine', 0.2, i * 0.16)); this.sweep(3, 200, 3000, 0.35); }
  warp() { this.sweep(2.8, 150, 5000, 0.6); this.tone(70, 2.6, 'sawtooth', 0.12, 0, 6); }
  discover() { this.tone(392, 0.6, 'sine', 0.18); this.tone(587.3, 0.9, 'sine', 0.18, 0.18); }
  win() { [1, 1.25, 1.5, 2, 2.5, 3, 4].forEach((m, i) => this.tone(196 * m, 3, 'triangle', 0.18, i * 0.22)); }
}
