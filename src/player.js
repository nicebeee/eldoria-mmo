import * as THREE from 'three';
import { CLASSES, SLOTS, STAT_KEYS, MAX_LEVEL, MAX_ALLOC, POINTS_PER_LEVEL, xpForLevel, makePotion } from './data.js';
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
    const dmgBuff = this.buffs.rage > 0 ? 1.3 : 1;
    const haste = this.buffs.haste > 0;
    return {
      maxHp: Math.round(60 + s.vit * 12 + this.level * 12),
      maxMp: Math.round(30 + s.int * 8 + this.level * 4),
      phys: Math.round((wd + s.str * 1.5) * dmgBuff),
      magic: Math.round((wd + s.int * 1.8) * dmgBuff),
      interval: this.cls.atkCd / (1 + s.agi * 0.02) / (haste ? 1.3 : 1),
      armor,
      reduction: armor / (armor + 60),
      crit: 0.05 + s.agi * 0.002,
      speed: 7 * (haste ? 1.5 : 1),
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
    const d = this.derived();
    const inCombat = this.combatTimer > 0;
    this.hp = Math.min(d.maxHp, this.hp + d.maxHp * (inCombat ? 0.004 : 0.03) * dt);
    this.mp = Math.min(d.maxMp, this.mp + d.mpRegen * (inCombat ? 1 : 3) * dt);

    // движение относительно камеры
    const k = g.input.keys;
    const typing = g.ui.isTyping();
    let f = 0, s = 0;
    if (!typing) {
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
    if (!typing && k.Space && this.onGround) { this.vy = 7.5; this.onGround = false; }
    if (this.onGround) this.pos.y = gh;
    else {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) { this.pos.y = gh; this.vy = 0; this.onGround = true; }
    }
    this.model.rotation.y = lerpAngle(this.model.rotation.y, this.facing, 1 - Math.exp(-14 * dt));

    if (this.target && this.target.dead) this.target = null;
    if (this.target && !this.target.isNpc) this.tryAutoAttack(d);

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

  shoot(t, proj, mult) {
    this.game.fx.projectile(this.muzzle(), t, proj, () => this.dealDamage(t, mult));
    this.game.net.send(t.isRemote ? { t: 'proj', k: proj, pl: t.id } : { t: 'proj', k: proj, e: t.id });
  }

  ring(pos, r, color, dur) {
    this.game.fx.ring(pos, r, color, dur);
    this.game.net.send({ t: 'fx', k: 'ring', x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), r, c: color });
  }

  dealDamage(t, mult, slow = 0) {
    if (t.dead) return;
    const d = this.derived();
    const base = this.cls.dmgType === 'magic' ? d.magic : d.phys;
    let dmg = base * mult * rand(0.9, 1.1);
    const crit = Math.random() < d.crit;
    if (crit) dmg *= 1.75;
    t.takeDamage(Math.round(dmg), this, crit, slow);
  }

  // ------------------------------------------------ способности
  useSkill(i) {
    const g = this.game;
    const sk = this.cls.skills[i];
    if (!sk || this.dead) return;
    if (this.cooldowns[sk.id] > 0) return this.game.ui.error('Способность ещё не готова');
    if (this.mp < sk.mana) return this.game.ui.error('Недостаточно маны');
    const tg = this.target;
    const t = tg && !tg.dead && !tg.isNpc && (!tg.isRemote || g.social.canAttack(tg)) ? tg : null;
    const needsTarget = ['strike', 'projectile', 'volley'].includes(sk.type);
    if (needsTarget) {
      if (!t) return g.ui.error('Нет цели (кликните по врагу или нажмите Tab)');
      const range = sk.type === 'strike' ? this.cls.range : sk.range || this.cls.range;
      if (!this.inRange(t, range)) return g.ui.error('Цель слишком далеко');
    }
    const d = this.derived();
    const fxPos = this.pos.clone();
    switch (sk.type) {
      case 'strike':
        this.basicAttack(t, sk.mult, null);
        g.schedule(0.22, () => this.ring(t.pos, 2.2, 0xffb040, 0.4));
        break;
      case 'projectile':
        this.basicAttack(t, sk.mult, sk.proj);
        break;
      case 'whirl':
        this.anim('spin', 0.5);
        this.combatTimer = 6;
        this.ring(fxPos, sk.radius, 0xffd080, 0.45);
        g.schedule(0.2, () => {
          for (const e of g.hostilesNear(this.pos, sk.radius)) this.dealDamage(e, sk.mult);
        });
        break;
      case 'nova':
        this.anim('cast', 0.45);
        this.combatTimer = 6;
        this.ring(fxPos, sk.radius, 0x80d0ff, 0.6);
        g.fx.burst(fxPos.clone().setY(fxPos.y + 1), 0x9adfff, 24, 1.3);
        for (const e of g.hostilesNear(this.pos, sk.radius)) {
          this.dealDamage(e, sk.mult, sk.slow);
        }
        break;
      case 'volley': {
        this.anim('bow', 0.5);
        this.faceTarget(t);
        this.combatTimer = 6;
        const victims = g.hostilesNear(t.pos, sk.radius);
        victims.forEach((e, n) => g.schedule(0.25 + n * 0.07, () => {
          if (!e.dead) this.shoot(e, 'arrow', sk.mult);
        }));
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
      case 'buff':
        this.buffs[sk.buff] = sk.duration;
        this.ring(fxPos, 3, sk.buff === 'rage' ? 0xff5030 : 0x80ffd0, 0.6);
        g.fx.pillar(this.pos, sk.buff === 'rage' ? 0xff5030 : 0x80ffd0, 0.8);
        g.fx.floatText(this.headPos(), sk.name + '!', 'info');
        break;
    }
    this.mp -= sk.mana;
    this.cooldowns[sk.id] = sk.cd;
  }

  headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z);
  }

  // ------------------------------------------------ урон и смерть
  // opts.from — id игрока-атакующего (PvP), opts.duel — урон в дуэли не убивает
  takeDamage(amount, opts = {}) {
    if (this.dead) return 0;
    const d = this.derived();
    let dmg = Math.max(1, Math.round(amount * (1 - d.reduction)));
    this.combatTimer = 6;
    if (opts.duel && this.hp - dmg < 1) {
      dmg = Math.max(0, Math.floor(this.hp - 1));
      this.hp = 1;
      this.game.fx.floatText(this.headPos(), '-' + dmg, 'dmg-me');
      this.game.net.send({ t: 'duel_lost' });
      this.game.ui.banner('Поражение', 'Вы проиграли дуэль', 'zone');
      return dmg;
    }
    this.hp -= dmg;
    this.game.fx.floatText(this.headPos(), '-' + dmg, 'dmg-me');
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
      quests: this.quests, pos: [+this.pos.x.toFixed(2), +this.pos.z.toFixed(2)],
      hp: Math.round(this.hp), mp: Math.round(this.mp),
    };
  }
}
