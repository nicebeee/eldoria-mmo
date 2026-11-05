// Процедурные низкополигональные 3D-модели: гуманоиды, волк, оружие, броня.
// Модель смотрит вдоль +Z, правая рука находится на стороне -X.
import * as THREE from 'three';
import { lerp } from './utils.js';

const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}

export function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, flatShading: true, ...extra });
}

function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

export const box = (w, h, d, m, x = 0, y = 0, z = 0) => mesh(boxGeo(w, h, d), m, x, y, z);

function newAnim() {
  return { phase: 0, move: 0, moving: false, speedMul: 1, attack: -1, attackDur: 0.5, attackType: 'melee', dead: false, deadT: 0 };
}

function clearGroup(g) {
  while (g.children.length) g.remove(g.children[0]);
}

// ---------------------------------------------------------------- гуманоид
export function createHumanoid(o = {}) {
  const c = {
    skin: 0xe8b48a, shirt: 0x6b5a45, pants: 0x3d3a4a, boots: 0x3a2a1c, hair: 0x3b2614, eyes: 0x111111,
    eyeGlow: 0, scale: 1, width: 1, ears: false, bony: false, robe: false, beard: false, tusks: false, ...o,
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const M = {
    skin: mat(c.skin), shirt: mat(c.shirt), pants: mat(c.pants), boots: mat(c.boots), hands: mat(c.skin),
    hair: mat(c.hair ?? 0x000000),
    eyes: mat(c.eyes, c.eyeGlow ? { emissive: c.eyeGlow, emissiveIntensity: 2.5 } : {}),
    belt: mat(0x2b1d10),
  };
  const w = c.width;
  const lw = c.bony ? 0.12 : 0.2;

  const mkLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(0.15 * side * w, 1.0, 0);
    leg.add(box(lw + 0.02, 0.5, lw + 0.04, M.pants, 0, -0.25, 0));
    const shin = new THREE.Group();
    shin.position.y = -0.5;
    leg.add(shin);
    shin.add(box(lw, 0.36, lw + 0.02, M.pants, 0, -0.18, 0));
    shin.add(box(lw + 0.06, 0.16, lw + 0.2, M.boots, 0, -0.42, 0.04));
    body.add(leg);
    return { leg, shin };
  };
  const L = mkLeg(1), R = mkLeg(-1);

  const torso = new THREE.Group();
  torso.position.y = 1.0;
  body.add(torso);
  if (c.bony) {
    torso.add(box(0.1, 0.72, 0.1, M.shirt, 0, 0.38, -0.05));
    for (let i = 0; i < 4; i++) torso.add(box(0.46 * w, 0.06, 0.26, M.shirt, 0, 0.38 + i * 0.13, 0));
    torso.add(box(0.36, 0.16, 0.22, M.shirt, 0, 0.06, 0));
  } else {
    torso.add(box(0.56 * w, 0.74, 0.32 * Math.max(1, w * 0.9), M.shirt, 0, 0.4, 0));
    torso.add(box(0.58 * w, 0.1, 0.34 * Math.max(1, w * 0.9), M.belt, 0, 0.06, 0));
  }
  if (c.robe) {
    const skirt = box(0.6 * w, 0.62, 0.38, M.shirt, 0, -0.26, 0);
    torso.add(skirt);
  }

  const head = new THREE.Group();
  head.position.y = 0.8;
  torso.add(head);
  head.add(box(0.36, 0.38, 0.36, M.skin, 0, 0.19, 0));
  head.add(box(0.06, 0.05, 0.02, M.eyes, 0.08, 0.21, 0.185));
  head.add(box(0.06, 0.05, 0.02, M.eyes, -0.08, 0.21, 0.185));
  let hair = null;
  if (o.hair !== null && !c.bony) {
    hair = new THREE.Group();
    hair.add(box(0.39, 0.1, 0.39, M.hair, 0, 0.4, 0));
    hair.add(box(0.39, 0.26, 0.08, M.hair, 0, 0.26, -0.17));
    head.add(hair);
  }
  if (c.beard) head.add(box(0.3, 0.16, 0.06, M.hair, 0, 0.04, 0.19));
  if (c.ears) {
    const e1 = box(0.22, 0.07, 0.06, M.skin, 0.25, 0.24, 0); e1.rotation.z = 0.35; head.add(e1);
    const e2 = box(0.22, 0.07, 0.06, M.skin, -0.25, 0.24, 0); e2.rotation.z = -0.35; head.add(e2);
  }
  if (c.tusks) {
    const tm = mat(0xf0ead8);
    head.add(box(0.04, 0.1, 0.04, tm, 0.09, 0.04, 0.19));
    head.add(box(0.04, 0.1, 0.04, tm, -0.09, 0.04, 0.19));
  }
  const helmet = new THREE.Group();
  head.add(helmet);

  const mkArm = (side) => {
    const arm = new THREE.Group();
    arm.position.set((0.28 * w + lw / 2 + 0.02) * side, 0.7, 0);
    torso.add(arm);
    arm.add(box(lw, 0.42, lw, M.shirt, 0, -0.2, 0));
    const pad = new THREE.Group();
    pad.position.y = 0.02;
    arm.add(pad);
    const fore = new THREE.Group();
    fore.position.y = -0.42;
    arm.add(fore);
    fore.add(box(lw - 0.02, 0.34, lw - 0.02, c.bony ? M.shirt : M.skin, 0, -0.17, 0));
    const hand = new THREE.Group();
    hand.position.y = -0.38;
    fore.add(hand);
    hand.add(box(lw + 0.02, 0.14, lw + 0.04, M.hands, 0, 0, 0));
    const socket = new THREE.Group();
    hand.add(socket);
    return { arm, fore, hand, pad, socket };
  };
  const AL = mkArm(1), AR = mkArm(-1);

  root.userData = {
    kind: 'humanoid', look: c, M, mats: Object.values(M), anim: newAnim(),
    parts: {
      body, torso, head, hair, helmet,
      legL: L.leg, legR: R.leg, shinL: L.shin, shinR: R.shin,
      armL: AL.arm, armR: AR.arm, foreL: AL.fore, foreR: AR.fore,
      padL: AL.pad, padR: AR.pad, weaponL: AL.socket, weaponR: AR.socket,
      bow: null, staff: null,
    },
  };
  root.scale.setScalar(c.scale);
  return root;
}

