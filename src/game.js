import * as THREE from 'three';
import { NPCS, SPAWN_ZONES, QUESTS, MOBS, generateItem, randomDrop, makePotion, RARITIES } from './data.js';
import { createWorld, heightAt, zoneNameAt } from './world.js';
import { Effects } from './effects.js';
import { Player } from './player.js';
import { Enemy, Npc } from './enemies.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { saveAccount } from './auth.js';
import { clamp, randInt, distXZ } from './utils.js';

export class Game {
  constructor(account) {
    this.account = account;
    this.canvas = document.getElementById('game-canvas');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0xbcd6e8, 70, 240);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 900);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a5a30, 1.1));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    this.time = 0;
    this.timers = [];
    this.world = createWorld(scene);
    this.fx = new Effects(this);
    this.player = new Player(this, account.save);
    this.camTarget = new THREE.Vector3();
    this.npcs = NPCS.map((d) => new Npc(this, d));
    this.enemies = [];
    for (const z of SPAWN_ZONES) for (let i = 0; i < z.count; i++) this.enemies.push(new Enemy(this, z));
    this.cam = { yaw: 0, pitch: 0.38, dist: 10 };
    this.camTarget.copy(this.player.pos);
    this.raycaster = new THREE.Raycaster();
    this.input = new Input(this);
    this.ui = new UI(this);
    this.zone = '';
    this.nearNpc = null;
    this.nearHerb = null;
    this.saveTimer = 0;
    this.updateNpcMarkers();

    this.ui.log(`Добро пожаловать в Эльдорию, ${this.player.name}!`, 'good');
    this.ui.log('WASD — движение, мышь (зажать) — камера, ЛКМ по врагу — атака, 1-3 — умения, 4-5 — зелья, E — говорить, I/C/L — окна. /help — все клавиши.', 'sys');

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    addEventListener('beforeunload', () => this.save());

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  schedule(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  update(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if ((t.t -= dt) <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    this.player.update(dt);
    for (const e of this.enemies) e.update(dt);
    for (const n of this.npcs) n.update(dt);
    this.world.update(dt, this.time);
    this.updateCamera(dt);
    this.fx.update(dt);

    const p = this.player.pos;
    this.sun.position.set(p.x + 40, p.y + 70, p.z + 25);
    this.sun.target.position.copy(p);
    this.world.sky.position.copy(this.camera.position);

    const zn = zoneNameAt(p.x, p.z);
    if (zn !== this.zone) {
      if (this.zone) this.ui.banner(zn, '', 'zone');
      this.zone = zn;
    }
    this.findInteractables();
    this.ui.update(dt);

    if ((this.saveTimer += dt) > 15) { this.saveTimer = 0; this.save(); }
  }

  updateCamera(dt) {
    const c = this.cam, p = this.player.pos;
    this.camTarget.lerp(new THREE.Vector3(p.x, p.y + 1.7, p.z), 1 - Math.exp(-18 * dt));
    const t = this.camTarget;
    const cp = Math.cos(c.pitch);
    const pos = this.camera.position;
    pos.set(t.x + Math.sin(c.yaw) * cp * c.dist, t.y + Math.sin(c.pitch) * c.dist, t.z + Math.cos(c.yaw) * cp * c.dist);
    const gh = heightAt(pos.x, pos.z) + 0.5;
    if (pos.y < gh) pos.y = gh;
    this.camera.lookAt(t);
  }

  findInteractables() {
    const p = this.player;
    this.nearNpc = null;
    this.nearHerb = null;
    if (p.dead) return;
    let best = 4;
    for (const n of this.npcs) {
      const d = distXZ(n.pos, p.pos);
      if (d < best) { best = d; this.nearNpc = n; }
    }
    if (!this.nearNpc) {
      for (const h of this.world.herbs) {
        if (h.active && Math.hypot(h.x - p.pos.x, h.z - p.pos.z) < 2.2) { this.nearHerb = h; break; }
      }
    }
  }

  // ------------------------------------------------ ввод
  onKey(e) {
    const p = this.player, ui = this.ui;
    switch (e.code) {
      case 'Digit1': p.useSkill(0); break;
      case 'Digit2': p.useSkill(1); break;
      case 'Digit3': p.useSkill(2); break;
      case 'Digit4': p.usePotion('hp'); break;
      case 'Digit5': p.usePotion('mp'); break;
      case 'Tab': this.targetNearest(); break;
      case 'KeyE': this.interact(); break;
      case 'KeyI': case 'KeyB': ui.toggle('inventory'); break;
      case 'KeyC': ui.toggle('character'); break;
      case 'KeyL': case 'KeyJ': ui.toggle('quests'); break;
      case 'Enter': ui.focusChat(); e.preventDefault(); break;
      case 'Escape':
        if (ui.anyOpen()) ui.closeAll();
        else p.setTarget(null);
        break;
    }
  }

  onClick(x, y) {
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const objs = [...this.enemies.filter((e) => !e.dead).map((e) => e.model), ...this.npcs.map((n) => n.model)];
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.entity) o = o.parent;
      if (!o) continue;
      const ent = o.userData.entity;
      if (ent.isNpc) {
        if (distXZ(ent.pos, this.player.pos) < 5) this.ui.openDialog(ent);
        else this.ui.error('Подойдите ближе, чтобы поговорить');
      } else {
        this.player.setTarget(ent);
      }
      return;
    }
  }

  targetNearest() {
    const p = this.player;
    const list = this.enemies
      .filter((e) => !e.dead && distXZ(e.pos, p.pos) < 30)
      .sort((a, b) => distXZ(a.pos, p.pos) - distXZ(b.pos, p.pos));
    if (!list.length) return this.ui.error('Рядом нет врагов');
    const i = list.indexOf(p.target);
    p.setTarget(list[(i + 1) % list.length]);
  }

  interact() {
    if (this.nearNpc) return this.ui.openDialog(this.nearNpc);
    if (this.nearHerb) {
      const needed = Object.keys(this.player.quests.active).some((id) => {
        const q = QUESTS.find((q) => q.id === id);
        return q.target === 'herb' && this.player.quests.active[id] < q.count;
      });
      if (!needed) return this.ui.error('Сейчас вам не нужен лунник (возьмите задание у травницы)');
      const h = this.nearHerb;
      h.active = false;
      h.timer = 45;
      h.group.visible = false;
      this.fx.burst(new THREE.Vector3(h.x, heightAt(h.x, h.z) + 0.6, h.z), 0xc070ff, 14, 0.8);
      this.onQuestEvent('herb');
    }
  }

  enemiesNear(pos, radius) {
    return this.enemies.filter((e) => !e.dead && distXZ(e.pos, pos) <= radius + e.radius);
  }

  // ------------------------------------------------ награды и задания
  onEnemyKilled(e) {
    const p = this.player;
    const diff = e.level - p.level;
    const mod = clamp(1 + diff * 0.15, 0.1, 1.6);
    const xp = Math.max(1, Math.round(e.def.xp * (1 + 0.15 * (e.level - e.zone.level[0])) * mod));
    const gold = randInt(e.level, e.level * 3) * (e.def.boss ? 20 : 1);
    p.addGold(gold);
    this.ui.log(`${e.def.name} повержен. +${xp} опыта, +${gold} золота.`, 'loot');
    p.gainXp(xp);

    const drops = [];
    if (e.def.boss) {
      drops.push(generateItem('weapon', e.level, { rarity: 'epic', weaponType: p.cls.weapon }));
      drops.push(randomDrop(e.level, p.cls.weapon));
    } else if (Math.random() < 0.3) {
      drops.push(randomDrop(e.level, p.cls.weapon));
    }
    if (Math.random() < 0.15) drops.push(makePotion(Math.random() < 0.6 ? 'hp' : 'mp', 1));
    for (const it of drops) {
      if (p.addItem(it)) {
        const color = RARITIES[it.rarity].color;
        this.ui.log(`Добыча: <span style="color:${color}">[${it.name}]</span>`, 'loot', true);
      }
    }
    if (p.target === e) p.setTarget(null);
    this.onQuestEvent(e.type);
  }

  questState(id) {
    const q = QUESTS.find((q) => q.id === id);
    const Q = this.player.quests;
    if (Q.done.includes(id)) return 'done';
    if (id in Q.active) return Q.active[id] >= q.count ? 'ready' : 'active';
    if (q.requires && !Q.done.includes(q.requires)) return 'locked';
    if (this.player.level < q.level) return 'lowlevel';
    return 'available';
  }

  acceptQuest(id) {
    const q = QUESTS.find((q) => q.id === id);
    if (this.questState(id) !== 'available') return;
    this.player.quests.active[id] = 0;
    this.ui.log(`Новое задание: «${q.title}»`, 'quest');
    this.updateNpcMarkers();
    this.ui.refresh();
    this.save();
  }

  completeQuest(id) {
    const q = QUESTS.find((q) => q.id === id);
    if (this.questState(id) !== 'ready') return;
    const p = this.player, r = q.reward;
    const free = p.inventory.filter((i) => !i).length;
    if (r.item && free < 1) return this.ui.error('Освободите место в инвентаре');
    delete p.quests.active[id];
    p.quests.done.push(id);
    p.addGold(r.gold || 0);
    if (r.potions) for (const t in r.potions) p.addPotions(t, r.potions[t]);
    if (r.item) {
      const it = generateItem(r.item.slot, Math.max(p.level, q.level + 1), { rarity: r.item.rarity, weaponType: p.cls.weapon });
      p.addItem(it);
      this.ui.log(`Награда: <span style="color:${RARITIES[it.rarity].color}">[${it.name}]</span>`, 'loot', true);
    }
    this.ui.banner('Задание выполнено', q.title, 'quest');
    this.ui.log(`Задание «${q.title}» выполнено! +${r.xp} опыта, +${r.gold} золота.`, 'quest');
    p.gainXp(r.xp);
    this.updateNpcMarkers();
    this.ui.refresh();
    this.save();
  }

  onQuestEvent(target) {
    const Q = this.player.quests;
    for (const id in Q.active) {
      const q = QUESTS.find((q) => q.id === id);
      if (q.target !== target || Q.active[id] >= q.count) continue;
      Q.active[id]++;
      this.ui.log(`${q.title}: ${Q.active[id]}/${q.count}`, 'quest');
      if (Q.active[id] >= q.count) {
        const giver = NPCS.find((n) => n.id === q.giver);
        this.ui.banner('Цель выполнена', `Вернитесь к: ${giver.name}`, 'quest');
      }
    }
    this.updateNpcMarkers();
    this.ui.refresh();
  }

  updateNpcMarkers() {
    for (const n of this.npcs) {
      const qs = QUESTS.filter((q) => q.giver === n.def.id).map((q) => this.questState(q.id));
      if (qs.includes('ready')) n.marker.set('?', '#ffd030');
      else if (qs.includes('available')) n.marker.set('!', '#ffd030');
      else if (qs.includes('active')) n.marker.set('?', '#9a9a9a');
      else n.marker.set(null);
    }
  }

  save() {
    this.account.save = this.player.serialize();
    saveAccount(this.account);
  }
}
