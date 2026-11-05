// Группы, обмен вещами, дуэли и PvP на клиенте
import * as THREE from 'three';
import { CLASSES, RARITIES } from './data.js';
import { itemIcon } from './icons.js';
import { inArena } from './terrain.js';

const $ = (s) => document.querySelector(s);
function el(tag, id, cls) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REQ_TEXT = {
  party: (n) => `<b>${n}</b> приглашает вас в группу`,
  trade: (n) => `<b>${n}</b> предлагает обмен`,
  duel: (n) => `<b>${n}</b> вызывает вас на дуэль!`,
};

export class Social {
  constructor(game) {
    this.g = game;
    this.party = { leader: null, members: [] };
    this.trade = null;
    this.duel = null;
    this.acc = 0;
    const hud = $('#hud');
    this.partyEl = el('div', 'party-frames');
    this.menuEl = el('div', 'player-menu', 'hidden');
    this.reqEl = el('div', 'requests');
    hud.append(this.partyEl, this.menuEl, this.reqEl);
    document.addEventListener('mousedown', (e) => { if (!this.menuEl.contains(e.target)) this.hideMenu(); });

    $('#trade-ready-btn').onclick = () => this.toggleReady();
    $('#trade-cancel-btn').onclick = () => this.cancelTrade();
    $('#trade-gold').addEventListener('change', () => this.sendOffer());
    this.bindNet();
  }

  get me() { return this.g.player; }
  get net() { return this.g.net; }

  findRemote(name) {
    const n = String(name || '').trim().toLowerCase();
    for (const r of this.g.remotes.values()) if (r.name.toLowerCase() === n) return r;
    return null;
  }

  inParty(id) { return this.party.members.some((m) => m.id === id); }

  canAttack(r) {
    if (!r || !r.isRemote || r.dead || this.me.dead) return false;
    if (this.duel?.active && this.duel.with === r.id) return true;
    return inArena(this.me.pos.x, this.me.pos.z) && inArena(r.pos.x, r.pos.z);
  }

  request(kind, r) {
    if (!r) return this.g.ui.error('Игрок не найден');
    this.net.send({ t: 'req', kind, to: r.id });
  }

  // ------------------------------------------------ сеть
  bindNet() {
    const net = this.net, ui = this.g.ui;
    net.on('req', (m) => this.addRequest(m.kind, m.from, m.name));
    net.on('party', (m) => {
      this.party = { leader: m.leader ?? null, members: m.members || [] };
      this.renderParty();
    });
    net.on('trade_open', (m) => {
      this.trade = { with: m.with, name: m.name, mine: { items: [], gold: 0, ready: false }, theirs: { items: [], gold: 0, ready: false } };
      $('#trade-gold').value = 0;
      ui.openWin('trade');
      ui.openWin('inventory');
      ui.log(`Обмен с ${m.name}: кликайте по вещам в сумке, чтобы предложить их.`, 'sys');
      this.renderTrade();
    });
    net.on('trade_state', (m) => {
      if (!this.trade) return;
      this.trade.mine.ready = m.mine.ready;
      this.trade.theirs = m.theirs;
      this.renderTrade();
    });
    net.on('trade_done', (m) => {
      const tr = this.trade;
      if (!tr) return;
      this.trade = null;
      const p = this.me;
      p.gold = Math.max(0, p.gold - m.gold) + m.rgold;
      for (const it of m.receive) p.addItem(it);
      ui.close('trade');
      const got = m.receive.map((i) => `<span style="color:${RARITIES[i.rarity]?.color ?? '#ccc'}">[${esc(i.name)}${i.count > 1 ? ' ×' + i.count : ''}]</span>`);
      if (m.rgold) got.push(`${m.rgold} 🪙`);
      ui.log(`Обмен с ${esc(m.name)} завершён. Получено: ${got.join(', ') || 'ничего'}`, 'loot', true);
      ui.refresh();
      this.g.save();
    });
    net.on('trade_closed', (m) => {
      if (!this.trade) return;
      this.returnOffered();
      this.trade = null;
      ui.close('trade');
      ui.log(m.msg || 'Обмен отменён', 'sys');
      ui.refresh();
    });
    net.on('duel', (m) => {
      this.duel = { with: m.with, name: m.name, active: false };
      ui.banner('Дуэль!', `Противник: ${m.name}. Бой начнётся через 3 секунды…`, 'quest');
      const r = this.g.remotes.get(m.with);
      if (r) this.me.setTarget(r);
    });
    net.on('duel_go', () => {
      if (!this.duel) return;
      this.duel.active = true;
      ui.banner('В бой!', this.duel.name, 'quest');
    });
    net.on('duel_end', () => {
      const r = this.duel && this.g.remotes.get(this.duel.with);
      this.duel = null;
      if (r && this.me.target === r) this.me.setTarget(null);
    });
    net.on('pvp_hurt', (m) => {
      const duel = !!m.duel && this.duel?.active;
      const dmg = this.me.takeDamage(m.dmg, { from: m.from, duel, pierce: !!m.fx?.pierce, dot: !!m.dot });
      if (m.fx) this.me.applyFx(m.fx, m.from);
      net.send({ t: 'pvp_took', to: m.from, dmg, crit: m.crit });
    });
    net.on('pvp_dmg', (m) => {
      const r = this.g.remotes.get(m.to);
      if (r) this.g.fx.floatText(new THREE.Vector3(r.pos.x, r.pos.y + 2.2, r.pos.z), m.crit ? `${m.dmg}!` : String(m.dmg), m.crit ? 'crit' : 'dmg');
    });
  }