// ---------------------------------------------------------------- волк
export function createWolf(color = 0x6f6a64, scale = 1) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const m = mat(color), m2 = mat(new THREE.Color(color).multiplyScalar(0.7).getHex());
  const eye = mat(0xffcc33, { emissive: 0xffaa00, emissiveIntensity: 2 });
  body.add(box(0.5, 0.46, 1.1, m, 0, 0.72, 0));
  body.add(box(0.54, 0.4, 0.4, m2, 0, 0.78, 0.3));
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0.6);
  body.add(head);
  head.add(box(0.36, 0.34, 0.38, m, 0, 0, 0.12));
  head.add(box(0.2, 0.16, 0.28, m2, 0, -0.07, 0.42));
  head.add(box(0.08, 0.15, 0.06, m2, 0.11, 0.23, 0.02));
  head.add(box(0.08, 0.15, 0.06, m2, -0.11, 0.23, 0.02));
  head.add(box(0.05, 0.04, 0.02, eye, 0.1, 0.05, 0.31));
  head.add(box(0.05, 0.04, 0.02, eye, -0.1, 0.05, 0.31));
  const legs = [];
  for (const [x, z] of [[0.17, 0.4], [-0.17, 0.4], [0.17, -0.4], [-0.17, -0.4]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.52, z);
    leg.add(box(0.13, 0.54, 0.14, m2, 0, -0.26, 0));
    body.add(leg);
    legs.push(leg);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.85, -0.55);
  tail.rotation.x = 0.6;
  tail.add(box(0.1, 0.1, 0.5, m2, 0, 0, -0.25));
  body.add(tail);
  root.userData = { kind: 'quad', mats: [m, m2], anim: newAnim(), parts: { body, head, legs, tail, headZ: 0.6 } };
  root.scale.setScalar(scale);
  return root;
}

