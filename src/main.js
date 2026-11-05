import * as THREE from 'three';
import './style.css';
import { Net } from './net.js';
import { CLASSES, STAT_KEYS, STAT_NAMES, generateItem } from './data.js';
import { createHumanoid, applyEquipment, animateModel, playAttack } from './models.js';
import { Game } from './game.js';

const $ = (s) => document.querySelector(s);
let selectedClass = 'warrior';

// ------------------------------------------------ вкладки
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#login-form').classList.toggle('hidden', name !== 'login');
  $('#register-form').classList.toggle('hidden', name !== 'register');
  $('#auth-error').textContent = '';
  $('#auth-screen').classList.toggle('reg', name === 'register');
  if (name === 'register') preview.resize();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ------------------------------------------------ выбор класса
const cardsEl = $('#class-cards');
for (const cls of Object.values(CLASSES)) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'class-card';
  c.dataset.class = cls.id;
  c.innerHTML = `<div class="cc-ico">${cls.icon}</div><div class="cc-name">${cls.name}</div>`;
  c.onclick = () => selectClass(cls.id);
  cardsEl.appendChild(c);
}

function selectClass(id) {
  selectedClass = id;
  const cls = CLASSES[id];
  document.querySelectorAll('.class-card').forEach((c) => c.classList.toggle('active', c.dataset.class === id));
  $('#class-info').innerHTML = `<div class="ci-name">${cls.icon} ${cls.name}</div><p>${cls.desc}</p>
    <div class="ci-stats">${STAT_KEYS.map((k) => `<div><span>${STAT_NAMES[k]}</span><b>${cls.base[k]}</b><i style="width:${cls.base[k] * 8}%"></i></div>`).join('')}</div>
    <div class="ci-skills">${cls.skills.map((s) => `<span title="${s.desc}">${s.icon} ${s.name}</span>`).join('')}</div>`;
  preview.setClass(id);
}

// ------------------------------------------------ 3D-превью персонажа
const preview = (() => {
  const canvas = $('#preview-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.45, 5.4);
  camera.lookAt(0, 1.05, 0);
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x302018, 1.4));
  const key = new THREE.DirectionalLight(0xffd8a0, 2.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6090ff, 1.6);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.18, 32), new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.6 }));
  base.position.y = -0.09;
  scene.add(base);
  const runeRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd4a83a }));
  runeRing.position.y = 0.011;
  scene.add(runeRing);

  let model = null, running = true, t = 0, atk = 2;
  const clock = new THREE.Clock();
  const gear = {};
  function setClass(id) {
    if (model) scene.remove(model);
    const cls = CLASSES[id];
    gear[id] ??= {
      chest: generateItem('chest', 1, { rarity: 'common', noBonus: true }),
      weapon: generateItem('weapon', 1, { rarity: 'common', weaponType: cls.weapon, noBonus: true }),
    };
    model = createHumanoid(cls.look);
    applyEquipment(model, gear[id]);
    model.rotation.y = 0.5;
    scene.add(model);
    atk = 0.6;
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    if (model) {
      model.rotation.y += dt * 0.5;
      if ((atk -= dt) <= 0) { atk = 3.5; playAttack(model, CLASSES[selectedClass].attackAnim, 0.7); }
      animateModel(model, dt, t);
    }
    runeRing.material.color.setHSL(0.11, 0.65, 0.45 + Math.sin(t * 2) * 0.1);
    renderer.render(scene, camera);
  }
  addEventListener('resize', resize);
  return { setClass, resize, start() { resize(); frame(); }, stop() { running = false; renderer.dispose(); } };
})();

// ------------------------------------------------ формы
const net = new Net();
const LAST = 'eldoria.last';
let busy = false;

function setError(e) {
  $('#auth-error').textContent = e.message || String(e);
}

async function auth(msg) {
  if (busy) return;
  busy = true;
  setError('');
  document.querySelectorAll('form .btn').forEach((b) => (b.disabled = true));
  try {
    $('#auth-error').textContent = 'Подключение к серверу…';
    await net.connect();
    const res = await net.request(msg, ['welcome', 'auth_err']);
    if (res.t === 'auth_err') throw new Error(res.msg);
    try { localStorage.setItem(LAST, msg.name.trim()); } catch {}
    start(res);
  } catch (err) {
    setError(err);
  } finally {
    busy = false;
    document.querySelectorAll('form .btn').forEach((b) => (b.disabled = false));
  }
}

$('#login-form').onsubmit = (e) => {
  e.preventDefault();
  auth({ t: 'login', name: $('#login-user').value, pass: $('#login-pass').value });
};

$('#register-form').onsubmit = (e) => {
  e.preventDefault();
  if ($('#reg-pass').value !== $('#reg-pass2').value) return setError(new Error('Пароли не совпадают'));
  auth({ t: 'register', name: $('#reg-user').value, pass: $('#reg-pass').value, classId: selectedClass });
};

function start(welcome) {
  net.hold(); // сообщения копятся, пока строится мир
  preview.stop();
  $('#auth-screen').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  setTimeout(() => {
    $('#game').classList.remove('hidden');
    window.game = new Game(net, welcome);
    net.release();
    $('#loading').classList.add('hidden');
  }, 50);
}

// ------------------------------------------------ старт
let last = '';
try { last = localStorage.getItem(LAST) || ''; } catch {}
$('#login-user').value = last;
preview.start();
selectClass('warrior');
showTab(last ? 'login' : 'register');