  // ------------------------------------------------ запросы
  addRequest(kind, from, name) {
    const row = el('div', null, 'req');
    row.innerHTML = `<div class="req-t">${REQ_TEXT[kind](esc(name))}</div><div class="req-b"><button class="btn gold">Принять</button><button class="btn">Отказ</button></div>`;
    const done = (ok) => {
      if (!row.isConnected) return;
      row.remove();
      this.net.send({ t: 'req_answer', kind, from, ok });
    };
    const [yes, no] = row.querySelectorAll('button');
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    this.reqEl.appendChild(row);
    setTimeout(() => row.remove(), 30000);
  }

  // ------------------------------------------------ меню игрока
  openMenu(r, x, y) {
    const leader = this.party.leader === this.g.myId;
    const items = [];
    if (this.canAttack(r)) items.push(['⚔ Атаковать', () => this.me.setTarget(r)]);
    if (!this.inParty(r.id)) items.push(['👥 Пригласить в группу', () => this.request('party', r)]);
    else if (leader) items.push(['🚫 Исключить из группы', () => this.net.send({ t: 'party_kick', id: r.id })]);
    items.push(['🤝 Обмен', () => this.request('trade', r)]);
    if (!this.duel) items.push(['🗡 Вызвать на дуэль', () => this.request('duel', r)]);
    const cls = CLASSES[r.cls.id];
    this.menuEl.innerHTML = `<div class="pm-h">${cls.icon} ${esc(r.name)} <small>${r.level} ур.</small></div>`;
    for (const [label, fn] of items) {
      const b = el('button', null, 'pm-b');
      b.textContent = label;
      b.onclick = () => { this.hideMenu(); fn(); };
      this.menuEl.appendChild(b);
    }
    this.menuEl.classList.remove('hidden');
    const w = this.menuEl.offsetWidth, h = this.menuEl.offsetHeight;
    this.menuEl.style.left = Math.min(x + 8, innerWidth - w - 8) + 'px';
    this.menuEl.style.top = Math.min(y + 8, innerHeight - h - 8) + 'px';
  }

  hideMenu() {
    this.menuEl.classList.add('hidden');
  }

  // ------------------------------------------------ группа
  renderParty() {
    const others = this.party.members.filter((m) => m.id !== this.g.myId);
    if (!others.length) { this.partyEl.innerHTML = ''; return; }
    this.partyEl.innerHTML = others.map((m) => `
      <div class="pmem" data-id="${m.id}">
        <div class="pmem-ico">${CLASSES[m.classId]?.icon ?? '?'}</div>
        <div class="pmem-main">
          <div class="pmem-name">${m.id === this.party.leader ? '👑 ' : ''}${esc(m.name)} <small>${m.level}</small></div>
          <div class="bar hp small"><div class="fill"></div></div>
        </div>
      </div>`).join('') + '<button class="btn small" id="party-leave">Покинуть группу</button>';
    $('#party-leave').onclick = () => this.net.send({ t: 'party_leave' });
    this.partyEl.querySelectorAll('.pmem').forEach((row) => {
      row.onclick = () => { const r = this.g.remotes.get(+row.dataset.id); if (r && this.canAttack(r)) this.me.setTarget(r); };
    });
  }