// ---------------------------------------------------------------- оружие и броня
export function makeWeapon(type, tier = 0, color = 0x999999, glow = null) {
  const g = new THREE.Group();
  const metal = mat(color, { metalness: 0.6, roughness: 0.35 });
  const wood = mat(0x5a3a1e);
  const dark = mat(0x2a1a10);
  if (type === 'sword' || type === 'dagger') {
    const len = type === 'dagger' ? 0.45 : 0.95;
    g.add(box(0.06, 0.06, 0.22, dark, 0, 0, 0));
    g.add(box(0.3, 0.06, 0.06, mat(tier >= 2 ? 0xd4a83a : 0x6a5a4a, { metalness: 0.5 }), 0, 0, 0.13));
    const bladeMat = glow ? mat(color, { emissive: glow, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 }) : metal;
    g.add(box(0.03, 0.1, len, bladeMat, 0, 0, 0.16 + len / 2));
    g.rotation.x = -0.25;
  } else if (type === 'axe') {
    g.add(box(0.06, 0.06, 1.1, wood, 0, 0, 0.35));
    g.add(box(0.04, 0.42, 0.32, metal, 0, 0.14, 0.78));
    g.rotation.x = -0.25;
  } else if (type === 'club') {
    g.add(box(0.1, 0.1, 0.6, wood, 0, 0, 0.2));
    g.add(box(0.26, 0.26, 0.7, wood, 0, 0, 0.8));
    const spike = mat(0x888888, { metalness: 0.6 });
    for (let i = 0; i < 4; i++) g.add(box(0.06, 0.06, 0.06, spike, i % 2 ? 0.15 : -0.15, i < 2 ? 0.15 : -0.15, 0.7 + i * 0.08));
    g.rotation.x = -0.25;
  } else if (type === 'staff') {
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.8, 6), mat(color), 0, 0.3, 0));
    const orbCol = glow ?? 0x66ccff;
    g.add(mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(orbCol, { emissive: orbCol, emissiveIntensity: 1.6 }), 0, 1.3, 0));
    if (tier >= 1) {
      const pm = mat(tier >= 2 ? 0xd4a83a : 0x777777, { metalness: 0.6 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const p = box(0.03, 0.26, 0.03, pm, Math.cos(a) * 0.1, 1.22, Math.sin(a) * 0.1);
        p.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
        g.add(p);
      }
    }
  } else if (type === 'bow') {
    const R = 0.62;
    const geo = new THREE.TorusGeometry(R, 0.03, 5, 14, Math.PI);
    geo.rotateZ(-Math.PI / 2);
    geo.rotateY(-Math.PI / 2);
    geo.scale(1, 1, 0.45);
    const bm = glow ? mat(color, { emissive: glow, emissiveIntensity: 0.5 }) : mat(color);
    g.add(mesh(geo, bm, 0, 0, -0.28));
    g.add(box(0.012, R * 2, 0.012, mat(0xeeeeee), 0, 0, -0.28));
    g.add(box(0.06, 0.16, 0.06, dark, 0, 0, 0));
  }
  return g;
}

