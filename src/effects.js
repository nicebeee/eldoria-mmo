// Снаряды, кольца, вспышки частиц и всплывающие цифры урона
import * as THREE from 'three';
import { glowTexture, heightAt } from './world.js';
import { rand } from './utils.js';

const ringGeo = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const pillarGeo = new THREE.CylinderGeometry(0.9, 0.9, 5, 20, 1, true);
const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).rotateX(Math.PI / 2);
const tipGeo = new THREE.ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI / 2);
const coreGeo = new THREE.IcosahedronGeometry(0.18, 0);

export class Effects {
  constructor(game) {
    this.g = game;
    this.scene = game.scene;
    this.list = [];
    this.texts = [];
    this.layer = document.getElementById('float-layer');
    this.glow = glowTexture();
    this.v = new THREE.Vector3();
  }

  add(obj, update) {
    if (obj) this.scene.add(obj);
    this.list.push({ obj, update, t: 0 });
  }

  glowSprite(color, size, opacity = 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.scale.setScalar(size);
    return sp;
  }

  projectile(from, target, kind, onHit) {
    let obj, speed, color;
    if (kind === 'arrow' || kind === 'bigarrow') {
      obj = new THREE.Group();
      obj.add(new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ color: 0x8a6a3a })));
      const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xdddddd }));
      tip.position.z = 0.45;
      obj.add(tip);
      speed = 40;
      color = 0xffffff;
      if (kind === 'bigarrow') { obj.scale.setScalar(1.6); obj.add(this.glowSprite(0xffe080, 0.8)); color = 0xffe080; }
    } else {
      const fire = kind === 'fireball';
      color = fire ? 0xff7a20 : 0x9a7aff;
      obj = this.glowSprite(color, fire ? 1.6 : 0.9);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: fire ? 0xffe080 : 0xe0d8ff }));
      core.scale.setScalar(fire ? 1.3 : 0.7);
      obj.add(core);
      speed = fire ? 24 : 30;
    }
    obj.position.copy(from);
    const tp = new THREE.Vector3(), dir = new THREE.Vector3();
    let trail = 0;
    this.add(obj, (dt, e) => {
      if (target.dead || e.t > 4) return false;
      tp.copy(target.pos);
      tp.y += target.hitHeight || 1;
      dir.subVectors(tp, obj.position);
      const d = dir.length();
      const step = speed * dt;
      if (d <= step + 0.35) {
        onHit();
        this.burst(tp, color, kind === 'fireball' ? 16 : 7, kind === 'fireball' ? 1.2 : 0.6);
        return false;
      }
      obj.position.addScaledVector(dir.normalize(), step);
      if (obj.isGroup) obj.lookAt(tp);
      else if ((trail += dt) > 0.03) {
        trail = 0;
        this.fade(obj.position, color, kind === 'fireball' ? 0.9 : 0.5, 0.3);
      }
    });
  }

  fade(pos, color, size, life) {
    const sp = this.glowSprite(color, size, 0.7);
    sp.position.copy(pos);
    this.add(sp, (dt, e) => {
      const k = e.t / life;
      if (k >= 1) return false;
      sp.material.opacity = 0.7 * (1 - k);
      sp.scale.setScalar(size * (1 - k * 0.6));
    });
  }

  burst(pos, color, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      const sp = this.glowSprite(color, rand(0.25, 0.5) * power);
      sp.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).multiplyScalar(4 * power);
      const life = rand(0.35, 0.7);
      this.add(sp, (dt, e) => {
        const k = e.t / life;
        if (k >= 1) return false;
        v.y -= 9 * dt;
        sp.position.addScaledVector(v, dt);
        sp.material.opacity = 1 - k;
      });
    }
  }

  ring(pos, radius, color, dur = 0.5) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(pos.x, heightAt(pos.x, pos.z) + 0.15, pos.z);
    this.add(m, (dt, e) => {
      const k = e.t / dur;
      if (k >= 1) return false;
      m.scale.setScalar(radius * (0.25 + 0.75 * (1 - (1 - k) * (1 - k))));
      m.material.opacity = 1 - k;
    });
  }

  // предупреждающий круг (удар босса)
  telegraph(pos, radius, dur) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.15, depthWrite: false }));
    const edge = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    g.add(disc, edge);
    g.scale.setScalar(radius);
    g.position.set(pos.x, heightAt(pos.x, pos.z) + 0.12, pos.z);
    this.add(g, (dt, e) => {
      const k = e.t / dur;
      if (k >= 1) return false;
      disc.material.opacity = 0.15 + k * 0.35;
      disc.scale.setScalar(k);
    });
  }

  pillar(pos, color, dur = 1) {
    const m = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(pos.x, pos.y + 2.5, pos.z);
    this.add(m, (dt, e) => {
      const k = e.t / dur;
      if (k >= 1) return false;
      m.position.x = this.g.player.pos.x;
      m.position.z = this.g.player.pos.z;
      m.scale.set(1 - k * 0.5, 1 + k, 1 - k * 0.5);
      m.material.opacity = 0.6 * (1 - k);
    });
  }

  floatText(pos, text, cls = 'dmg') {
    const el = document.createElement('div');
    el.className = 'ft ' + cls;
    el.textContent = text;
    this.layer.appendChild(el);
    this.texts.push({ el, p: pos.clone(), t: 0, life: cls === 'xp' || cls === 'info' ? 1.6 : 1.1, dx: rand(-0.5, 0.5) });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      if (e.update(dt, e) === false) {
        if (e.obj) {
          this.scene.remove(e.obj);
          e.obj.traverse((o) => { if (o.material) o.material.dispose(); });
        }
        this.list.splice(i, 1);
      }
    }
    const cam = this.g.camera, W = innerWidth, H = innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      if (t.t >= t.life) { t.el.remove(); this.texts.splice(i, 1); continue; }
      t.p.y += dt * 1.4;
      t.p.x += t.dx * dt;
      this.v.copy(t.p).project(cam);
      if (this.v.z > 1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      const pop = t.t < 0.12 ? 1.4 - t.t * 3.3 : 1;
      t.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${pop})`;
      t.el.style.opacity = String(1 - Math.pow(t.t / t.life, 3));
    }
  }
}
