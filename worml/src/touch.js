// Touch controls for phones and tablets: a floating stick under the left
// thumb, drag-to-look anywhere else, and hold buttons under the right thumb.
// Everything lands in `input.touch`, which Input merges with the keyboard.

const BUTTONS = [
  { id: 'fly', label: 'FLY', hold: true },
  { id: 'up', label: '▲', hold: true },
  { id: 'down', label: '▼', hold: true },
  { id: 'grip', label: 'GATHER', hold: true },
  { id: 'act', label: 'GATE', hold: false },
];

export class TouchControls {
  constructor(input, root) {
    this.input = input; this.root = root;
    this.enabled = false;
    this.stickId = null; this.lookId = null;
    this.origin = { x: 0, y: 0 }; this.last = { x: 0, y: 0 };

    const pad = this.pad = root.querySelector('#t-pad');
    this.base = root.querySelector('#t-base');
    this.knob = root.querySelector('#t-knob');
    this.btn = {};
    const cluster = root.querySelector('#t-buttons');
    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = 't-btn t-' + b.id; el.textContent = b.label;
      cluster.appendChild(el);
      this.btn[b.id] = el;
      const set = (v) => {
        el.classList.toggle('on', !!v);
        const t = input.touch;
        if (b.id === 'act') { if (v) t.act = true; } else t[b.id] = v ? 1 : 0;
      };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } set(true); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
    }

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch { /* fine */ }
      const leftSide = e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.3;
      if (leftSide && this.stickId === null) {
        this.stickId = e.pointerId;
        this.origin.x = e.clientX; this.origin.y = e.clientY;
        this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
        this.base.classList.add('on');
        this.moveKnob(0, 0);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.last.x = e.clientX; this.last.y = e.clientY;
      }
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) {
        const R = 56;
        let dx = (e.clientX - this.origin.x) / R, dy = (e.clientY - this.origin.y) / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.moveKnob(dx, dy);
        const dead = l < 0.12 ? 0 : 1;
        input.touch.move.set(dx * dead, -dy * dead);
      } else if (e.pointerId === this.lookId) {
        const k = 0.0052 * Math.min(1, 900 / Math.max(innerWidth, innerHeight)) + 0.0012;
        input.look((e.clientX - this.last.x) * k, (e.clientY - this.last.y) * k);
        this.last.x = e.clientX; this.last.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null; input.touch.move.set(0, 0);
        this.base.classList.remove('on'); this.base.style.left = this.base.style.top = '';
        this.moveKnob(0, 0);
      } else if (e.pointerId === this.lookId) this.lookId = null;
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  moveKnob(dx, dy) { this.knob.style.transform = `translate(${dx * 46}px, ${dy * 46}px)`; }

  setEnabled(on) {
    this.enabled = on;
    this.input.touch.on = on;
    this.root.hidden = !on;
    if (!on) { const t = this.input.touch; t.move.set(0, 0); t.fly = t.up = t.down = t.grip = 0; }
  }

  // Dev demos light up the button they are "pressing".
  highlight(ids) {
    for (const id in this.btn) this.btn[id].classList.toggle('demo', ids.includes(id));
    this.base.classList.toggle('demo', ids.includes('stick'));
  }
}
