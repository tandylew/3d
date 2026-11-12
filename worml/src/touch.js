// Touch controls for phones and tablets.
//
// The lower part of the screen is two floating sticks: left moves, right
// looks. Double-tap the right (look) side to super leap. Everything above is
// open: with nothing to fight, dragging there looks around; when a guardian
// or a seal is near, it takes attack gestures instead:
//   swipe              a blade of your element across the view (free)
//   tap                a quick cast at that spot (spends essence)
//   press and release  a charged cast; let go on the flash for a perfect one
// The only buttons are for the time relic, once you own one.

const BUTTONS = [
  { id: 'time', label: 'TIME' },
  { id: 'cycle', label: '⟳' },
];
const STICK_ZONE = 0.5;     // fraction of the screen height (from the bottom) that belongs to the sticks

class Stick {
  constructor(el, out) {
    this.el = el; this.knob = el.firstElementChild; this.out = out;
    this.id = null; this.ox = 0; this.oy = 0;
  }

  start(e) {
    this.id = e.pointerId; this.ox = e.clientX; this.oy = e.clientY;
    this.el.style.left = e.clientX + 'px'; this.el.style.top = e.clientY + 'px'; this.el.style.right = 'auto';
    this.el.classList.add('on');
    this.set(0, 0);
  }

  move(e) {
    const R = 56;
    let dx = (e.clientX - this.ox) / R, dy = (e.clientY - this.oy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.set(dx, dy);
    const dead = l < 0.12 ? 0 : 1;
    this.out.set(dx * dead, -dy * dead);
    return l;
  }

  end() {
    this.id = null; this.out.set(0, 0);
    this.el.classList.remove('on'); this.el.style.left = this.el.style.top = this.el.style.right = '';
    this.set(0, 0);
  }

  set(dx, dy) { this.knob.style.transform = `translate(${dx * 46}px, ${dy * 46}px)`; }
}

export class TouchControls {
  constructor(input, root) {
    this.input = input; this.root = root;
    this.enabled = false;
    const t = input.touch;
    const pad = this.pad = root.querySelector('#t-pad');
    this.left = new Stick(root.querySelector('#t-left'), t.move);
    this.right = new Stick(root.querySelector('#t-right'), t.look);
    this.ring = root.querySelector('#t-ring');
    this.hint = root.querySelector('#t-hint');
    this.btn = {};
    const cluster = root.querySelector('#t-buttons');
    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = 't-btn t-' + b.id; el.textContent = b.label; el.hidden = true;
      cluster.appendChild(el);
      this.btn[b.id] = el;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        t[b.id] = true; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 160);
      });
    }
    this.free = new Map();       // pointers in the open area: look-drags or gestures
    this.lastTap = 0; this.lastTapX = 0;
    const ndc = (e) => [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2];

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch { /* fine */ }
      const low = e.clientY > innerHeight * (1 - STICK_ZONE);
      if (low) {
        const s = e.clientX < innerWidth / 2 ? this.left : this.right;
        if (s === this.right) {
          // double tap on the look side: super leap
          const now = performance.now();
          if (now - this.lastTap < 320 && Math.abs(e.clientX - this.lastTapX) < 90) { t.jump = true; this.lastTap = 0; } else { this.lastTap = now; this.lastTapX = e.clientX; }
        }
        if (s.id === null) { s.start(e); return; }
      }
      const [x, y] = ndc(e);
      const f = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, nx: x, ny: y, t0: performance.now(), gesture: t.combat, moved: 0, path: [[x, y]] };
      this.free.set(e.pointerId, f);
      if (f.gesture && t.holdT < 0) { t.holdT = 0; t.holdX = x; t.holdY = y; this.holder = e.pointerId; this.ring.style.left = e.clientX + 'px'; this.ring.style.top = e.clientY + 'px'; }
    });
    pad.addEventListener('pointermove', (e) => {
      for (const s of [this.left, this.right]) if (e.pointerId === s.id) { if (s.move(e) > 0.5 && s === this.right) this.lastTap = 0; return; }
      const f = this.free.get(e.pointerId); if (!f) return;
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      f.x = e.clientX; f.y = e.clientY; f.moved = Math.hypot(f.x - f.x0, f.y - f.y0);
      if (!f.gesture) { const k = 0.0052 * Math.min(1, 900 / Math.max(innerWidth, innerHeight)) + 0.0012; input.look(dx * k, dy * k); return; }
      f.path.push(ndc(e));
      if (f.moved > 22 && this.holder === e.pointerId) { t.holdT = -1; this.holder = null; }     // it has become a swipe
    });
    const end = (e) => {
      for (const s of [this.left, this.right]) if (e.pointerId === s.id) { s.end(); return; }
      const f = this.free.get(e.pointerId); if (!f) return;
      this.free.delete(e.pointerId);
      if (!f.gesture) return;
      const dur = (performance.now() - f.t0) / 1000;
      if (this.holder === e.pointerId) { this.holder = null; }
      if (f.moved > 40) {
        const [x1, y1] = ndc(e);
        // fast, long swipes cut harder
        const speed = f.moved / Math.max(0.05, dur), power = Math.max(0.2, Math.min(1, (speed - 500) / 1700 + f.moved / (innerHeight * 1.2)));
        t.gestures.push({ type: 'swipe', x: f.nx, y: f.ny, dx: x1 - f.nx, dy: y1 - f.ny, t: dur, power, path: f.path });
      } else if (e.type !== 'pointercancel') {
        t.gestures.push({ type: dur > 0.22 ? 'hold' : 'tap', x: f.nx, y: f.ny, t: dur });
      }
      if (t.holdT >= 0 && !this.holder) t.holdT = -1;
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEnabled(on) {
    this.enabled = on;
    this.input.touch.on = on;
    this.root.hidden = !on;
    if (!on) { const t = this.input.touch; t.move.set(0, 0); t.look.set(0, 0); t.holdT = -1; this.free.clear(); }
  }

  // Called every frame: advance the press-and-hold charge, reflect game state.
  sync(s, dt) {
    const b = this.btn, t = this.input.touch;
    if (t.holdT >= 0 && this.holder != null) t.holdT += dt;
    const charging = t.holdT > 0.12;
    this.ring.hidden = !charging;
    if (charging) {
      const k = Math.min(1, t.holdT / s.w0);
      this.ring.style.setProperty('--k', k.toFixed(3));
      this.ring.style.setProperty('--c', s.castCss || '#cfe0ff');
      this.ring.classList.toggle('perfect', t.holdT >= s.w0 && t.holdT <= s.w1);
      this.ring.classList.toggle('over', t.holdT > s.w1);
    }
    this.hint.hidden = !t.combat;
    this.root.classList.toggle('combat', t.combat);
    b.time.hidden = !s.weapon;
    b.cycle.hidden = !s.weapon || !s.weapon.many;
    if (s.weapon) {
      b.time.textContent = s.weapon.short; b.time.style.setProperty('--c', s.weapon.css);
      b.time.classList.toggle('empty', !s.weapon.ready);
      b.time.dataset.n = s.weapon.count ?? '';
    }
  }

  // Dev demos light up the control they are "pressing".
  highlight(ids) {
    for (const id in this.btn) this.btn[id].classList.toggle('demo', ids.includes(id));
    this.left.el.classList.toggle('demo', ids.includes('stick'));
    this.right.el.classList.toggle('demo', ids.includes('look') || ids.includes('jump'));
    this.hint.classList.toggle('demo', ids.includes('cast') || ids.includes('slash'));
  }
}
