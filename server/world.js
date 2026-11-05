// Серверная симуляция общего мира: монстры, их ИИ, урон и награды
import { MOBS, SPAWN_ZONES, SLOTS } from '../src/data.js';
import { inSafeZone } from '../src/terrain.js';
import { rand, randInt } from '../src/utils.js';
import { Social } from './social.js';

const TICK = 1 / 20;
const LEASH = 38;
const r2 = (v) => Math.round(v * 100) / 100;

// для отображения чужих персонажей нужны только внешние признаки вещей
function visualEquip(eq = {}) {
  const out = {};
  for (const s of SLOTS) {
    const it = eq[s];
    if (it) out[s] = { tier: it.tier ?? 0, color: it.color, rarity: it.rarity, weaponType: it.weaponType };
  }
  return out;
}

class SEnemy {
  constructor(world, id, zoneIdx) {
    this.world = world;
    this.id = id;
    this.zoneIdx = zoneIdx;
    this.zone = SPAWN_ZONES[zoneIdx];
    this.def = MOBS[this.zone.mob];
    this.spawn();
  }

  spawn() {
    const z = this.zone;
    this.level = randInt(z.level[0], z.level[1]);
    const lv = this.level - z.level[0];
    this.maxHp = Math.round(this.def.hp * (1 + 0.14 * lv));
    this.hp = this.maxHp;
    this.dmg = this.def.dmg * (1 + 0.12 * lv);
    this.armor = this.def.armor * (1 + 0.2 * lv);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius;
    this.hx = z.center[0] + Math.cos(a) * r;
    this.hz = z.center[1] + Math.sin(a) * r;
    this.x = this.hx; this.z = this.hz;
    this.ry = Math.random() * Math.PI * 2;
    this.state = 'idle';
    this.dead = false;
    this.deadTimer = 0;
    this.atkTimer = 0;
    this.wanderTimer = rand(1, 6);
    this.wx = this.x; this.wz = this.z;
    this.slow = 0;
    this.specialTimer = 6;
    this.target = null;
    this.moving = false;
    this.contrib = new Map();
  }

  info() {
    return [this.id, this.zoneIdx, this.level, Math.round(this.hp), this.maxHp, r2(this.x), r2(this.z), r2(this.ry), this.dead ? 1 : 0];
  }

  moveTo(tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.ry = Math.atan2(dx, dz);
    return d;
  }

  // ближайший живой игрок вне деревни в радиусе агрессии
  findTarget() {
    let best = null, bd = this.def.aggro;
    for (const p of this.world.players.values()) {
      if (p.dead || !p.ready || inSafeZone(p.x, p.z)) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  validTarget(p) {
    return p && this.world.players.get(p.id) === p && !p.dead && !inSafeZone(p.x, p.z);
  }

  update(dt) {
    const w = this.world;
    if (this.dead) {
      this.deadTimer += dt;
      if (this.deadTimer > (this.def.respawn || 20)) {
        this.spawn();
        w.broadcast({ t: 'e_spawn', e: this.info() });
      }
      return;
    }
    this.atkTimer -= dt;
    this.slow -= dt;
    const spd = this.def.speed * (this.slow > 0 ? 0.5 : 1);
    const distHome = Math.hypot(this.x - this.hx, this.z - this.hz);
    this.moving = false;

    switch (this.state) {
      case 'idle':
      case 'wander': {
        const t = this.findTarget();
        if (t) { this.target = t; this.state = 'chase'; break; }
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          if (this.state === 'idle') {
            const a = Math.random() * Math.PI * 2, r = Math.random() * this.zone.radius;
            this.wx = this.zone.center[0] + Math.cos(a) * r;
            this.wz = this.zone.center[1] + Math.sin(a) * r;
            this.state = 'wander';
            this.wanderTimer = 8;
          } else { this.state = 'idle'; this.wanderTimer = rand(2, 7); }
        }
        if (this.state === 'wander') {
          const d = this.moveTo(this.wx, this.wz, spd * 0.35, dt);
          this.moving = d > 0.3;
          if (!this.moving) { this.state = 'idle'; this.wanderTimer = rand(2, 7); }
        }
        break;
      }
      case 'chase': {
        if (!this.validTarget(this.target)) this.target = this.findTarget();
        const p = this.target;
        if (!p || distHome > LEASH) { this.state = 'return'; this.target = null; break; }
        const dp = Math.hypot(p.x - this.x, p.z - this.z);
        if (dp > this.def.range + 0.25) {
          this.moveTo(p.x, p.z, spd, dt);
          this.moving = true;
        } else {
          this.ry = Math.atan2(p.x - this.x, p.z - this.z);
          if (this.def.boss) this.specialTimer -= dt;
          if (this.def.boss && this.specialTimer <= 0) this.slam();
          else if (this.atkTimer <= 0) this.attack(p);
        }
        this.separate();
        break;
      }
      case 'return': {
        const d = this.moveTo(this.hx, this.hz, spd * 1.3, dt);
        this.moving = true;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
        if (d < 0.5) {
          this.state = 'idle';
          this.hp = this.maxHp;
          this.contrib.clear();
          w.broadcast({ t: 'e_hp', e: this.id, hp: this.hp });
        }
        break;
      }
    }
  }

  separate() {
    for (const o of this.world.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const min = (this.def.radius + o.def.radius) * 0.9;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d < min) {
        const push = (min - d) * 0.5;
        this.x += (dx / d) * push;
        this.z += (dz / d) * push;
      }
    }
  }

