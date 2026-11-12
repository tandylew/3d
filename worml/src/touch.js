// Touch controls for phones and tablets: twin sticks (left moves, right looks)
// and a small arc of action buttons. Everything lands in `input.touch`, which
// Input merges with the keyboard.

const BUTTONS = [
  { id: 'cast', label: 'CAST', hold: true },
  { id: 'time', label: 'TIME' },
  { id: 'cycle', label: '⟳' },
  { id: 'jump', label: 'LEAP' },
  { id: 'fly', label: 'FLY', toggle: true },
];

class Stick {
  constructor(el, out, side) {
    this.el = el; this.knob = el.firstElementChild; this.out = out; this.side = side;
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
    this.left = new Stick(root.querySelector('#t-left'), t.move, 'left');
    this.right = new Stick(root.querySelector('#t-right'), t.look, 'right');
    this.btn = {};
    const cluster = root.querySelector('#t-buttons');
    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = 't-btn t-' + b.id; el.textContent = b.label;
      cluster.appendChild(el);
      this.btn[b.id] = el;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
        if (b.toggle) input.flyMode = !input.flyMode;
        else if (b.hold) { t[b.id] = 1; el.classList.add('on'); }
        else { t[b.id] = true; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 160); }
      });
      if (b.hold) for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => { t[b.id] = 0; el.classList.remove('on'); });
    }

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch { /* fine */ }
      const s = e.clientX < innerWidth / 2 ? this.left : this.right;
      if (s.id === null) s.start(e);
    });
    pad.addEventListener('pointermove', (e) => { for (const s of [this.left, this.right]) if (e.pointerId === s.id) s.move(e); });
    const end = (e) => { for (const s of [this.left, this.right]) if (e.pointerId === s.id) s.end(); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEnabled(on) {
    this.enabled = on;
    this.input.touch.on = on;
    this.root.hidden = !on;
    if (!on) { const t = this.input.touch; t.move.set(0, 0); t.look.set(0, 0); t.cast = 0; }
  }

  // Called every frame: reflect game state on the buttons (what CAST will
  // throw, which relic TIME uses and whether it is ready).
  sync(s) {
    const b = this.btn;
    b.fly.classList.toggle('on', this.input.flyMode);
    b.cast.style.setProperty('--c', s.castCss || '#8899aa');
    b.cast.classList.toggle('empty', !s.castCount);
    b.cast.dataset.n = s.castCount || '';
    b.cast.style.setProperty('--p', Math.round(s.charge * 100) + '%');
    b.cast.classList.toggle('perfect', !!s.perfect);
    b.time.hidden = b.cycle.hidden = !s.weapon;
    if (s.weapon) {
      b.time.textContent = s.weapon.short; b.time.style.setProperty('--c', s.weapon.css);
      b.time.classList.toggle('empty', !s.weapon.ready);
      b.time.dataset.n = s.weapon.count ?? '';
      b.cycle.hidden = !s.weapon.many;
    }
  }

  // Dev demos light up the control they are "pressing".
  highlight(ids) {
    for (const id in this.btn) this.btn[id].classList.toggle('demo', ids.includes(id));
    this.left.el.classList.toggle('demo', ids.includes('stick'));
    this.right.el.classList.toggle('demo', ids.includes('look'));
  }
}
