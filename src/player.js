import * as THREE from 'three';
import { CLASSES, SLOTS, STAT_KEYS, MAX_LEVEL, MAX_ALLOC, POINTS_PER_LEVEL, SKILL_SLOTS, CC_NAMES, xpForLevel, makePotion, skillById, defaultLoadout } from './data.js';
import { createHumanoid, applyEquipment, playAttack, animateModel, setDead, createNameplate } from './models.js';
import { heightAt, WORLD_HALF } from './world.js';
import { rand, clamp, distXZ, lerpAngle } from './utils.js';

export class Player {
  constructor(game, save) {
    this.game = game;
    this.isPlayer = true;
    this.classId = save.classId;
    this.cls = CLASSES[this.classId];
    this.name = save.name;
    this.level = save.level;
    this.xp = save.xp;
    this.gold = save.gold;
    this.statPoints = save.statPoints;
    this.alloc = { ...save.alloc };
    this.inventory = save.inventory;
    this.equipment = save.equipment;
    this.quests = save.quests;

    this.model = createHumanoid(this.cls.look);
    this.model.userData.entity = this;
    this.plate = createNameplate(this.name, '#9fe3ff', false);
    this.plate.sprite.position.y = 2.45;
    this.model.add(this.plate.sprite);
    game.scene.add(this.model);
    this.refreshEquipment();

    const [x, z] = save.pos || [0, 7];
    this.pos = this.model.position;
    this.pos.set(x, heightAt(x, z), z);
    this.hitHeight = 1.2;
    this.radius = 0.5;
    this.vy = 0;
    this.onGround = true;
    this.facing = 0;
    this.target = null;
    this.atkTimer = 0;
    this.cooldowns = {};
    this.potionCd = 0;
    this.buffs = {};
    this.combatTimer = 0;
    this.dead = false;
    this.warnTimer = 0;
    this.loadout = this.sanitizeLoadout(save.skills);
    this.knownSkills = new Set(this.cls.skills.filter((s) => s.lvl <= this.level).map((s) => s.id));
    // эффекты на герое: замедление, контроль, яды, метка
    this.ef = { slow: null, stun: 0, stunMax: 0, cc: null, root: 0, ccImmune: 0, dots: [], vuln: null };
    this.shield = 0;
    this.dash = null;

    const d = this.derived();
    this.hp = clamp(save.hp ?? d.maxHp, 1, d.maxHp);
    this.mp = clamp(save.mp ?? d.maxMp, 0, d.maxMp);
  }

  // ------------------------------------------------ характеристики
  get stats() {
    const s = {};
    for (const k of STAT_KEYS) s[k] = this.cls.base[k] + this.alloc[k];
    for (const slot of SLOTS) {
      const it = this.equipment[slot];
      if (it) for (const k in it.stats) s[k] += it.stats[k];
    }
    return s;
  }

  derived() {
    const s = this.stats;
    const w = this.equipment.weapon;
    const wd = w ? w.dmg : 3;
    let armor = 0;
    for (const slot of SLOTS) armor += this.equipment[slot]?.armor || 0;
    const dmgBuff = (this.buffs.rage > 0 ? 1.3 : 1) * (this.buffs.berserk > 0 ? 1.2 : 1);
    const haste = this.buffs.haste > 0;
    const slowMul = this.ef?.slow && !(this.buffs.unstop > 0) ? 1 - this.ef.slow.p : 1;
    return {
      maxHp: Math.round(60 + s.vit * 12 + this.level * 12),
      maxMp: Math.round(30 + s.int * 8 + this.level * 4),
      phys: Math.round((wd + s.str * 1.5) * dmgBuff),
      magic: Math.round((wd + s.int * 1.8) * dmgBuff),
      interval: this.cls.atkCd / (1 + s.agi * 0.02) / (haste ? 1.3 : 1),
      armor,
      reduction: armor / (armor + 60),
      crit: 0.05 + s.agi * 0.002,
      speed: 7 * (haste ? 1.5 : 1) * slowMul,
      mpRegen: 1 + s.int * 0.12,
    };
  }

  addStat(k) {
    if (this.statPoints <= 0) return;
    this.statPoints--;
    this.alloc[k]++;
    if (k === 'vit') this.hp += 12;
    if (k === 'int') this.mp += 8;
    this.game.ui.refresh();
  }

