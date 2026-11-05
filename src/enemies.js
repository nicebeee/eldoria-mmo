import * as THREE from 'three';
import { MOBS } from './data.js';
import { createMobModel, createNameplate, createMarker, createHumanoid, applyEquipment, animateModel, playAttack, setDead } from './models.js';
import { heightAt, VILLAGE_RADIUS } from './world.js';
import { rand, randInt, distXZ, lerpAngle } from './utils.js';

const LEASH = 38;

export class Enemy {
  constructor(game, zone) {
    this.game = game;
    this.zone = zone;
    this.type = zone.mob;
    this.def = MOBS[this.type];
    this.model = createMobModel(this.def);
    this.model.userData.entity = this;
    this.scale = this.model.scale.x;
    this.plate = createNameplate('', this.def.boss ? '#ffa040' : '#ff8a7a', true);
    this.plate.sprite.position.y = this.def.plateY / this.scale;
    this.plate.sprite.scale.set(2.6 / this.scale, 0.65 / this.scale, 1);
    this.model.add(this.plate.sprite);
    this.pos = this.model.position;
    this.home = new THREE.Vector3();
    this.radius = this.def.radius;
    this.hitHeight = this.def.hitHeight;
    this.wanderTarget = new THREE.Vector3();
    game.scene.add(this.model);
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
    const x = z.center[0] + Math.cos(a) * r, zz = z.center[1] + Math.sin(a) * r;
    this.home.set(x, heightAt(x, zz), zz);
    this.pos.copy(this.home);
    this.model.rotation.y = Math.random() * Math.PI * 2;
    this.state = 'idle';
    this.dead = false;
    this.deadTimer = 0;
    this.atkTimer = 0;
    this.wanderTimer = rand(1, 6);
    this.slow = 0;
    this.flash = 0;
    this.specialTimer = 6;
    this.model.visible = true;
    setDead(this.model, false);
    this.plate.setText(`[${this.level}] ${this.def.name}`);
    this.plate.draw(1, true);
    this.plate.sprite.visible = true;
  }

  aggro() {
    if (this.state !== 'chase') this.state = 'chase';
  }

  takeDamage(amount, src, crit) {
    if (this.dead) return;
    const dmg = Math.max(1, Math.round(amount * (1 - this.armor / (this.armor + 80))));
    this.hp -= dmg;
    this.flash = 0.12;
    const p = new THREE.Vector3(this.pos.x, this.pos.y + this.hitHeight + 0.8, this.pos.z);
    this.game.fx.floatText(p, crit ? `${dmg}!` : String(dmg), crit ? 'crit' : 'dmg');
    if (src?.isPlayer) src.combatTimer = 6;
    if (this.state !== 'return') this.aggro();
    this.plate.draw(this.hp / this.maxHp);
    if (this.hp <= 0) this.die();
  }

  die() {
    this.hp = 0;
    this.dead = true;
    this.state = 'dead';
    this.deadTimer = 0;
    this.plate.sprite.visible = false;
    setDead(this.model, true);
    this.setFlash(0);
    this.game.onEnemyKilled(this);
  }

  setFlash(v) {
    for (const m of this.model.userData.mats) {
      if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
      if (v > 0) m.emissive.setHex(0x661010);
      else m.emissive.setHex(m.userData.baseEmissive);
    }
  }

  moveTowards(target, speed, dt) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.model.rotation.y = lerpAngle(this.model.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
    return d;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const a = this.model.userData.anim;
    if (this.dead) {
      this.deadTimer += dt;
      if (this.deadTimer > 3) this.pos.y -= dt * 0.6;
      if (this.deadTimer > 5) this.model.visible = false;
      if (this.deadTimer > (this.def.respawn || 20)) this.spawn();
      else { a.moving = false; animateModel(this.model, dt, g.time); }
      return;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      this.setFlash(this.flash);
    }
    this.atkTimer -= dt;
    this.slow -= dt;
    const spd = this.def.speed * (this.slow > 0 ? 0.5 : 1);
    const distP = distXZ(this.pos, p.pos);
    const distHome = distXZ(this.pos, this.home);
    const playerSafe = Math.hypot(p.pos.x, p.pos.z) < VILLAGE_RADIUS - 2;
    let moving = false;
    a.speedMul = 1;

    switch (this.state) {
      case 'idle':
      case 'wander':
        if (!p.dead && !playerSafe && distP < this.def.aggro) { this.aggro(); break; }
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          if (this.state === 'idle') {
            const ang = Math.random() * Math.PI * 2, r = Math.random() * this.zone.radius;
            this.wanderTarget.set(this.zone.center[0] + Math.cos(ang) * r, 0, this.zone.center[1] + Math.sin(ang) * r);
            this.state = 'wander';
            this.wanderTimer = 8;
          } else {
            this.state = 'idle';
            this.wanderTimer = rand(2, 7);
          }
        }
        if (this.state === 'wander') {
          const d = this.moveTowards(this.wanderTarget, spd * 0.35, dt);
          moving = d > 0.3;
          a.speedMul = 0.5;
          if (!moving) { this.state = 'idle'; this.wanderTimer = rand(2, 7); }
        }
        break;
      case 'chase':
        if (p.dead || playerSafe || distHome > LEASH) { this.state = 'return'; break; }
        if (distP > this.def.range + p.radius * 0.5) {
          this.moveTowards(p.pos, spd, dt);
          moving = true;
        } else {
          const ang = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          this.model.rotation.y = lerpAngle(this.model.rotation.y, ang, 1 - Math.exp(-10 * dt));
          if (this.def.boss) this.specialTimer -= dt;
          if (this.def.boss && this.specialTimer <= 0) this.slam();
          else if (this.atkTimer <= 0) this.attack();
        }
        break;
      case 'return': {
        const d = this.moveTowards(this.home, spd * 1.3, dt);
        moving = true;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
        this.plate.draw(this.hp / this.maxHp);
        if (d < 0.5) { this.state = 'idle'; this.hp = this.maxHp; this.plate.draw(1); }
        break;
      }
    }
    if (this.state === 'chase') this.separate();
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    a.moving = moving;
    animateModel(this.model, dt, g.time);
  }

  separate() {
    for (const o of this.game.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const min = (this.radius + o.radius) * 0.9;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d < min) {
        const push = (min - d) * 0.5;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
      }
    }
  }

  attack() {
    const g = this.game, p = g.player;
    this.atkTimer = this.def.atkCd;
    playAttack(this.model, this.def.model === 'wolf' ? 'bite' : 'melee', 0.5);
    g.schedule(0.3, () => {
      if (this.dead || p.dead) return;
      if (distXZ(this.pos, p.pos) <= this.def.range + 1.5) p.takeDamage(this.dmg * rand(0.85, 1.15));
    });
  }

  // особая атака босса: удар по земле с предупреждением
  slam() {
    const g = this.game;
    this.specialTimer = rand(7, 10);
    this.atkTimer = 2.2;
    const center = this.pos.clone();
    const R = 6.5;
    g.fx.telegraph(center, R, 1.2);
    g.ui.error('Гром-Вожак готовит сокрушительный удар — отбегите!');
    g.schedule(0.5, () => { if (!this.dead) playAttack(this.model, 'slam', 0.8); });
    g.schedule(1.2, () => {
      if (this.dead) return;
      g.fx.ring(center, R, 0xff6030, 0.5);
      g.fx.burst(center.clone().setY(center.y + 0.5), 0xc09060, 20, 1.5);
      if (!g.player.dead && distXZ(center, g.player.pos) < R) g.player.takeDamage(this.dmg * 1.8);
    });
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