function makeHelmet(item) {
  const g = new THREE.Group();
  const metal = item.tier >= 1;
  const m = mat(item.color, { metalness: metal ? 0.55 : 0.05, roughness: metal ? 0.4 : 0.85 });
  if (!metal) {
    g.add(box(0.42, 0.18, 0.42, m, 0, 0.38, -0.01));
    g.add(box(0.42, 0.32, 0.1, m, 0, 0.22, -0.19));
    g.add(box(0.08, 0.3, 0.36, m, 0.2, 0.24, -0.02));
    g.add(box(0.08, 0.3, 0.36, m, -0.2, 0.24, -0.02));
  } else {
    g.add(box(0.43, 0.22, 0.43, m, 0, 0.37, 0));
    g.add(box(0.46, 0.05, 0.46, m, 0, 0.27, 0));
    g.add(box(0.05, 0.14, 0.05, m, 0, 0.19, 0.21));
    g.add(box(0.05, 0.2, 0.22, m, 0.21, 0.17, 0.06));
    g.add(box(0.05, 0.2, 0.22, m, -0.21, 0.17, 0.06));
    if (item.tier >= 2) g.add(box(0.05, 0.16, 0.34, mat(0xb03030), 0, 0.55, -0.02));
    if (item.tier >= 3) {
      const hm = mat(0xd4a83a, { metalness: 0.7, roughness: 0.3 });
      const h1 = box(0.06, 0.24, 0.06, hm, 0.24, 0.5, 0); h1.rotation.z = -0.5; g.add(h1);
      const h2 = box(0.06, 0.24, 0.06, hm, -0.24, 0.5, 0); h2.rotation.z = 0.5; g.add(h2);
    }
  }
  return g;
}

const RARITY_GLOW = { rare: 0x3d8bff, epic: 0xb45cff };

// eq: { head, chest, hands, feet, weapon } — объекты предметов или null
export function applyEquipment(model, eq = {}) {
  const { parts, M, look } = model.userData;
  M.shirt.color.setHex(eq.chest ? eq.chest.color : look.shirt);
  M.shirt.metalness = eq.chest && eq.chest.tier >= 1 ? 0.45 : 0.05;
  M.shirt.roughness = eq.chest && eq.chest.tier >= 1 ? 0.45 : 0.8;
  M.hands.color.setHex(eq.hands ? eq.hands.color : look.skin);
  M.boots.color.setHex(eq.feet ? eq.feet.color : look.boots);

  clearGroup(parts.helmet);
  if (parts.hair) parts.hair.visible = !eq.head;
  if (eq.head) parts.helmet.add(makeHelmet(eq.head));

  clearGroup(parts.padL);
  clearGroup(parts.padR);
  if (eq.chest && eq.chest.tier >= 1) {
    const pm = mat(eq.chest.color, { metalness: 0.55, roughness: 0.4 });
    parts.padL.add(box(0.3, 0.14, 0.32, pm));
    parts.padR.add(box(0.3, 0.14, 0.32, pm));
  }

  clearGroup(parts.weaponL);
  clearGroup(parts.weaponR);
  parts.bow = null;
  parts.staff = null;
  const w = eq.weapon;
  if (w) {
    const glow = RARITY_GLOW[w.rarity] ?? null;
    const wm = makeWeapon(w.weaponType, w.tier, w.color, glow);
    if (w.weaponType === 'bow') { parts.weaponL.add(wm); parts.bow = wm; }
    else { parts.weaponR.add(wm); if (w.weaponType === 'staff') parts.staff = wm; }
  }
}

// ---------------------------------------------------------------- анимация
export function playAttack(model, type = 'melee', dur = 0.5) {
  const a = model.userData.anim;
  a.attack = 0;
  a.attackType = type;
  a.attackDur = dur;
}