  // ------------------------------------------------ обновление
  update(dt) {
    const g = this.game;
    this.atkTimer -= dt;
    this.potionCd -= dt;
    this.combatTimer -= dt;
    this.warnTimer -= dt;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k in this.buffs) if (this.buffs[k] > 0) this.buffs[k] -= dt;

    const a = this.model.userData.anim;
    if (this.dead) {
      a.moving = false;
      animateModel(this.model, dt, g.time);
      return;
    }
    this.tickEffects(dt);
    if (this.dead) return;
    if (this.buffs.barrier <= 0) this.shield = 0;
    const d = this.derived();
    const inCombat = this.combatTimer > 0;
    this.hp = Math.min(d.maxHp, this.hp + d.maxHp * (inCombat ? 0.004 : 0.03) * dt);
    this.mp = Math.min(d.maxMp, this.mp + d.mpRegen * (inCombat ? 1 : 3) * dt);

    // рывок / отскок: движение по заданной траектории
    if (this.dash) {
      const ds = this.dash;
      ds.t = Math.min(1, ds.t + dt / ds.dur);
      this.pos.x = ds.sx + (ds.ex - ds.sx) * ds.t;
      this.pos.z = ds.sz + (ds.ez - ds.sz) * ds.t;
      this.pos.y = heightAt(this.pos.x, this.pos.z) + Math.sin(Math.PI * ds.t) * ds.arc;
      if (ds.t >= 1) {
        this.dash = null;
        this.collide();
        ds.onEnd?.();
      }
      a.moving = true;
      a.speedMul = 2;
      this.model.rotation.y = lerpAngle(this.model.rotation.y, this.facing, 1 - Math.exp(-20 * dt));
      animateModel(this.model, dt, g.time);
      return;
    }

    const stunned = this.isStunned();
    const rooted = this.ef.root > 0 && !(this.buffs.unstop > 0);

