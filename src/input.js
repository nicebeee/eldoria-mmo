import { clamp } from './utils.js';

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.drag = null;
    const canvas = game.canvas;

    this.onKeyDown = (e) => {
      if (game.ui.isTyping()) {
        if (e.code === 'Escape') document.activeElement.blur();
        return;
      }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (!e.repeat) game.onKey(e);
    };
    this.onKeyUp = (e) => { this.keys[e.code] = false; };
    this.onBlur = () => { this.keys = {}; this.drag = null; };

    this.onMouseDown = (e) => {
      this.drag = { button: e.button, sx: e.clientX, sy: e.clientY, moved: false };
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    };
    this.onMouseMove = (e) => {
      if (!this.drag) return;
      if (Math.abs(e.clientX - this.drag.sx) + Math.abs(e.clientY - this.drag.sy) > 4) {
        this.drag.moved = true;
        canvas.style.cursor = 'grabbing';
      }
      if (this.drag.moved) {
        const c = game.cam;
        c.yaw -= e.movementX * 0.006;
        c.pitch = clamp(c.pitch + e.movementY * 0.005, -0.15, 1.35);
      }
    };
    this.onMouseUp = (e) => {
      if (!this.drag) return;
      if (!this.drag.moved && e.target === canvas) game.onClick(e.clientX, e.clientY, this.drag.button);
      this.drag = null;
      canvas.style.cursor = '';
    };
    this.onWheel = (e) => {
      e.preventDefault();
      game.cam.dist = clamp(game.cam.dist + e.deltaY * 0.01, 3, 22);
    };

    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
