// WebSocket-соединение с игровым сервером
const env = import.meta.env;
export const SERVER_URL = env.VITE_SERVER_URL
  || (env.DEV ? `ws://${location.hostname}:8080/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.queue = null; // буфер сообщений, пока игра загружается
    this.waiters = [];
    this.onClose = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return this.ready;
    this.ws = new WebSocket(SERVER_URL);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('Сервер недоступен. Попробуйте позже.'));
    });
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.types.includes(m.t)) { this.waiters.splice(i, 1); w.resolve(m); }
      }
      if (this.queue) { this.queue.push(m); return; }
      this.dispatch(m);
    };
    this.ws.onclose = () => {
      this.ws = null;
      for (const w of this.waiters) w.reject(new Error('Соединение с сервером потеряно'));
      this.waiters = [];
      if (this.onClose) this.onClose();
    };
    return this.ready;
  }

  dispatch(m) {
    const h = this.handlers[m.t];
    if (h) h(m);
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  // отправить запрос и дождаться одного из ответов
  request(m, types) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ types, resolve, reject });
      this.send(m);
    });
  }

  hold() { this.queue = []; }

  release() {
    const q = this.queue || [];
    this.queue = null;
    for (const m of q) this.dispatch(m);
  }
}
