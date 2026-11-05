// Другие игроки: модель, табличка, плавная интерполяция позиции
import * as THREE from 'three';
import { CLASSES, CC_NAMES } from './data.js';

const PVP_MULT = 0.6; // по игрокам проходит 60% урона
import { createHumanoid, applyEquipment, createNameplate, animateModel, playAttack, setDead } from './models.js';
import { lerpAngle } from './utils.js';

export class RemotePlayer {
  constructor(game, info) {
    this.game = game;
    this.id = info.id;
    this.name = info.name;
    this.cls = CLASSES[info.classId] || CLASSES.warrior;
    this.isRemote = true;
    this.model = createHumanoid(this.cls.look);
    this.pos = this.model.position;
    this.target = new THREE.Vector3(info.x, info.y, info.z);
    this.pos.copy(this.target);
    this.ry = info.ry || 0;
    this.model.rotation.y = this.ry;
    this.plate = createNameplate('', '#7dffa0', true, true);
    this.plate.sprite.position.y = 2.45;
    this.model.add(this.plate.sprite);
    this.hitHeight = 1.2;
    this.radius = 0.5;
    this.hp = info.hp;
    this.maxHp = info.mhp || 1;
    this.model.userData.entity = this;
    this.dead = false;
    this.level = info.level;
    this.setEquip(info.equip, info.level);
    this.setState(info.x, info.y, info.z, info.ry, 0, 1, info.hp, info.mhp, info.dead);
    game.scene.add(this.model);
  }

  setEquip(equip, level) {
    applyEquipment(this.model, equip || {});
    this.level = level ?? this.level;
    this.plate.setText(`[${this.level}] ${this.name}`);
  }

  setState(x, y, z, ry, m, sm, hp, mhp, dead) {
    this.target.set(x, y, z);
    this.ry = ry;
    const a = this.model.userData.anim;
    a.moving = !!m;
    a.speedMul = sm || 1;
    this.hp = hp;
    this.maxHp = mhp || 1;
    this.plate.draw(mhp ? Math.max(0, hp / mhp) : 1);
    if (!!dead !== this.dead) {
      this.dead = !!dead;
      setDead(this.model, this.dead);
    }
  }

  // урон по другому игроку (PvP) — его применит сам пострадавший
  takeDamage(amount, src, crit, fx) {
    if (this.dead || !this.game.social.canAttack(this)) return;
    const pvpFx = fx ? { ...fx } : null;
    if (pvpFx?.dot) pvpFx.dot = { ...pvpFx.dot, dps: Math.round(pvpFx.dot.dps * PVP_MULT) };
    this.game.net.send({ t: 'pvp_hit', to: this.id, dmg: Math.round(amount * PVP_MULT), crit: crit ? 1 : 0, fx: pvpFx });
  }

  // контроль на чужом игроке (видят все)
  showCC(kind, dur) {
    this.ccT = dur;
    const col = { freeze: 0x3080ff, stun: 0x605000, root: 0x206020, knock: 0x000000 }[kind] ?? 0;
    for (const m of this.model.userData.mats) {
      if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
      m.emissive.setHex(col || m.userData.baseEmissive);
    }
    this.game.fx.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z), (CC_NAMES[kind] || '') + '!', 'info');
  }

  anim(type, dur) {
    playAttack(this.model, type, dur);
  }

  muzzle() {
    const r = this.model.rotation.y;
    return new THREE.Vector3(this.pos.x + Math.sin(r) * 0.7, this.pos.y + 1.5, this.pos.z + Math.cos(r) * 0.7);
  }

  update(dt) {
    if (this.ccT > 0 && (this.ccT -= dt) <= 0) {
      for (const m of this.model.userData.mats) if (m.userData.baseEmissive !== undefined) m.emissive.setHex(m.userData.baseEmissive);
    }
    // далёкий прыжок (телепорт, воскрешение) — без интерполяции
    if (this.pos.distanceToSquared(this.target) > 400) this.pos.copy(this.target);
    else this.pos.lerp(this.target, 1 - Math.exp(-12 * dt));
    this.model.rotation.y = lerpAngle(this.model.rotation.y, this.ry, 1 - Math.exp(-14 * dt));
    animateModel(this.model, dt, this.game.time);
  }

  dispose() {
    this.game.scene.remove(this.model);
  }
}
