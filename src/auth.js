// Локальные аккаунты (localStorage). Позже заменим на сервер.
import { newSave } from './data.js';

const KEY = 'eldoria.accounts.v1';
const LAST = 'eldoria.last';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function storeAll(all) {
  localStorage.setItem(KEY, JSON.stringify(all));
}

async function hash(str) {
  const data = 'eldoria:' + str;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = (h * 33) ^ data.charCodeAt(i);
  return 'f' + (h >>> 0).toString(16);
}

export async function register(username, password, password2, classId) {
  username = username.trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_]{3,16}$/.test(username)) throw new Error('Имя героя: 3–16 символов (буквы, цифры, _)');
  if (password.length < 4) throw new Error('Пароль должен быть не короче 4 символов');
  if (password !== password2) throw new Error('Пароли не совпадают');
  const all = loadAll();
  const key = username.toLowerCase();
  if (all[key]) throw new Error('Герой с таким именем уже существует');
  const acc = { username, pass: await hash(password), created: Date.now(), save: newSave(username, classId) };
  all[key] = acc;
  storeAll(all);
  localStorage.setItem(LAST, username);
  return acc;
}

export async function login(username, password) {
  const acc = loadAll()[username.trim().toLowerCase()];
  if (!acc) throw new Error('Герой не найден — зарегистрируйтесь');
  if (acc.pass !== (await hash(password))) throw new Error('Неверный пароль');
  localStorage.setItem(LAST, acc.username);
  return acc;
}

export function saveAccount(acc) {
  const all = loadAll();
  all[acc.username.toLowerCase()] = acc;
  storeAll(all);
}

export function getLastUser() {
  return localStorage.getItem(LAST) || '';
}

export function listHeroes() {
  return Object.values(loadAll()).map((a) => ({ name: a.username, classId: a.save?.classId, level: a.save?.level }));
}
