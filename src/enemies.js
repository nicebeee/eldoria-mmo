import * as THREE from 'three';
import { MOBS, SPAWN_ZONES } from './data.js';
import { createMobModel, createNameplate, createMarker, createHumanoid, applyEquipment, animateModel, playAttack, setDead } from './models.js';
import { heightAt } from './world.js';
import { distXZ, lerpAngle } from './utils.js';

// Монстр на клиенте — только отображение. ИИ, здоровье и смерть считает сервер.
export class Enemy {
  // info: [id, zoneIdx, level, hp, maxHp, x, z, ry, dead]
  constructor(game, info) {
    this.game = game;
    this.id = info[0];
    this.zone = SPAWN_ZONES[info[1]];
    this.type = this.zone.mob;
    this.def = MOBS[this.type];
    this.model = createMobModel(this.def);
    this.model.userData.entity = this;
    this.scale = this.model.scale.x;
    this.plate = createNameplate('', this.def.boss ? '#ffa040' : '#ff8a7a', true);
    this.plate.sprite.position.y = this.def.plateY / this.scale;
    this.plate.sprite.scale.set(2.6 / this.scale, 0.65 / this.scale, 1);
    this.model.add(this.plate.sprite);
    this.pos = this.model.position;
    this.radius = this.def.radius;
    this.hitHeight = this.def.hitHeight;
    this.target = new THREE.Vector3();
    this.ry = 0;
    this.flash = 0;
    game.scene.add(this.model);
    this.applyInfo(info);
  }

  applyInfo(info) {
    const [, , level, hp, maxHp, x, z, ry, dead] = info;
    this.level = level;
    this.hp = hp;
    this.maxHp = maxHp;
    this.target.set(x, heightAt(x, z), z);
    this.pos.copy(this.target);
    this.ry = ry;
    this.model.rotation.y = ry;
    this.dead = !!dead;
    this.deadTimer = this.dead ? 10 : 0;
    setDead(this.model, this.dead);
    this.model.visible = !this.dead;
    this.plate.setText(`[${level}] ${this.def.name}`);
    this.plate.draw(hp / maxHp, true);
    this.plate.sprite.visible = !this.dead;
  }

  netMove(x, z, ry, moving) {
    this.target.set(x, heightAt(x, z), z);
    this.ry = ry;
    this.model.userData.anim.moving = !!moving;
  }

  // вызывается игроком — урон отправляется на сервер
  takeDamage(amount, src, crit, slow) {
    if (this.dead) return;
    this.game.net.send({ t: 'hit', e: this.id, dmg: amount, crit: crit ? 1 : 0, slow: slow || 0 });
  }

  onDamage(dmg, crit, hp) {
    this.hp = hp;
    this.flash = 0.12;
    const p = new THREE.Vector3(this.pos.x, this.pos.y + this.hitHeight + 0.8, this.pos.z);
    this.game.fx.floatText(p, crit ? `${dmg}!` : String(dmg), crit ? 'crit' : 'dmg');
    this.plate.draw(hp / this.maxHp);
  }

  setHp(hp) {
    this.hp = hp;
    this.plate.draw(hp / this.maxHp);
  }

  onDie() {
    this.hp = 0;
    this.dead = true;
    this.deadTimer = 0;
    this.plate.sprite.visible = false;
    setDead(this.model, true);
    this.setFlash(0);
    const p = this.game.player;
    if (p.target === this) p.setTarget(null);
  }

  onAttack(type) {
    playAttack(this.model, this.def.boss ? 'slam' : type, 0.5);
  }

  setFlash(v) {
    for (const m of this.model.userData.mats) {
      if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
      m.emissive.setHex(v > 0 ? 0x661010 : m.userData.baseEmissive);
    }
  }

  update(dt) {
    const a = this.model.userData.anim;
    if (this.dead) {
      this.deadTimer += dt;
      if (this.deadTimer > 3) this.pos.y -= dt * 0.6;
      if (this.deadTimer > 5) this.model.visible = false;
      a.moving = false;
      if (this.model.visible) animateModel(this.model, dt, this.game.time);
      return;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      this.setFlash(this.flash);
    }
    if (this.pos.distanceToSquared(this.target) > 400) this.pos.copy(this.target);
    else this.pos.lerp(this.target, 1 - Math.exp(-10 * dt));
    this.model.rotation.y = lerpAngle(this.model.rotation.y, this.ry, 1 - Math.exp(-12 * dt));
    animateModel(this.model, dt, this.game.time);
  }
}

export class Npc {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.isNpc = true;
    this.model = createHumanoid(def.look);
    applyEquipment(this.model, def.equip || {});
    this.model.userData.entity = this;
    this.pos = this.model.position;
    this.pos.set(def.pos[0], heightAt(def.pos[0], def.pos[1]), def.pos[1]);
    this.model.rotation.y = Math.atan2(-def.pos[0], -def.pos[1]);
    this.baseRot = this.model.rotation.y;
    this.plate = createNameplate(def.name, '#ffd86b', false);
    this.plate.sprite.position.y = 2.45;
    this.model.add(this.plate.sprite);
    this.marker = createMarker();
    this.marker.sprite.position.y = 3.05;
    this.model.add(this.marker.sprite);
    this.hitHeight = 1.2;
    this.radius = 0.6;
    game.scene.add(this.model);
    game.world.colliders.push({ x: def.pos[0], z: def.pos[1], r: 0.6 });
  }

  update(dt) {
    const p = this.game.player;
    const d = distXZ(this.pos, p.pos);
    const want = d < 8 ? Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) : this.baseRot;
    this.model.rotation.y = lerpAngle(this.model.rotation.y, want, 1 - Math.exp(-4 * dt));
    this.marker.sprite.position.y = 3.05 + Math.sin(this.game.time * 3) * 0.08;
    animateModel(this.model, dt, this.game.time);
  }
}
