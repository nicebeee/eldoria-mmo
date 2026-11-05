// Игровой сервер «Хроник Эльдории»: раздаёт клиент, хранит аккаунты,
// симулирует общий мир (монстры) и пересылает состояние игроков.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CLASSES, SLOTS, MAX_LEVEL, MAX_ALLOC, newSave, makeMaxItem } from '../src/data.js';
import { World } from './world.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, '..', 'dist');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const PORT = Number(process.env.PORT) || 8080;

// ------------------------------------------------ аккаунты
fs.mkdirSync(DATA_DIR, { recursive: true });
let accounts = {};
try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { accounts = {}; }
let dirty = false;
function persist() {
  if (!dirty) return;
  dirty = false;
  const tmp = ACCOUNTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts));
  fs.renameSync(tmp, ACCOUNTS_FILE);
}
setInterval(persist, 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { persist(); process.exit(0); });

const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');

function register(name, pass, classId) {
  name = String(name || '').trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_]{3,16}$/.test(name)) throw new Error('Имя героя: 3–16 символов (буквы, цифры, _)');
  if (String(pass || '').length < 4) throw new Error('Пароль должен быть не короче 4 символов');
  if (!CLASSES[classId]) throw new Error('Неизвестный класс');
  const key = name.toLowerCase();
  if (accounts[key]) throw new Error('Герой с таким именем уже существует');
  const salt = crypto.randomBytes(16).toString('hex');
  accounts[key] = { username: name, salt, hash: hashPass(pass, salt), created: Date.now(), save: newSave(name, classId) };
  dirty = true;
  return accounts[key];
}

function login(name, pass) {
  const acc = accounts[String(name || '').trim().toLowerCase()];
  if (!acc) throw new Error('Герой не найден — зарегистрируйтесь');
  if (acc.hash !== hashPass(String(pass || ''), acc.salt)) throw new Error('Неверный пароль');
  return acc;
}

// ------------------------------------------------ админка
const ADMINS = (process.env.ADMINS || 'nicebee').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (acc) => ADMINS.includes(acc.username.toLowerCase());

function adminCommand(player, m) {
  const sys = (msg) => player.send({ t: 'sys', msg });
  if (!isAdmin(player.account)) return sys('Нет прав администратора');
  const cmd = m.cmd;
  if (cmd !== 'max_item' && cmd !== 'max_stat') return sys('Неизвестная команда');
  const name = String(m.target || '').trim() || player.account.username;
  const acc = accounts[name.toLowerCase()];
  if (!acc) return sys(`Герой «${name}» не найден`);
  const weapon = CLASSES[acc.save.classId].weapon;
  const items = cmd === 'max_item' ? SLOTS.map((s) => makeMaxItem(s, weapon)) : null;
  const online = world.findByAccount(acc.username);
  if (online) {
    online.send({ t: 'admin_apply', cmd, items, by: player.account.username });
  } else {
    // герой не в игре — правим его сохранение напрямую
    const s = acc.save;
    if (items) {
      for (const it of items) {
        const old = s.equipment[it.slot];
        s.equipment[it.slot] = it;
        const free = s.inventory.indexOf(null);
        if (old && free >= 0) s.inventory[free] = old;
      }
    } else {
      s.level = MAX_LEVEL; s.xp = 0; s.statPoints = 0;
      s.alloc = { str: MAX_ALLOC, agi: MAX_ALLOC, int: MAX_ALLOC, vit: MAX_ALLOC };
      delete s.hp; delete s.mp;
    }
    dirty = true;
  }
  sys(`${cmd === 'max_item' ? 'Легендарный комплект выдан' : 'Максимальные характеристики выданы'}: ${acc.username}${online ? '' : ' (не в сети — применится при входе)'}`);
}

// ------------------------------------------------ статика
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
  let file = path.normalize(path.join(DIST, url));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Сначала соберите клиент: npm run build'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(buf);
  });
});

// ------------------------------------------------ сеть
const world = new World();
const wss = new WebSocketServer({ server, path: '/ws' });
let nextId = 1;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  let player = null;
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!player) {
      if (m.t !== 'login' && m.t !== 'register') return;
      try {
        const acc = m.t === 'register' ? register(m.name, m.pass, m.classId) : login(m.name, m.pass);
        // если герой уже в игре с другой вкладки — выкидываем старую сессию
        const old = world.findByAccount(acc.username);
        if (old) { old.send({ t: 'kicked', msg: 'Вход с другого устройства' }); old.ws.close(); world.removePlayer(old.id); }
        player = world.addPlayer(nextId++, ws, send, acc);
        send({ t: 'welcome', id: player.id, save: acc.save, admin: isAdmin(acc), ...world.snapshot(player.id) });
        world.broadcast({ t: 'sys', msg: `${acc.username} вошёл в игру` }, player.id);
      } catch (e) {
        send({ t: 'auth_err', msg: e.message });
      }
      return;
    }
    if (m.t === 'save' && m.data) {
      const acc = accounts[player.account.username.toLowerCase()];
      acc.save = { ...m.data, name: acc.username, classId: acc.save.classId };
      dirty = true;
      return;
    }
    if (m.t === 'admin') return adminCommand(player, m);
    world.onMessage(player, m);
  });

  ws.on('close', () => {
    if (!player) return;
    world.removePlayer(player.id);
    world.broadcast({ t: 'sys', msg: `${player.account.username} покинул игру` });
    persist();
  });
});

// отключаем «зависшие» соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Eldoria server on http://localhost:${PORT} (data: ${DATA_DIR})`));