export function setDead(model, dead) {
  const a = model.userData.anim;
  a.dead = dead;
  a.deadT = 0;
  a.attack = -1;
  if (!dead) {
    const b = model.userData.parts.body;
    b.rotation.set(0, 0, 0);
    b.position.set(0, 0, 0);
  }
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

export function animateModel(model, dt, time) {
  const a = model.userData.anim;
  const p = model.userData.parts;
  a.move += ((a.moving ? 1 : 0) - a.move) * Math.min(1, dt * 10);
  if (a.moving) a.phase += dt * 9 * a.speedMul;
  if (a.attack >= 0) {
    a.attack += dt / a.attackDur;
    if (a.attack >= 1) a.attack = -1;
  }
  if (model.userData.kind === 'quad') return animQuad(a, p, dt, time);

  if (a.dead) {
    a.deadT += dt;
    const k = easeOut(Math.min(1, a.deadT * 2.2));
    p.body.rotation.x = -k * Math.PI * 0.49;
    p.body.position.y = k * 0.2;
    return;
  }

  const sw = Math.sin(a.phase) * a.move;
  const breathe = Math.sin(time * 2 + model.id) * 0.03;
  p.legL.rotation.x = -sw * 0.75;
  p.legR.rotation.x = sw * 0.75;
  p.shinL.rotation.x = Math.max(0, -Math.cos(a.phase)) * 0.9 * a.move;
  p.shinR.rotation.x = Math.max(0, Math.cos(a.phase)) * 0.9 * a.move;
  p.armL.rotation.set(sw * 0.6, 0, 0.1 + breathe);
  p.armR.rotation.set(-sw * 0.6, 0, -0.1 - breathe);
  p.foreL.rotation.set(-0.15 - a.move * 0.3, 0, 0);
  p.foreR.rotation.set(-0.15 - a.move * 0.3, 0, 0);
  p.torso.rotation.set(0, 0, 0);
  p.torso.position.y = 1.0 + breathe * 0.4;
  p.body.position.y = Math.abs(Math.sin(a.phase)) * 0.07 * a.move;

  if (a.attack >= 0) {
    const t = a.attack;
    switch (a.attackType) {
      case 'melee': {
        p.armR.rotation.x = t < 0.35 ? lerp(-sw * 0.6, -2.7, easeOut(t / 0.35)) : lerp(-2.7, 0.35, easeOut((t - 0.35) / 0.65));
        p.armR.rotation.z = -0.25;
        p.foreR.rotation.x = -0.3;
        p.torso.rotation.y = -Math.sin(t * Math.PI) * 0.35;
        break;
      }
      case 'slam': {
        const x = t < 0.45 ? lerp(0, -2.9, easeOut(t / 0.45)) : lerp(-2.9, -0.4, easeOut((t - 0.45) / 0.55));
        p.armR.rotation.x = x; p.armL.rotation.x = x;
        p.torso.rotation.x = t < 0.45 ? -0.2 : 0.3;
        break;
      }
      case 'spin': {
        p.torso.rotation.y = easeOut(t) * Math.PI * 2;
        p.armR.rotation.set(-1.3, 0, -0.9);
        p.armL.rotation.set(0, 0, 1.2);
        break;
      }
      case 'bow': {
        const pull = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
        p.armL.rotation.set(-1.55, 0, 0);
        p.foreL.rotation.set(0, 0, 0);
        p.armR.rotation.set(-1.5, 0, 0);
        p.foreR.rotation.set(0, 0, 2.5 * pull);
        break;
      }
      case 'cast': {
        const r = Math.sin(t * Math.PI);
        p.armR.rotation.x = -1.6 * r - 0.1;
        p.armL.rotation.x = -1.3 * r;
        p.armL.rotation.z = 0.1 + 0.35 * r;
        break;
      }
    }
  }
  // лук и посох держим вертикально, как бы ни была поднята рука
  if (p.bow) p.bow.rotation.x = -(p.armL.rotation.x + p.foreL.rotation.x);
  if (p.staff) p.staff.rotation.x = -(p.armR.rotation.x + p.foreR.rotation.x) * 0.7;
}

function animQuad(a, p, dt, time) {
  if (a.dead) {
    a.deadT += dt;
    const k = easeOut(Math.min(1, a.deadT * 2.5));
    p.body.rotation.z = k * Math.PI / 2;
    p.body.position.y = k * 0.25;
    return;
  }
  const sw = Math.sin(a.phase * 1.2) * a.move;
  p.legs[0].rotation.x = sw * 0.7;
  p.legs[3].rotation.x = sw * 0.7;
  p.legs[1].rotation.x = -sw * 0.7;
  p.legs[2].rotation.x = -sw * 0.7;
  p.body.position.y = Math.abs(Math.sin(a.phase * 1.2)) * 0.06 * a.move;
  p.body.rotation.x = 0;
  p.tail.rotation.y = Math.sin(time * 6) * 0.4;
  p.head.position.z = p.headZ;
  p.head.rotation.x = 0;
  if (a.attack >= 0) {
    const l = Math.sin(a.attack * Math.PI);
    p.head.position.z = p.headZ + l * 0.3;
    p.head.rotation.x = l * 0.4;
    p.body.rotation.x = -l * 0.12;
  }
}

// ---------------------------------------------------------------- таблички над головой
export function createNameplate(text, color = '#ffffff', withBar = true) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.renderOrder = 10;
  let last = -1;
  function draw(frac = 1, force = false) {
    if (!force && Math.abs(frac - last) < 0.002) return;
    last = frac;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 23px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(text, 128, 26);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 26);
    if (withBar) {
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.fillRect(38, 37, 180, 15);
      ctx.fillStyle = frac > 0.5 ? '#d23a2a' : frac > 0.25 ? '#e8762a' : '#f0c040';
      ctx.fillRect(40, 39, 176 * Math.max(0, frac), 11);
    }
    tex.needsUpdate = true;
  }
  draw(1, true);
  return {
    sprite, draw,
    setText(t, col) { text = t; if (col) color = col; draw(last, true); },
  };
}