    // движение относительно камеры
    const k = g.input.keys;
    const typing = g.ui.isTyping();
    let f = 0, s = 0;
    if (!typing && !stunned && !rooted) {
      if (k.KeyW || k.ArrowUp) f += 1;
      if (k.KeyS || k.ArrowDown) f -= 1;
      if (k.KeyD || k.ArrowRight) s += 1;
      if (k.KeyA || k.ArrowLeft) s -= 1;
    }
    const yaw = g.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * f + rx * s, dz = fz * f + rz * s;
    const len = Math.hypot(dx, dz);
    const moving = len > 0.01;
    if (moving) {
      dx /= len; dz /= len;
      const back = f < 0 && s === 0;
      const sp = d.speed * (back ? 0.6 : 1);
      this.pos.x += dx * sp * dt;
      this.pos.z += dz * sp * dt;
      this.facing = back ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
    } else if (this.target && !this.target.dead && this.combatTimer > 0) {
      this.facing = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
    }
    this.collide();
    const lim = WORLD_HALF - 6;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    // прыжок и гравитация
    const gh = heightAt(this.pos.x, this.pos.z);
    if (!typing && !stunned && !rooted && k.Space && this.onGround) { this.vy = 7.5; this.onGround = false; }
    if (this.ef.cc === 'knock' && this.ef.stun > 0) {
      // подброшен в воздух
      this.pos.y = gh + Math.sin(Math.PI * (1 - this.ef.stun / this.ef.stunMax)) * 1.8;
      this.model.rotation.y += dt * 8;
    } else if (this.onGround) this.pos.y = gh;
    else {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) { this.pos.y = gh; this.vy = 0; this.onGround = true; }
    }
    if (!stunned) this.model.rotation.y = lerpAngle(this.model.rotation.y, this.facing, 1 - Math.exp(-14 * dt));

    if (this.target && this.target.dead) this.target = null;
    if (this.target && !this.target.isNpc && !stunned) this.tryAutoAttack(d);

    a.moving = moving;
    a.speedMul = d.speed / 7 * (f < 0 && s === 0 ? -0.7 : 1);
    animateModel(this.model, dt, g.time);
  }

  collide() {
    for (const c of this.game.world.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const min = c.r + this.radius;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const dist = Math.hypot(dx, dz);
      if (dist < min && dist > 1e-4) {
        this.pos.x = c.x + (dx / dist) * min;
        this.pos.z = c.z + (dz / dist) * min;
      }
    }
  }

  setTarget(e) {
    this.target = e;
    this.game.ui.refreshTarget();
  }

  faceTarget(t) {
    this.facing = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
  }

  inRange(t, range) {
    return distXZ(this.pos, t.pos) <= range + (t.radius || 0.5);
  }

  warn(msg) {
    if (this.warnTimer > 0) return;
    this.warnTimer = 1.5;
    this.game.ui.error(msg);
  }

  tryAutoAttack(d) {
    const t = this.target;
    if (this.atkTimer > 0) return;
    if (t.isRemote && !this.game.social.canAttack(t)) return;
    if (!this.inRange(t, this.cls.range)) return;
    this.atkTimer = d.interval;
    this.basicAttack(t, 1, this.cls.projectile);
  }

  // базовый удар/выстрел с анимацией, mult — множитель урона
  basicAttack(t, mult, proj, anim) {
    const g = this.game;
    this.faceTarget(t);
    this.combatTimer = 6;
    const type = anim || this.cls.attackAnim;
    this.anim(type, type === 'bow' ? 0.55 : 0.45);
    if (!proj) {
      g.schedule(0.22, () => {
        if (t.dead || this.dead) return;
        if (!this.inRange(t, this.cls.range + 1)) return;
        this.dealDamage(t, mult);
        g.fx.burst(t.pos.clone().setY(t.pos.y + t.hitHeight), 0xffe0a0, 5, 0.6);
      });
    } else {
      g.schedule(type === 'bow' ? 0.3 : 0.2, () => {
        if (t.dead || this.dead) return;
        this.shoot(t, proj, mult);
      });
    }
  }

  muzzle() {
    const r = this.model.rotation.y;
    return new THREE.Vector3(this.pos.x + Math.sin(r) * 0.7, this.pos.y + 1.5, this.pos.z + Math.cos(r) * 0.7);
  }

  // анимация видна и другим игрокам
  anim(type, dur) {
    playAttack(this.model, type, dur);
    this.game.net.send({ t: 'anim', a: type, d: dur });
  }

  shoot(t, proj, mult, fxDef = null) {
    this.game.fx.projectile(this.muzzle(), t, proj, () => this.dealDamage(t, mult, fxDef));
    this.game.net.send(t.isRemote ? { t: 'proj', k: proj, pl: t.id } : { t: 'proj', k: proj, e: t.id });
  }

  ring(pos, r, color, dur) {
    this.game.fx.ring(pos, r, color, dur);
    this.game.net.send({ t: 'fx', k: 'ring', x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), r, c: color });
  }

  // fxDef — эффект умения из data.js ({ slow, stun, dot:[доля урона, сек, %хп], ... })
  dealDamage(t, mult, fxDef = null) {
    if (t.dead) return;
    const d = this.derived();
    const base = this.cls.dmgType === 'magic' ? d.magic : d.phys;
    let dmg = base * mult * rand(0.9, 1.1);
    const crit = Math.random() < d.crit;
    if (crit) dmg *= 1.75;
    t.takeDamage(Math.round(dmg), this, crit, this.buildFx(fxDef, base));
  }

  buildFx(def, base) {
    if (!def) return null;
    const fx = { ...def };
    if (def.dot) fx.dot = { dps: Math.round(base * def.dot[0]), d: def.dot[1], pct: def.dot[2] || 0 };
    return fx;
  }

  // ------------------------------------------------ умения
  sanitizeLoadout(ids) {
    const valid = (id) => this.cls.skills.some((s) => s.id === id && s.lvl <= this.level);
    const out = Array.isArray(ids) ? ids.slice(0, SKILL_SLOTS).map((id) => (valid(id) ? id : null)) : defaultLoadout(this.classId, this.level);
    while (out.length < SKILL_SLOTS) out.push(null);
    return out;
  }

  skillAt(i) {
    const id = this.loadout[i];
    return id ? skillById(this.cls, id) : null;
  }

  // поставить умение в слот (или убрать, если id = null)
  setSkillSlot(i, id) {
    if (this.combatTimer > 0) return this.game.ui.error('Нельзя менять умения в бою');
    if (id) {
      const sk = skillById(this.cls, id);
      if (!sk || sk.lvl > this.level) return;
      const prev = this.loadout.indexOf(id);
      if (prev >= 0) this.loadout[prev] = this.loadout[i];
    }
    this.loadout[i] = id;
    this.game.ui.buildActionBar();
    this.game.ui.renderSkills();
  }

  isStunned() {
    return this.ef.stun > 0 && !(this.buffs.unstop > 0);
  }

  useSkill(i) {
    const g = this.game;
    const sk = this.skillAt(i);
    if (!sk || this.dead) return;
    if (this.isStunned()) return g.ui.error('Вы под контролем и не можете действовать');
    if (this.dash) return;
    if (this.cooldowns[sk.id] > 0) return g.ui.error('Умение ещё не готово');
    if (this.mp < sk.mana) return g.ui.error('Недостаточно маны');
    const tg = this.target;
    const t = tg && !tg.dead && !tg.isNpc && (!tg.isRemote || g.social.canAttack(tg)) ? tg : null;
    if (['strike', 'projectile', 'volley', 'charge', 'aoe_target'].includes(sk.type)) {
      if (!t) return g.ui.error('Нет цели (кликните по врагу или нажмите Tab)');
      const range = sk.type === 'strike' ? this.cls.range : sk.range || this.cls.range;
      if (!this.inRange(t, range)) return g.ui.error('Цель слишком далеко');
    }
    if ((sk.type === 'charge' || sk.type === 'leap') && this.ef.root > 0 && !(this.buffs.unstop > 0)) return g.ui.error('Вы обездвижены');
    const d = this.derived();
    const here = this.pos.clone();
    if (sk.type !== 'buff' && sk.type !== 'heal' && sk.type !== 'blink') this.combatTimer = 6;

    switch (sk.type) {
      case 'strike':
        this.faceTarget(t);
        this.anim('melee', 0.45);
        g.schedule(0.22, () => {
          if (t.dead || this.dead || !this.inRange(t, this.cls.range + 1)) return;
          this.dealDamage(t, sk.mult, sk.fx);
          this.ring(t.pos, 2.2, 0xffb040, 0.4);
        });
        break;
      case 'projectile':
        this.faceTarget(t);
        this.anim(this.cls.attackAnim, this.cls.attackAnim === 'bow' ? 0.55 : 0.45);
        g.schedule(this.cls.attackAnim === 'bow' ? 0.3 : 0.2, () => {
          if (!t.dead && !this.dead) this.shoot(t, sk.proj, sk.mult, sk.fx);
        });
        break;
      case 'aoe_self':
        this.anim(sk.anim, 0.5);
        this.ring(here, sk.radius, sk.color, 0.55);
        g.fx.burst(here.clone().setY(here.y + 1), sk.color, 20, 1.2);
        g.schedule(0.2, () => {
          for (const e of g.hostilesNear(this.pos, sk.radius)) this.dealDamage(e, sk.mult, sk.fx);
        });
        break;
      case 'aoe_target': {
        this.faceTarget(t);
        this.anim('cast', 0.6);
        const c = t.pos.clone();
        g.fx.telegraph(c, sk.radius, 1);
        g.net.send({ t: 'fx', k: 'tele', x: +c.x.toFixed(2), z: +c.z.toFixed(2), r: sk.radius });
        g.schedule(1, () => {
          this.ring(c, sk.radius, 0xff6020, 0.6);
          g.fx.burst(c.clone().setY(c.y + 0.5), 0xff7020, 26, 1.6);
          for (const e of g.hostilesNear(c, sk.radius)) this.dealDamage(e, sk.mult, sk.fx);
        });
        break;
      }
      case 'volley': {
        this.anim('bow', 0.5);
        this.faceTarget(t);
        g.hostilesNear(t.pos, sk.radius).forEach((e, n) => g.schedule(0.25 + n * 0.07, () => {
          if (!e.dead) this.shoot(e, 'arrow', sk.mult);
        }));
        break;
      }
      case 'charge': {
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        const stop = Math.max(0, dist - (t.radius || 0.5) - 1.1);
        this.faceTarget(t);
        this.cleanseMovement();
        this.dash = {
          sx: this.pos.x, sz: this.pos.z, ex: this.pos.x + (dx / dist) * stop, ez: this.pos.z + (dz / dist) * stop,
          t: 0, dur: Math.max(0.12, stop / 45), arc: 0.4,
          onEnd: () => {
            this.anim('melee', 0.4);
            g.schedule(0.15, () => {
              if (!t.dead && this.inRange(t, this.cls.range + 1.5)) {
                this.dealDamage(t, sk.mult, sk.fx);
                this.ring(t.pos, 2.5, 0xffe060, 0.4);
              }
            });
          },
        };
        g.fx.burst(here.clone().setY(here.y + 1), 0xffe060, 12, 1);
        break;
      }
      case 'leap': {
        const r = this.model.rotation.y;
        const bx = -Math.sin(r), bz = -Math.cos(r);
        const lim = WORLD_HALF - 6;
        this.cleanseMovement();
        for (const e of g.hostilesNear(here, sk.radius)) this.dealDamage(e, 0.3, sk.fx);
        this.ring(here, sk.radius, 0x9adfff, 0.5);
        this.dash = {
          sx: this.pos.x, sz: this.pos.z, ex: clamp(this.pos.x + bx * sk.dist, -lim, lim), ez: clamp(this.pos.z + bz * sk.dist, -lim, lim),
          t: 0, dur: 0.4, arc: 2.2,
        };
        break;
      }
      case 'blink': {
        const r = this.facing;
        const fx = Math.sin(r), fz = Math.cos(r);
        const lim = WORLD_HALF - 6;
        g.fx.pillar(here, 0xb080ff, 0.6);
        g.fx.burst(here.clone().setY(here.y + 1), 0xb080ff, 16, 1);
        this.pos.x = clamp(this.pos.x + fx * sk.dist, -lim, lim);
        this.pos.z = clamp(this.pos.z + fz * sk.dist, -lim, lim);
        this.pos.y = heightAt(this.pos.x, this.pos.z);
        this.collide();
        this.cleanseMovement();
        g.fx.burst(this.pos.clone().setY(this.pos.y + 1), 0xb080ff, 16, 1);
        break;
      }
      case 'heal': {
        this.anim('cast', 0.5);
        const amount = Math.round(40 + d.magic * 1.5);
        this.hp = Math.min(d.maxHp, this.hp + amount);
        g.fx.pillar(this.pos, 0x60ff90, 1);
        g.fx.floatText(this.headPos(), '+' + amount, 'heal');
        break;
      }
      case 'buff': {
        this.buffs[sk.buff] = sk.duration;
        if (sk.cleanse) this.cleanseAll();
        if (sk.buff === 'barrier') this.shield = Math.round(40 + d.magic * 3);
        const col = { rage: 0xff5030, berserk: 0xc01818, thorns: 0x70c040, unstop: 0xd8c8a0, barrier: 0x60b0ff, haste: 0x80ffd0 }[sk.buff] ?? 0xffffff;
        this.ring(here, 3, col, 0.6);
        g.fx.pillar(this.pos, col, 0.8);
        g.fx.floatText(this.headPos(), sk.name + '!', 'info');
        break;
      }
    }
    this.mp -= sk.mana;
    this.cooldowns[sk.id] = sk.cd;
  }

  // ------------------------------------------------ эффекты на герое
  cleanseMovement() {
    this.ef.slow = null;
    this.ef.root = 0;
  }

  cleanseAll() {
    this.cleanseMovement();
    this.ef.stun = 0;
    this.ef.cc = null;
    this.setTint(null);
  }

  setTint(color) {
    for (const m of this.model.userData.mats) {
      if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
      m.emissive.setHex(color ?? m.userData.baseEmissive);
    }
  }

  // эффект от врага или игрока (PvP)
  applyFx(fx, fromId) {
    if (!fx || this.dead) return;
    const g = this.game;
    const immune = this.buffs.unstop > 0;
    if (fx.slow && fx.slow[1] > 0 && !immune) this.ef.slow = { p: fx.slow[0], t: fx.slow[1], end: fx.slow[2] || 0 };
    for (const k of ['stun', 'knock', 'freeze']) if (fx[k]) this.applyCC(k, fx[k]);
    if (fx.root && !immune) {
      this.ef.root = Math.max(this.ef.root, fx.root);
      g.fx.floatText(this.headPos(), CC_NAMES.root, 'info');
      g.net.send({ t: 'fx', k: 'cc', c: 'root', r: fx.root });
    }
    if (fx.dot && fx.dot.d > 0) this.ef.dots.push({ dps: fx.dot.dps, pct: fx.dot.pct, t: fx.dot.d, acc: 0, from: fromId });
    if (fx.vuln) this.ef.vuln = { p: fx.vuln[0], t: fx.vuln[1] };
  }

  applyCC(kind, dur) {
    if (this.buffs.unstop > 0 || this.ef.ccImmune > 0) return;
    this.ef.stun = dur;
    this.ef.stunMax = dur;
    this.ef.cc = kind;
    this.dash = null;
    if (kind === 'freeze') this.setTint(0x3080ff);
    if (kind === 'stun') this.setTint(0x605000);
    this.game.fx.floatText(this.headPos(), CC_NAMES[kind] + '!', 'info');
    this.game.net.send({ t: 'fx', k: 'cc', c: kind, r: dur });
  }

  tickEffects(dt) {
    const ef = this.ef;
    if (ef.ccImmune > 0) ef.ccImmune -= dt;
    if (ef.root > 0) ef.root -= dt;
    if (ef.vuln && (ef.vuln.t -= dt) <= 0) ef.vuln = null;
    if (ef.stun > 0) {
      ef.stun -= dt;
      if (ef.stun <= 0) {
        ef.cc = null;
        ef.ccImmune = 2; // защита от бесконечного контроля
        this.setTint(null);
      }
    }
    if (ef.slow) {
      ef.slow.t -= dt;
      if (ef.slow.t <= 0) {
        const end = ef.slow.end;
        ef.slow = null;
        if (end) this.applyCC('freeze', end);
      }
    }
    for (let i = ef.dots.length - 1; i >= 0; i--) {
      const dot = ef.dots[i];
      dot.t -= dt;
      dot.acc += dt;
      if (dot.acc >= 1) {
        dot.acc -= 1;
        const pct = dot.pct ? Math.min(dot.pct * this.derived().maxHp, dot.dps * 3 + 20) : 0;
        this.takeDamage(dot.dps + pct, { from: dot.from, pierce: true, dot: true, duel: this.game.social?.duel?.active && this.game.social.duel.with === dot.from });
        if (this.dead) return;
      }
      if (dot.t <= 0) ef.dots.splice(i, 1);
    }
  }

  headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z);
  }

  // ------------------------------------------------ урон и смерть
  // opts: from — id игрока (PvP), enemy — id монстра, duel — в дуэли урон не убивает,
  // pierce — сквозь броню, dot — периодический/отражённый урон (не отражается шипами)
  takeDamage(amount, opts = {}) {
    if (this.dead) return 0;
    const d = this.derived();
    let dmg = amount * (opts.pierce ? 1 : 1 - d.reduction);
    if (this.ef.vuln) dmg *= 1 + this.ef.vuln.p;
    if (this.buffs.berserk > 0) dmg *= 0.6;
    dmg = Math.max(1, Math.round(dmg));
    this.combatTimer = 6;
    if (this.buffs.thorns > 0 && !opts.dot) {
      const back = Math.max(1, Math.round(dmg * 0.35));
      if (opts.enemy != null) this.game.net.send({ t: 'hit', e: opts.enemy, dmg: back, crit: 0, fx: { pierce: 1 } });
      else if (opts.from) this.game.net.send({ t: 'pvp_hit', to: opts.from, dmg: back, crit: 0, dot: 1, fx: { pierce: 1 } });
    }
    if (this.shield > 0) {
      const ab = Math.min(this.shield, dmg);
      this.shield -= ab;
      dmg -= ab;
      if (dmg <= 0) {
        this.game.fx.floatText(this.headPos(), 'Поглощено', 'mana');
        return 0;
      }
    }
    if (opts.duel && this.hp - dmg < 1) {
      dmg = Math.max(0, Math.floor(this.hp - 1));
      this.hp = 1;
      this.game.fx.floatText(this.headPos(), '-' + dmg, 'dmg-me');
      this.game.net.send({ t: 'duel_lost' });
      this.game.ui.banner('Поражение', 'Вы проиграли дуэль', 'zone');
      return dmg;
    }
    this.hp -= dmg;
    this.game.fx.floatText(this.headPos(), '-' + dmg, opts.dot ? 'dot' : 'dmg-me');
    if (this.hp <= 0) this.die(opts.from);
    return dmg;
  }

  die(killerId) {
    if (killerId) this.game.net.send({ t: 'pvp_death', by: killerId });
    if (this.game.social?.duel) this.game.net.send({ t: 'duel_lost' });
    this.hp = 0;
    this.dead = true;
    this.target = null;
    setDead(this.model, true);
    this.game.ui.showDeath(true);
    this.game.ui.log('Вы погибли.', 'bad');
  }

  respawn() {
    const d = this.derived();
    this.dead = false;
    setDead(this.model, false);
    this.pos.set(0, heightAt(0, 7), 7);
    this.game.cam.yaw = 0;
    this.hp = d.maxHp * 0.6;
    this.mp = d.maxMp * 0.6;
    this.combatTimer = 0;
    this.game.ui.showDeath(false);
    this.game.ui.log('Вы воскресли в деревне Рассвет.', 'sys');
    this.game.fx.pillar(this.pos, 0xfff0a0, 1.2);
  }

  // ------------------------------------------------ опыт и золото
  gainXp(n) {
    if (this.level >= MAX_LEVEL) return;
    this.xp += n;
    this.game.fx.floatText(this.headPos().setY(this.pos.y + 2.6), `+${n} опыта`, 'xp');
    while (this.level < MAX_LEVEL && this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      this.statPoints += POINTS_PER_LEVEL;
      const d = this.derived();
      this.hp = d.maxHp;
      this.mp = d.maxMp;
      this.game.fx.pillar(this.pos, 0xffd040, 1.6);
      this.game.fx.ring(this.pos, 4, 0xffd040, 0.8);
      this.game.ui.banner(`Уровень ${this.level}!`, `+${POINTS_PER_LEVEL} очков характеристик — откройте персонажа (C)`);
      this.game.ui.log(`Вы достигли ${this.level} уровня! Получено ${POINTS_PER_LEVEL} очков характеристик.`, 'good');
      this.game.updateNpcMarkers();
      this.unlockSkills();
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    this.game.ui.refresh();
  }

  addGold(n) {
    this.gold += n;
  }

  // ------------------------------------------------ инвентарь
  addItem(item) {
    if (item.type === 'potion') {
      const stack = this.inventory.find((i) => i && i.type === 'potion' && i.potion === item.potion);
      if (stack) { stack.count += item.count; this.game.ui.refresh(); return true; }
    }
    const idx = this.inventory.indexOf(null);
    if (idx < 0) { this.game.ui.error('Инвентарь полон!'); return false; }
    this.inventory[idx] = item;
    this.game.ui.refresh();
    return true;
  }

  addPotions(type, count) {
    return this.addItem(makePotion(type, count));
  }

  countPotion(type) {
    const s = this.inventory.find((i) => i && i.type === 'potion' && i.potion === type);
    return s ? s.count : 0;
  }

  usePotion(type) {
    if (this.dead) return;
    if (this.potionCd > 0) return this.game.ui.error(`Зелье можно выпить через ${Math.ceil(this.potionCd)} сек.`);
    const idx = this.inventory.findIndex((i) => i && i.type === 'potion' && i.potion === type);
    if (idx < 0) return this.game.ui.error(type === 'hp' ? 'Нет зелий здоровья' : 'Нет зелий маны');
    const d = this.derived();
    if (type === 'hp') {
      const n = Math.round(d.maxHp * 0.4);
      this.hp = Math.min(d.maxHp, this.hp + n);
      this.game.fx.floatText(this.headPos(), '+' + n, 'heal');
    } else {
      const n = Math.round(d.maxMp * 0.4);
      this.mp = Math.min(d.maxMp, this.mp + n);
      this.game.fx.floatText(this.headPos(), '+' + n, 'mana');
    }
    this.potionCd = 5;
    const it = this.inventory[idx];
    if (--it.count <= 0) this.inventory[idx] = null;
    this.game.ui.refresh();
  }

  canEquip(item) {
    if (!item || item.type === 'potion') return false;
    if (item.slot === 'weapon' && item.weaponType !== this.cls.weapon) return false;
    return true;
  }

  equip(idx) {
    const item = this.inventory[idx];
    if (!item || item.type === 'potion') return;
    if (!this.canEquip(item)) return this.game.ui.error(`${this.cls.name} не может использовать это оружие`);
    const old = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    this.inventory[idx] = old || null;
    this.refreshEquipment();
    this.clampVitals();
    this.game.ui.log(`Надето: ${item.name}`, 'sys');
    this.game.ui.refresh();
  }

  unequip(slot) {
    const item = this.equipment[slot];
    if (!item) return;
    const idx = this.inventory.indexOf(null);
    if (idx < 0) return this.game.ui.error('Инвентарь полон!');
    this.inventory[idx] = item;
    this.equipment[slot] = null;
    this.refreshEquipment();
    this.clampVitals();
    this.game.ui.refresh();
  }

  clampVitals() {
    const d = this.derived();
    this.hp = Math.min(this.hp, d.maxHp);
    this.mp = Math.min(this.mp, d.maxMp);
  }

  refreshEquipment() {
    applyEquipment(this.model, this.equipment);
    this.game.net.send({ t: 'eq', equipment: this.equipment });
  }

  // вещи, выложенные на обмен, при сохранении считаются лежащими в сумке
  inventoryForSave() {
    const inv = [...this.inventory];
    for (const it of this.game.social?.offeredItems() ?? []) {
      const i = inv.indexOf(null);
      if (i >= 0) inv[i] = it;
    }
    return inv;
  }

  // открытые на этом уровне умения — в свободные слоты
  unlockSkills() {
    for (const sk of this.cls.skills) {
      if (sk.lvl > this.level || this.loadout.includes(sk.id) || this.knownSkills?.has(sk.id)) continue;
      this.knownSkills ??= new Set();
      this.knownSkills.add(sk.id);
      const free = this.loadout.indexOf(null);
      if (free >= 0) this.loadout[free] = sk.id;
      this.game.ui.log(`Новое умение: ${sk.icon} ${sk.name}${free >= 0 ? '' : ' — выберите его в окне умений (K)'}`, 'quest');
    }
    this.game.ui.buildActionBar();
    this.game.ui.renderSkills();
  }

  // результат админ-команды с сервера
  applyAdmin(cmd, items) {
    if (cmd === 'max_item' && items) {
      for (const it of items) {
        const old = this.equipment[it.slot];
        this.equipment[it.slot] = it;
        if (old) this.addItem(old);
      }
      this.refreshEquipment();
      this.game.ui.banner('Легендарный комплект!', 'Все слоты экипировки обновлены', 'quest');
    }
    if (cmd === 'max_stat') {
      this.level = MAX_LEVEL;
      this.xp = 0;
      this.statPoints = 0;
      for (const k of STAT_KEYS) this.alloc[k] = MAX_ALLOC;
      this.game.ui.banner(`Уровень ${MAX_LEVEL}!`, 'Характеристики увеличены до максимума', 'quest');
      this.game.updateNpcMarkers();
      this.unlockSkills();
    }
    const d = this.derived();
    this.hp = d.maxHp;
    this.mp = d.maxMp;
    this.game.fx.pillar(this.pos, 0xff9a2a, 1.6);
    this.game.fx.ring(this.pos, 4, 0xff9a2a, 0.8);
    this.game.ui.refresh();
    this.game.save();
  }

  serialize() {
    return {
      name: this.name, classId: this.classId, level: this.level, xp: this.xp, gold: this.gold,
      statPoints: this.statPoints, alloc: this.alloc, inventory: this.inventoryForSave(), equipment: this.equipment,
      quests: this.quests, skills: this.loadout, pos: [+this.pos.x.toFixed(2), +this.pos.z.toFixed(2)],
      hp: Math.round(this.hp), mp: Math.round(this.mp),
    };
  }
}
