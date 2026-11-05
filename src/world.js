import * as THREE from 'three';
import { SPAWN_ZONES } from './data.js';
import { mat, box } from './models.js';
import { clamp, smoothstep, mulberry32 } from './utils.js';

import { heightAt, WORLD_HALF, VILLAGE_RADIUS, ARENA, ARENA_RADIUS } from './terrain.js';
export { heightAt, zoneNameAt, WORLD_HALF, VILLAGE_RADIUS } from './terrain.js';

const GRAVE = [25, -88], ORC = [-85, -68], GOBLIN = [-62, 55], WOLF = [55, 45], BOSS = [-112, -112];

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
const PATHS = [...SPAWN_ZONES.map((z) => [0, 0, z.center[0], z.center[1]]), [0, 0, ARENA[0], ARENA[1]]];
function pathDist(x, z) {
  let m = Infinity;
  for (const p of PATHS) m = Math.min(m, segDist(x, z, ...p));
  return m;
}
const near = (x, z, c, r) => Math.hypot(x - c[0], z - c[1]) < r;

function addShadows(o) {
  o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

export function createWorld(scene) {
  const rnd = mulberry32(1337);
  const colliders = [];
  const updaters = [];

  // ------------------------------------------------ небо
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x3d78c8) }, bottom: { value: new THREE.Color(0xc8e0f0) } },
      vertexShader: 'varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vH; void main(){ gl_FragColor = vec4(mix(bottom, top, pow(max(vH,0.0),0.55)),1.0); }',
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ------------------------------------------------ земля
  const size = WORLD_HALF * 2 + 60, seg = 200;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const C = {
    grassA: new THREE.Color(0x5a8c38), grassB: new THREE.Color(0x7eab48), dirt: new THREE.Color(0x9a7a50),
    rock: new THREE.Color(0x7d7a72), grave: new THREE.Color(0x4a5444), ash: new THREE.Color(0x6b5a45), forest: new THREE.Color(0x3f6e2c), sand: new THREE.Color(0xc8a868),
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const n = (Math.sin(x * 0.3) * Math.cos(z * 0.27) + Math.sin(x * 0.11 + z * 0.13)) * 0.25 + 0.5;
    col.copy(C.grassA).lerp(C.grassB, n);
    const dw = Math.hypot(x - WOLF[0], z - WOLF[1]);
    if (dw < 36) col.lerp(C.forest, smoothstep(36, 20, dw) * 0.7);
    const dg = Math.hypot(x - GRAVE[0], z - GRAVE[1]);
    if (dg < 30) col.lerp(C.grave, smoothstep(30, 16, dg));
    const doc = Math.hypot(x - ORC[0], z - ORC[1]);
    if (doc < 26) col.lerp(C.ash, smoothstep(26, 12, doc));
    const db = Math.hypot(x - BOSS[0], z - BOSS[1]);
    if (db < 22) col.lerp(C.ash, smoothstep(22, 10, db) * 0.8);
    const da = Math.hypot(x - ARENA[0], z - ARENA[1]);
    if (da < ARENA_RADIUS + 3) col.lerp(C.sand, smoothstep(ARENA_RADIUS + 3, ARENA_RADIUS - 1, da));
    const dv = Math.hypot(x, z);
    if (dv < 20) col.lerp(C.dirt, smoothstep(20, 6, dv) * 0.8);
    const pd = pathDist(x, z);
    if (pd < 2.8 && dv > 4) col.lerp(C.dirt, smoothstep(2.8, 1.2, pd) * 0.85);
    col.lerp(C.rock, smoothstep(126, 142, Math.max(Math.abs(x), Math.abs(z))));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  ground.receiveShadow = true;
  scene.add(ground);

  // ------------------------------------------------ деревья
  const MAXT = 900;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6); trunkGeo.translate(0, 1.2, 0);
  const pineGeo = new THREE.ConeGeometry(1.5, 3.8, 7); pineGeo.translate(0, 3.9, 0);
  const pine2Geo = new THREE.ConeGeometry(1.1, 2.6, 7); pine2Geo.translate(0, 5.4, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1.7, 0); leafGeo.translate(0, 3.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4a2b), MAXT);
  const pines = new THREE.InstancedMesh(pineGeo, mat(0xffffff), MAXT);
  const pines2 = new THREE.InstancedMesh(pine2Geo, mat(0xffffff), MAXT);
  const leafs = new THREE.InstancedMesh(leafGeo, mat(0xffffff), MAXT);
  let nt = 0, np = 0, nl = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 6000 && nt < MAXT; i++) {
    const x = (rnd() * 2 - 1) * (WORLD_HALF - 4), z = (rnd() * 2 - 1) * (WORLD_HALF - 4);
    if (Math.hypot(x, z) < 34 || pathDist(x, z) < 4.5) continue;
    let dens = 0.16;
    if (near(x, z, WOLF, 34)) dens = 0.55;
    if (near(x, z, GOBLIN, 14) || near(x, z, ORC, 22) || near(x, z, BOSS, 20) || near(x, z, ARENA, ARENA_RADIUS + 10)) dens = 0;
    const inGrave = near(x, z, GRAVE, 24);
    if (inGrave) dens = 0.05;
    if (Math.max(Math.abs(x), Math.abs(z)) > 128) dens = 0.45;
    if (rnd() > dens) continue;
    const sc = 0.8 + rnd() * 0.7;
    m4.compose(p.set(x, heightAt(x, z) - 0.1, z), q.setFromAxisAngle(up, rnd() * 6.28), s.setScalar(sc));
    trunks.setMatrixAt(nt++, m4);
    colliders.push({ x, z, r: 0.45 * sc });
    if (inGrave) continue; // мёртвые деревья без кроны
    if (rnd() < 0.55) {
      col.setHSL(0.3 + rnd() * 0.05, 0.45, 0.2 + rnd() * 0.08);
      pines.setMatrixAt(np, m4); pines.setColorAt(np, col);
      pines2.setMatrixAt(np, m4); pines2.setColorAt(np, col);
      np++;
    } else {
      col.setHSL(0.22 + rnd() * 0.08, 0.5, 0.28 + rnd() * 0.1);
      leafs.setMatrixAt(nl, m4); leafs.setColorAt(nl, col);
      nl++;
    }
  }
  trunks.count = nt; pines.count = np; pines2.count = np; leafs.count = nl;
  for (const im of [trunks, pines, pines2, leafs]) {
    im.castShadow = true;
    im.frustumCulled = false;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
  }

  // ------------------------------------------------ камни
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0x8a8780), 220);
  let nr = 0;
  for (let i = 0; i < 2000 && nr < 220; i++) {
    const x = (rnd() * 2 - 1) * (WORLD_HALF - 2), z = (rnd() * 2 - 1) * (WORLD_HALF - 2);
    if (Math.hypot(x, z) < 30 || pathDist(x, z) < 3.5 || near(x, z, ARENA, ARENA_RADIUS + 6)) continue;
    if (rnd() > 0.3) continue;
    const big = Math.max(Math.abs(x), Math.abs(z)) > 125;
    const sc = big ? 2 + rnd() * 4 : 0.3 + rnd() * 1.1;
    m4.compose(p.set(x, heightAt(x, z) + sc * 0.2, z), q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), s.set(sc, sc * (0.6 + rnd() * 0.5), sc));
    rocks.setMatrixAt(nr, m4);
    col.setHSL(0.08, 0.05, 0.42 + rnd() * 0.15);
    rocks.setColorAt(nr++, col);
    if (sc > 0.9) colliders.push({ x, z, r: sc * 0.9 });
  }
  rocks.count = nr;
  rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  scene.add(rocks);

  // ------------------------------------------------ постройки
  const place = (obj, x, z, rot = 0, collR = 0) => {
    obj.position.set(x, heightAt(x, z), z);
    obj.rotation.y = rot;
    addShadows(obj);
    scene.add(obj);
    if (collR) colliders.push({ x, z, r: collR });
    return obj;
  };

  function house(x, z, wallC = 0xd8c8a0, roofC = 0x8a3a2a) {
    const g = new THREE.Group();
    const beam = mat(0x4a3020);
    g.add(box(6, 3.2, 5, mat(wallC), 0, 1.6, 0));
    g.add(box(6.15, 0.25, 5.15, beam, 0, 0.12, 0));
    g.add(box(6.15, 0.25, 5.15, beam, 0, 3.2, 0));
    for (const [cx, cz] of [[3, 2.5], [-3, 2.5], [3, -2.5], [-3, -2.5]]) g.add(box(0.3, 3.3, 0.3, beam, cx, 1.65, cz));
    const rg = new THREE.ConeGeometry(4.9, 2.6, 4);
    rg.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(rg, mat(roofC));
    roof.position.y = 4.5;
    roof.scale.set(1, 1, 0.86);
    g.add(roof);
    g.add(box(1.1, 2, 0.12, beam, 0, 1, 2.52));
    const win = mat(0xffd27a, { emissive: 0xffa030, emissiveIntensity: 0.6 });
    g.add(box(0.9, 0.8, 0.1, win, 1.8, 1.9, 2.52));
    g.add(box(0.9, 0.8, 0.1, win, -1.8, 1.9, 2.52));
    g.add(box(0.6, 1.6, 0.6, mat(0x7a7570), 1.6, 5, -1));
    place(g, x, z, Math.atan2(-x, -z), 3.6);
  }

  // деревня
  [[-17, -12, 0xd8c8a0, 0x8a3a2a], [16, -14, 0xe0d0b0, 0x3a5a8a], [-19, 13, 0xcab890, 0x6a4a2a], [18, 14, 0xd8c8a0, 0x8a3a2a], [0, -21, 0xe8dcc0, 0x5a3a6a], [-6, -19, 0xd0c0a0, 0x6a4a2a]]
    .forEach(([x, z, w, r]) => house(x, z, w, r));

  // костёр в центре
  const fire = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const l = box(0.25, 0.25, 1.6, mat(0x4a3020), 0, 0.15, 0);
    l.rotation.y = (i / 4) * Math.PI;
    fire.add(l);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    fire.add(box(0.4, 0.3, 0.4, mat(0x777777), Math.cos(a) * 1.1, 0.15, Math.sin(a) * 1.1));
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 6), flameMat);
  flame.position.y = 0.85;
  fire.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xfff080 }));
  flame2.position.y = 0.7;
  fire.add(flame2);
  place(fire, 0, 0, 0, 1.4);
  flame.castShadow = flame2.castShadow = false;
  const fireLight = new THREE.PointLight(0xff8a3a, 30, 22, 1.6);
  fireLight.position.set(0, 2, 0);
  scene.add(fireLight);
  updaters.push((dt, t) => {
    const f = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
    fireLight.intensity = 30 * f;
    flame.scale.set(1, f * 1.1, 1);
    flame2.scale.set(1, 1.2 - f * 0.3, 1);
    flame.rotation.y = t * 2;
  });

  // колодец
  const well = new THREE.Group();
  const stone = mat(0x8a8780);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = box(0.6, 0.9, 0.35, stone, Math.cos(a) * 1.05, 0.45, Math.sin(a) * 1.05);
    b.rotation.y = -a;
    well.add(b);
  }
  well.add(box(0.15, 2.2, 0.15, mat(0x4a3020), 1.05, 1.1, 0));
  well.add(box(0.15, 2.2, 0.15, mat(0x4a3020), -1.05, 1.1, 0));
  const wr = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 4), mat(0x8a3a2a));
  wr.position.y = 2.6; wr.rotation.y = Math.PI / 4;
  well.add(wr);
  place(well, 7, -6, 0.3, 1.4);

  // прилавок торговца
  const stall = new THREE.Group();
  stall.add(box(3.4, 1, 1.2, mat(0x7a5230), 0, 0.5, 0));
  for (const sx of [-1.6, 1.6]) for (const sz of [-0.5, 0.5]) stall.add(box(0.12, 2.6, 0.12, mat(0x4a3020), sx, 1.3, sz));
  stall.add(box(3.8, 0.1, 1.8, mat(0xc04040), 0, 2.6, 0));
  stall.add(box(0.5, 0.4, 0.5, mat(0xb08a3a), -0.9, 1.2, 0));
  stall.add(box(0.4, 0.5, 0.4, mat(0x3a6ac0), 0.4, 1.25, 0));
  place(stall, -4, 13.2, 0, 1.6);

  // фонари
  const lampMat = mat(0xffe0a0, { emissive: 0xffc060, emissiveIntensity: 1.5 });
  for (const [x, z] of [[12, -3], [-12, -4], [4, 16], [-13, 8], [10, 9]]) {
    const l = new THREE.Group();
    l.add(box(0.15, 3, 0.15, mat(0x3a2a1a), 0, 1.5, 0));
    l.add(box(0.4, 0.45, 0.4, lampMat, 0, 3.15, 0));
    place(l, x, z, 0, 0.4);
  }

  // частокол вокруг деревни с проходами к тропам
  const palis = mat(0x6a4a2a);
  const gapAngles = [...SPAWN_ZONES.map((z) => Math.atan2(z.center[1], z.center[0])), Math.atan2(ARENA[1], ARENA[0])];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    if (gapAngles.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13)) continue;
    const x = Math.cos(a) * 27, z = Math.sin(a) * 27;
    const post = new THREE.Group();
    post.add(box(0.4, 2.4, 0.4, palis, 0, 1.2, 0));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), palis);
    tip.position.y = 2.65;
    post.add(tip);
    place(post, x, z, a, 0.5);
  }

  // кладбище
  const tombM = mat(0x8a8a90);
  for (let i = 0; i < 34; i++) {
    const x = GRAVE[0] + (rnd() * 2 - 1) * 15, z = GRAVE[1] + (rnd() * 2 - 1) * 13;
    const t = new THREE.Group();
    if (rnd() < 0.5) t.add(box(0.8, 1.1, 0.25, tombM, 0, 0.55, 0));
    else { t.add(box(0.2, 1.4, 0.2, tombM, 0, 0.7, 0)); t.add(box(0.8, 0.2, 0.2, tombM, 0, 1.0, 0)); }
    t.rotation.z = (rnd() - 0.5) * 0.25;
    place(t, x, z, (rnd() - 0.5) * 0.6, 0);
  }
  const crypt = new THREE.Group();
  crypt.add(box(7, 4, 6, mat(0x5a5a60), 0, 2, 0));
  const croof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.4, 4), mat(0x3a3a44));
  croof.rotation.y = Math.PI / 4; croof.position.y = 5.2; croof.scale.set(1, 1, 0.85);
  crypt.add(croof);
  crypt.add(box(1.6, 2.6, 0.2, mat(0x111111), 0, 1.3, 3.02));
  place(crypt, GRAVE[0], GRAVE[1] - 16, 0, 4.4);
  const ghost = new THREE.PointLight(0x60ff90, 12, 26, 1.5);
  ghost.position.set(GRAVE[0], 4, GRAVE[1]);
  scene.add(ghost);

  // гоблинские хижины
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const x = GOBLIN[0] + Math.cos(a) * 10, z = GOBLIN[1] + Math.sin(a) * 10;
    const hut = new THREE.Group();
    hut.add(mesh2(new THREE.CylinderGeometry(1.6, 1.8, 1.8, 8), mat(0x7a6040), 0, 0.9, 0));
    hut.add(mesh2(new THREE.ConeGeometry(2.2, 1.8, 8), mat(0x8a7a3a), 0, 2.7, 0));
    place(hut, x, z, a, 2);
  }
  const totem = new THREE.Group();
  totem.add(box(0.6, 4, 0.6, mat(0x6a4a2a), 0, 2, 0));
  totem.add(box(0.9, 0.9, 0.9, mat(0xd8d0b0), 0, 4.3, 0));
  place(totem, GOBLIN[0], GOBLIN[1], 0, 0.6);

  // лагерь орков
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = ORC[0] + Math.cos(a) * 11, z = ORC[1] + Math.sin(a) * 11;
    const tent = new THREE.Group();
    tent.add(mesh2(new THREE.ConeGeometry(2.4, 3.6, 6), mat(0x6a4a30), 0, 1.8, 0));
    tent.add(box(0.12, 4.4, 0.12, mat(0x3a2a1a), 0, 2.2, 0));
    place(tent, x, z, a, 2.4);
  }
  const spike = mat(0x5a3a1a);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const toVillage = Math.atan2(-ORC[1], -ORC[0]);
    if (Math.abs(Math.atan2(Math.sin(a - toVillage), Math.cos(a - toVillage))) < 0.3) continue;
    const x = ORC[0] + Math.cos(a) * 19, z = ORC[1] + Math.sin(a) * 19;
    const sp = new THREE.Group();
    const st = mesh2(new THREE.CylinderGeometry(0.2, 0.25, 3, 5), spike, 0, 1.5, 0);
    sp.add(st);
    sp.add(mesh2(new THREE.ConeGeometry(0.22, 0.7, 5), spike, 0, 3.3, 0));
    sp.rotation.z = 0.15;
    place(sp, x, z, a, 0.5);
  }
  const orcFire = new THREE.PointLight(0xff6020, 20, 24, 1.6);
  orcFire.position.set(ORC[0], 2, ORC[1]);
  scene.add(orcFire);
  const of = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.8, 6), new THREE.MeshBasicMaterial({ color: 0xff7030 }));
  of.position.set(ORC[0], heightAt(ORC[0], ORC[1]) + 0.9, ORC[1]);
  scene.add(of);
  colliders.push({ x: ORC[0], z: ORC[1], r: 1.2 });
  updaters.push((dt, t) => { of.scale.y = 0.9 + Math.sin(t * 11) * 0.15; orcFire.intensity = 20 + Math.sin(t * 9) * 4; });

  // кольцо камней у логова босса
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const st = box(1.4, 5, 0.9, mat(0x6a6a70), 0, 2.5, 0);
    const g = new THREE.Group();
    g.add(st);
    if (i % 2 === 0) g.add(box(1.6, 0.6, 1, mat(0x6a6a70), 0, 5.3, 0));
    place(g, BOSS[0] + Math.cos(a) * 15, BOSS[1] + Math.sin(a) * 15, -a, 1);
  }
  const bossLight = new THREE.PointLight(0xff3010, 15, 30, 1.4);
  bossLight.position.set(BOSS[0], 4, BOSS[1]);
  scene.add(bossLight);

  // ------------------------------------------------ арена (PvP)
  {
    const [ax, az] = ARENA;
    const stoneM = mat(0x9a8f80), clothM = mat(0xa02020), gold = mat(0xd4a83a, { metalness: 0.6, roughness: 0.35 });
    const toVillage = Math.atan2(-az, -ax);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - toVillage), Math.cos(a - toVillage))) < 0.2) continue;
      const g = new THREE.Group();
      g.add(box(1, i % 2 ? 2.2 : 3.4, 1, stoneM, 0, i % 2 ? 1.1 : 1.7, 0));
      if (i % 2 === 0) g.add(box(1.3, 0.3, 1.3, stoneM, 0, 3.5, 0));
      place(g, ax + Math.cos(a) * (ARENA_RADIUS + 1), az + Math.sin(a) * (ARENA_RADIUS + 1), -a, 0.8);
    }
    // флаги и жаровни у входа и по кругу
    for (let i = 0; i < 4; i++) {
      const a = toVillage + (i < 2 ? (i ? 0.32 : -0.32) : Math.PI + (i === 2 ? 0.6 : -0.6));
      const g = new THREE.Group();
      g.add(box(0.2, 6, 0.2, mat(0x3a2a1a), 0, 3, 0));
      g.add(box(0.06, 2.2, 1.3, clothM, 0, 4.6, 0.7));
      g.add(box(0.5, 0.5, 0.5, gold, 0, 6.1, 0));
      place(g, ax + Math.cos(a) * (ARENA_RADIUS + 3), az + Math.sin(a) * (ARENA_RADIUS + 3), -a, 0.4);
    }
    const fireM = new THREE.MeshBasicMaterial({ color: 0xff8030 });
    const flames = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const g = new THREE.Group();
      g.add(box(0.9, 1.2, 0.9, mat(0x3a3a40), 0, 0.6, 0));
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 6), fireM);
      f.position.y = 1.6;
      g.add(f);
      flames.push(f);
      place(g, ax + Math.cos(a) * (ARENA_RADIUS - 2), az + Math.sin(a) * (ARENA_RADIUS - 2), 0, 0.7);
      f.castShadow = false;
    }
    const emblem = new THREE.Mesh(new THREE.RingGeometry(3, 3.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a2020 }));
    emblem.position.set(ax, heightAt(ax, az) + 0.05, az);
    scene.add(emblem);
    const cross = new THREE.Group();
    for (const r of [0.6, -0.6]) {
      const b = box(0.2, 0.08, 5, mat(0x8a2020), 0, 0.06, 0);
      b.rotation.y = r;
      cross.add(b);
    }
    place(cross, ax, az, 0, 0);
    updaters.push((dt, t) => flames.forEach((f, i) => (f.scale.y = 0.9 + Math.sin(t * 10 + i) * 0.2)));
  }

  // ------------------------------------------------ лунник (травы для задания)
  const herbs = [];
  const stemM = mat(0x3a8a3a);
  const flowerM = mat(0xc070ff, { emissive: 0x9040ff, emissiveIntensity: 1.2 });
  const herbGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb060ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 400 && herbs.length < 16; i++) {
    const a = rnd() * Math.PI * 2, r = 32 + rnd() * 45;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pathDist(x, z) < 4 || near(x, z, WOLF, 24) || near(x, z, GOBLIN, 22)) continue;
    if (herbs.some((h) => Math.hypot(h.x - x, h.z - z) < 12)) continue;
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const leaf = box(0.08, 0.5, 0.2, stemM, Math.cos(k * 1.6) * 0.15, 0.25, Math.sin(k * 1.6) * 0.15);
      leaf.rotation.z = Math.cos(k * 1.6) * 0.5;
      g.add(leaf);
    }
    const fl = mesh2(new THREE.IcosahedronGeometry(0.17, 0), flowerM, 0, 0.62, 0);
    g.add(fl);
    const glow = new THREE.Sprite(herbGlowMat);
    glow.scale.setScalar(1.6);
    glow.position.y = 0.62;
    g.add(glow);
    g.position.set(x, heightAt(x, z), z);
    scene.add(g);
    herbs.push({ group: g, flower: fl, x, z, active: true, timer: 0 });
  }
  updaters.push((dt, t) => {
    for (const h of herbs) {
      if (!h.active) {
        h.timer -= dt;
        if (h.timer <= 0) { h.active = true; h.group.visible = true; }
        continue;
      }
      h.flower.position.y = 0.62 + Math.sin(t * 2 + h.x) * 0.06;
      h.flower.rotation.y = t;
    }
  });

  return {
    sky, colliders, herbs,
    update(dt, t) { for (const u of updaters) u(dt, t); },
  };
}

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function mesh2(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}