export function createMarker() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.9, 0.9, 1);
  sprite.renderOrder = 11;
  let cur = null;
  return {
    sprite,
    set(sym, color = '#ffd030') {
      if (sym === cur) return;
      cur = sym;
      ctx.clearRect(0, 0, 64, 64);
      sprite.visible = !!sym;
      if (!sym) return;
      ctx.font = 'bold 56px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2a1800';
      ctx.strokeText(sym, 32, 34);
      ctx.fillStyle = color;
      ctx.fillText(sym, 32, 34);
      tex.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- модели монстров
export function createMobModel(def) {
  let m;
  switch (def.model) {
    case 'wolf':
      m = createWolf(0x6f6a64, 1);
      break;
    case 'goblin':
      m = createHumanoid({ skin: 0x6fa83a, shirt: 0x6b4a2a, pants: 0x4a3a22, boots: 0x2a1f14, hair: null, ears: true, scale: 0.78, eyes: 0xffee00, eyeGlow: 0xaa8800 });
      applyEquipment(m, { weapon: { weaponType: 'dagger', tier: 0, color: 0x8a8a8a } });
      break;
    case 'skeleton':
      m = createHumanoid({ skin: 0xe8e4d4, shirt: 0xd8d4c4, pants: 0x4a3a2a, boots: 0xd8d4c4, hair: null, bony: true, eyes: 0xff3020, eyeGlow: 0xff2000 });
      applyEquipment(m, { weapon: { weaponType: 'sword', tier: 0, color: 0x7a6a5a } });
      break;
    case 'orc':
      m = createHumanoid({ skin: 0x5a7a3a, shirt: 0x5a3a2a, pants: 0x3a2a1a, boots: 0x2a1a10, hair: 0x111111, width: 1.3, scale: 1.25, tusks: true, eyes: 0xff4400, eyeGlow: 0x991100 });
      applyEquipment(m, { weapon: { weaponType: 'axe', tier: 1, color: 0x8a8f96 } });
      break;
    case 'ogre':
      m = createHumanoid({ skin: 0x8a6a4a, shirt: 0x4a2a1a, pants: 0x3a2414, boots: 0x2a1a10, hair: null, width: 1.55, scale: 2.2, tusks: true, eyes: 0xff2200, eyeGlow: 0xff1100 });
      applyEquipment(m, { head: { tier: 3, color: 0x3a3a3a }, weapon: { weaponType: 'club', tier: 0, color: 0x777777 } });
      break;
  }
  return m;
}