  update(dt) {
    if ((this.acc += dt) < 0.15) return;
    this.acc = 0;
    for (const row of this.partyEl.querySelectorAll('.pmem')) {
      const r = this.g.remotes.get(+row.dataset.id);
      const fill = row.querySelector('.fill');
      fill.style.width = r && r.maxHp ? Math.max(0, r.hp / r.maxHp) * 100 + '%' : '0%';
      const far = !r || r.pos.distanceTo(this.me.pos) > 80;
      row.classList.toggle('far', far);
      row.classList.toggle('dead', !!r?.dead);
    }
  }

  // ------------------------------------------------ обмен
  offerItem(idx) {
    const tr = this.trade, p = this.me;
    if (!tr) return;
    if (tr.mine.items.length >= 6) return this.g.ui.error('Можно предложить не больше 6 вещей');
    const it = p.inventory[idx];
    if (!it) return;
    p.inventory[idx] = null;
    tr.mine.items.push(it);
    this.sendOffer();
    this.g.ui.refresh();
  }

  removeOffer(i) {
    const tr = this.trade;
    if (!tr) return;
    const [it] = tr.mine.items.splice(i, 1);
    if (it) this.me.addItem(it);
    this.sendOffer();
    this.g.ui.refresh();
  }

  sendOffer() {
    const tr = this.trade;
    if (!tr) return;
    const input = $('#trade-gold');
    const gold = Math.max(0, Math.min(this.me.gold, Math.floor(Number(input.value) || 0)));
    input.value = gold;
    tr.mine.gold = gold;
    tr.mine.ready = false;
    this.net.send({ t: 'trade_offer', items: tr.mine.items, gold });
    this.renderTrade();
  }

  toggleReady() {
    const tr = this.trade;
    if (!tr) return;
    const ready = !tr.mine.ready;
    if (ready) {
      const free = this.me.inventory.filter((x) => !x).length;
      if (free < tr.theirs.items.length) return this.g.ui.error('Недостаточно места в сумке для обмена');
    }
    this.net.send({ t: 'trade_ready', ready });
  }

  cancelTrade() {
    if (this.trade) this.net.send({ t: 'trade_cancel' });
  }

  returnOffered() {
    if (!this.trade) return;
    for (const it of this.trade.mine.items) this.me.addItem(it);
    this.trade.mine.items = [];
  }

  // вещи, выложенные на обмен, возвращаются в сохранение
  offeredItems() {
    return this.trade ? this.trade.mine.items : [];
  }

  renderTrade() {
    const tr = this.trade, ui = this.g.ui;
    if (!tr) return;
    $('#trade-name').textContent = tr.name;
    const grid = (box, items, mine) => {
      box.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const it = items[i];
        const s = el('div', null, 'slot');
        if (it) {
          s.classList.add('filled');
          s.style.borderColor = RARITIES[it.rarity]?.color ?? '#555';
          s.innerHTML = itemIcon(it) + (it.count > 1 ? `<span class="cnt">${it.count}</span>` : '');
          ui.bindTip(s, () => ui.itemTooltip(it, mine ? 'trade-mine' : 'trade'));
          if (mine) s.onclick = () => { ui.hideTooltip(); this.removeOffer(i); };
        }
        box.appendChild(s);
      }
    };
    grid($('#trade-mine'), tr.mine.items, true);
    grid($('#trade-theirs'), tr.theirs.items, false);
    $('#trade-their-gold').textContent = tr.theirs.gold;
    $('#trade-mine-ready').classList.toggle('on', tr.mine.ready);
    $('#trade-their-ready').classList.toggle('on', tr.theirs.ready);
    $('#trade-ready-btn').textContent = tr.mine.ready ? 'Отменить готовность' : 'Готов';
  }
}