  attack(p) {
    const w = this.world;
    this.atkTimer = this.def.atkCd;
    w.broadcast({ t: 'e_atk', e: this.id, a: this.def.model === 'wolf' ? 'bite' : 'melee' });
    w.later(0.3, () => {
      if (this.dead || !this.validTarget(p)) return;
      if (Math.hypot(p.x - this.x, p.z - this.z) <= this.def.range + 1.5) {
        p.send({ t: 'hurt', dmg: Math.round(this.dmg * rand(0.85, 1.15)), e: this.id });
      }
    });
  }

  slam() {
    const w = this.world;
    this.specialTimer = rand(7, 10);
    this.atkTimer = 2.2;
    const cx = this.x, cz = this.z, R = 6.5;
    w.broadcast({ t: 'e_slam', e: this.id, x: r2(cx), z: r2(cz), r: R });
    w.later(1.2, () => {
      if (this.dead) return;
      for (const p of w.players.values()) {
        if (!p.dead && Math.hypot(p.x - cx, p.z - cz) < R) p.send({ t: 'hurt', dmg: Math.round(this.dmg * 1.8), e: this.id });
      }
    });
  }

  hit(p, dmg, crit, slow) {
    if (this.dead) return;
    const w = this.world;
    dmg = Math.max(1, Math.round(Math.min(dmg, 100000) * (1 - this.armor / (this.armor + 80))));
    this.hp -= dmg;
    this.contrib.set(p.id, (this.contrib.get(p.id) || 0) + dmg);
    if (slow) this.slow = Math.min(slow, 6);
    if (this.state !== 'return' && this.state !== 'chase') { this.state = 'chase'; this.target = p; }
    if (this.state === 'chase' && !this.validTarget(this.target)) this.target = p;
    w.broadcast({ t: 'e_dmg', e: this.id, dmg, crit: crit ? 1 : 0, hp: Math.max(0, Math.round(this.hp)), by: p.id });
    if (this.hp <= 0) this.die();
  }

  die() {
    const w = this.world;
    this.hp = 0;
    this.dead = true;
    this.deadTimer = 0;
    this.state = 'dead';
    w.broadcast({ t: 'e_die', e: this.id });
    // награда всем, кто бил монстра, и их группам, если они поблизости
    const got = new Set();
    for (const pid of this.contrib.keys()) {
      const p = w.players.get(pid);
      if (p) for (const m of w.social.mates(p)) got.add(m);
    }
    for (const p of got) if (Math.hypot(p.x - this.x, p.z - this.z) < 80) p.send({ t: 'kill', e: this.id });
    this.contrib.clear();
  }
}

export class World {
  constructor() {
    this.players = new Map();
    this.enemies = [];
    this.timers = [];
    this.social = new Social(this);
    let id = 0;
    SPAWN_ZONES.forEach((z, zi) => { for (let i = 0; i < z.count; i++) this.enemies.push(new SEnemy(this, id++, zi)); });
    this.netAcc = 0;
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      this.tick(dt);
    }, TICK * 1000);
  }

  later(delay, fn) { this.timers.push({ t: delay, fn }); }

  findByAccount(username) {
    for (const p of this.players.values()) if (p.account.username === username) return p;
    return null;
  }

  addPlayer(id, ws, send, account) {
    const s = account.save;
    const [x, z] = s.pos || [0, 7];
    const p = {
      id, ws, send, account, name: account.username, classId: s.classId, level: s.level,
      equip: visualEquip(s.equipment), x, y: 0, z, ry: 0, m: 0, sm: 1, hp: 1, mhp: 1, dead: false, ready: false,
    };
    this.players.set(id, p);
    this.broadcast({ t: 'p_join', p: this.publicInfo(p) }, id);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.social.onLeave(p);
    this.players.delete(id);
    for (const e of this.enemies) if (e.target?.id === id) e.target = null;
    this.broadcast({ t: 'p_leave', id });
  }

  publicInfo(p) {
    return { id: p.id, name: p.name, classId: p.classId, level: p.level, equip: p.equip, x: r2(p.x), y: r2(p.y), z: r2(p.z), ry: r2(p.ry), hp: p.hp, mhp: p.mhp, dead: p.dead };
  }

  snapshot(selfId) {
    return {
      players: [...this.players.values()].filter((p) => p.id !== selfId).map((p) => this.publicInfo(p)),
      enemies: this.enemies.map((e) => e.info()),
    };
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  onMessage(p, m) {
    switch (m.t) {
      case 'st': {
        const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
        p.x = num(m.x, p.x); p.y = num(m.y, p.y); p.z = num(m.z, p.z); p.ry = num(m.ry);
        p.m = m.m ? 1 : 0; p.sm = num(m.sm, 1);
        p.hp = num(m.hp); p.mhp = num(m.mhp, 1); p.dead = !!m.dead;
        p.ready = true;
        if (m.lvl && m.lvl !== p.level) { p.level = m.lvl; this.broadcast({ t: 'p_eq', id: p.id, equip: p.equip, level: p.level }, p.id); }
        break;
      }
      case 'eq':
        p.equip = visualEquip(m.equipment);
        this.broadcast({ t: 'p_eq', id: p.id, equip: p.equip, level: p.level }, p.id);
        break;
      case 'anim':
        this.broadcast({ t: 'p_anim', id: p.id, a: String(m.a), d: Number(m.d) || 0.5 }, p.id);
        break;
      case 'proj':
        this.broadcast({ t: 'p_proj', id: p.id, k: String(m.k), e: m.e, pl: m.pl }, p.id);
        break;
      case 'fx':
        this.broadcast({ t: 'p_fx', id: p.id, k: String(m.k), x: m.x, z: m.z, r: m.r, c: m.c }, p.id);
        break;
      case 'hit': {
        const e = this.enemies[m.e];
        if (e) e.hit(p, Number(m.dmg) || 0, m.crit, Number(m.slow) || 0);
        break;
      }
      case 'chat': {
        const msg = String(m.msg || '').slice(0, 120).trim();
        if (msg) this.broadcast({ t: 'chat', from: p.name, msg });
        break;
      }
      default:
        this.social.handle(p, m);
    }
  }

  tick(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if ((t.t -= dt) <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    if (!this.players.size) return; // мир «спит», пока никого нет
    this.social.tick();
    for (const e of this.enemies) e.update(dt);
    this.netAcc += dt;
    if (this.netAcc >= 0.1) {
      this.netAcc = 0;
      const es = [];
      for (const e of this.enemies) if (!e.dead) es.push(e.id, r2(e.x), r2(e.z), r2(e.ry), e.moving ? 1 : 0);
      const ps = [];
      for (const p of this.players.values()) ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.m, r2(p.sm), Math.round(p.hp), Math.round(p.mhp), p.dead ? 1 : 0]);
      this.broadcast({ t: 'tick', es, ps });
    }
  }
}
