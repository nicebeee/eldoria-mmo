import {
  CLASSES, SLOTS, SLOT_NAMES, STAT_KEYS, STAT_NAMES, STAT_DESC, RARITIES, WEAPON_NAMES, WEAPON_CLASS,
  QUESTS, NPCS, MOBS, SPAWN_ZONES, SHOP_POTIONS, xpForLevel, generateItem, makePotion, MAX_LEVEL,
} from './data.js';
import { itemIcon, SLOT_PLACEHOLDER } from './icons.js';
import { pick } from './utils.js';

const $ = (s) => document.querySelector(s);
const TARGET_NAMES = { wolf: 'Серые волки', goblin: 'Гоблины', skeleton: 'Скелеты', orc: 'Орки', boss: 'Гром-Вожак', herb: 'Лунник' };

export class UI {
  constructor(game) {
    this.g = game;
    this.acc = 0;
    this.mmAcc = 0;
    this.shopNpc = null;
    this.shopItems = [];
    this.shopLevel = 0;
    this.dialogNpc = null;
    this.tooltip = $('#tooltip');
    this.mm = $('#minimap');
    this.mmCtx = this.mm.getContext('2d');

    document.querySelectorAll('.window').forEach((w) => {
      w.querySelector('.close').onclick = () => this.close(w.dataset.win);
      this.makeDraggable(w);
    });
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => this.toggle(b.dataset.open)));
    $('#btn-exit').onclick = () => { game.save(); location.reload(); };
    $('#respawn-btn').onclick = () => game.player.respawn();

    const chat = $('#chat-input');
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const msg = chat.value.trim();
        chat.value = '';
        chat.blur();
        if (msg) this.chatCommand(msg);
      } else if (e.code === 'Escape') chat.blur();
    });

    const p = game.player;
    $('#pf-portrait').textContent = p.cls.icon;
    $('#pf-name').textContent = p.name;
    this.buildActionBar();
    this.refresh();
  }

  // ------------------------------------------------ общее
  isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  focusChat() {
    $('#chat-input').focus();
  }

  chatCommand(msg) {
    if (msg === '/help') {
      this.log('Управление: WASD — бег, Пробел — прыжок, зажатая мышь — поворот камеры, колесо — зум. ЛКМ по врагу или Tab — выбрать цель (автоатака). 1-3 — умения, 4 — зелье здоровья, 5 — зелье маны. E — говорить/собирать. I — сумка, C — персонаж, L — задания, Esc — закрыть/снять цель. Shift+ЛКМ по предмету — выбросить. /who — кто в игре. Enter — чат со всеми игроками.', 'sys');
    } else if (msg === '/where') {
      const p = this.g.player.pos;
      this.log(`Координаты: ${p.x.toFixed(0)}, ${p.z.toFixed(0)} — ${this.g.zone}`, 'sys');
    } else if (msg === '/who') {
      const names = [this.g.player.name, ...[...this.g.remotes.values()].map((r) => r.name)];
      this.log(`Онлайн (${names.length}): ${names.join(', ')}`, 'sys');
    } else {
      this.g.net.send({ t: 'chat', msg });
    }
  }

  log(msg, type = 'sys', html = false) {
    const box = $('#chat-log');
    const line = document.createElement('div');
    line.className = 'ln ' + type;
    if (html) line.innerHTML = msg;
    else line.textContent = msg;
    box.appendChild(line);
    while (box.children.length > 80) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  error(msg) {
    const el = $('#error-msg');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  banner(title, sub = '', kind = '') {
    const el = $('#banner');
    el.className = kind;
    el.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void el.offsetWidth;
    el.classList.add('show');
  }

  disconnected(msg) {
    $('#disconnect-msg').textContent = msg;
    $('#disconnect-screen').classList.remove('hidden');
  }

  showDeath(show) {
    $('#death-screen').classList.toggle('hidden', !show);
  }

  // ------------------------------------------------ окна
  toggle(name) {
    if (this.isOpenWin(name)) this.close(name);
    else this.openWin(name);
  }

  isOpenWin(name) {
    return !$(`#win-${name}`).classList.contains('hidden');
  }

  openWin(name) {
    const w = $(`#win-${name}`);
    w.classList.remove('hidden');
    w.style.zIndex = String(++UI.z);
    this.refresh();
  }

  close(name) {
    $(`#win-${name}`).classList.add('hidden');
    if (name === 'shop') this.shopNpc = null;
    if (name === 'dialog') this.dialogNpc = null;
    this.hideTooltip();
  }

  closeAll() {
    document.querySelectorAll('.window').forEach((w) => this.close(w.dataset.win));
  }

  anyOpen() {
    return [...document.querySelectorAll('.window')].some((w) => !w.classList.contains('hidden'));
  }

  makeDraggable(w) {
    const head = w.querySelector('.win-head');
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.close')) return;
      const r = w.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      w.style.zIndex = String(++UI.z);
      const move = (ev) => {
        w.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)) + 'px';
        w.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px';
        w.style.right = 'auto';
        w.style.transform = 'none';
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  }

  refresh() {
    this.hideTooltip();
    this.renderInventory();
    this.renderCharacter();
    this.renderQuests();
    this.renderTracker();
    if (this.shopNpc) this.renderShop();
    $('#btn-char').classList.toggle('alert', this.g.player.statPoints > 0);
  }

  // ------------------------------------------------ подсказки
  showTooltip(html, e) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    this.moveTooltip(e);
  }

  moveTooltip(e) {
    const t = this.tooltip;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > innerHeight - 8) y = innerHeight - h - 8;
    t.style.left = x + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }

  hideTooltip() {
    this.tooltip.classList.add('hidden');
  }

  bindTip(el, fn) {
    el.addEventListener('mouseenter', (e) => { const h = fn(); if (h) this.showTooltip(h, e); });
    el.addEventListener('mousemove', (e) => this.moveTooltip(e));
    el.addEventListener('mouseleave', () => this.hideTooltip());
  }

  itemTooltip(item, where = 'inv') {
    const p = this.g.player;
    if (item.type === 'potion') {
      return `<div class="tt-name">${item.name}</div><div class="tt-sub">Расходуемое • ${item.count} шт.</div>
        <div>${item.desc}</div><div class="tt-hint">ЛКМ — выпить (клавиша ${item.potion === 'hp' ? 4 : 5})${this.shopNpc ? '<br>ПКМ — продать за 3 🪙' : ''}</div>`;
    }
    const R = RARITIES[item.rarity];
    let h = `<div class="tt-name" style="color:${R.color}">${item.name}</div>
      <div class="tt-sub">${R.name} • ${SLOT_NAMES[item.slot]}${item.weaponType ? ` (${WEAPON_NAMES[item.weaponType]})` : ''} • ур. ${item.level}</div>`;
    if (item.slot === 'weapon') {
      h += `<div class="tt-main">Урон: ${item.dmg}</div>`;
      if (item.weaponType !== p.cls.weapon) h += `<div class="tt-bad">Только для класса: ${CLASSES[WEAPON_CLASS[item.weaponType]].name}</div>`;
    } else h += `<div class="tt-main">Броня: ${item.armor}</div>`;
    for (const k of STAT_KEYS) if (item.stats[k]) h += `<div class="tt-stat">+${item.stats[k]} ${STAT_NAMES[k]}</div>`;

    const eq = p.equipment[item.slot];
    if (where !== 'equip' && eq && eq !== item) {
      const rows = [];
      const mainKey = item.slot === 'weapon' ? 'dmg' : 'armor';
      const dm = (item[mainKey] || 0) - (eq[mainKey] || 0);
      if (dm) rows.push(diffRow(dm, mainKey === 'dmg' ? 'Урон' : 'Броня'));
      for (const k of STAT_KEYS) {
        const dv = (item.stats[k] || 0) - (eq.stats[k] || 0);
        if (dv) rows.push(diffRow(dv, STAT_NAMES[k]));
      }
      h += `<div class="tt-cmp"><div class="tt-cmp-h">По сравнению с надетым:</div>${rows.length ? rows.join('') : '<div class="muted">без изменений</div>'}</div>`;
    }
    h += `<div class="tt-val">Цена продажи: ${item.value} 🪙</div>`;
    if (where === 'inv') h += `<div class="tt-hint">ЛКМ — надеть${this.shopNpc ? ' • ПКМ — продать' : ''} • Shift+ЛКМ — выбросить</div>`;
    else if (where === 'equip') h += `<div class="tt-hint">ЛКМ — снять</div>`;
    else if (where === 'shop') h += `<div class="tt-hint">ЛКМ — купить</div>`;
    return h;
  }

  // ------------------------------------------------ инвентарь
  renderInventory() {
    const p = this.g.player;
    const grid = $('#inv-grid');
    grid.innerHTML = '';
    p.inventory.forEach((it, i) => {
      const s = document.createElement('div');
      s.className = 'slot';
      if (it) {
        s.classList.add('filled');
        s.innerHTML = itemIcon(it) + (it.count > 1 ? `<span class="cnt">${it.count}</span>` : '');
        s.style.borderColor = RARITIES[it.rarity].color;
        if (it.slot && !p.canEquip(it)) s.classList.add('unusable');
        this.bindTip(s, () => this.itemTooltip(it, 'inv'));
        s.onclick = (e) => {
          this.hideTooltip();
          if (e.shiftKey) {
            p.inventory[i] = null;
            this.log(`Выброшено: ${it.name}`, 'sys');
            this.refresh();
          } else if (it.type === 'potion') p.usePotion(it.potion);
          else p.equip(i);
        };
        s.oncontextmenu = (e) => {
          e.preventDefault();
          this.hideTooltip();
          if (this.shopNpc) this.sell(i);
          else if (it.type === 'potion') p.usePotion(it.potion);
          else p.equip(i);
        };
      }
      grid.appendChild(s);
    });
    $('#inv-gold').textContent = p.gold;
    $('#inv-free').textContent = p.inventory.filter((x) => !x).length;
  }

  // ------------------------------------------------ персонаж
  renderCharacter() {
    const p = this.g.player;
    const s = p.stats, d = p.derived();
    const body = $('#char-body');
    const prim = p.cls.dmgType;
    body.innerHTML = `
      <div class="char-head"><span class="cls-ico">${p.cls.icon}</span>
        <div><div class="char-name">${esc(p.name)}</div><div class="muted">${p.cls.name}, ${p.level} уровень</div></div></div>
      <div class="char-cols">
        <div class="equip-list">
          ${SLOTS.map((slot) => {
            const it = p.equipment[slot];
            return `<div class="eq-row"><div class="slot eq ${it ? 'filled' : ''}" data-slot="${slot}" style="${it ? `border-color:${RARITIES[it.rarity].color}` : ''}">${it ? itemIcon(it) : `<span class="ph">${SLOT_PLACEHOLDER[slot]}</span>`}</div>
              <div class="eq-txt"><div class="eq-label">${SLOT_NAMES[slot]}</div><div class="eq-name" style="color:${it ? RARITIES[it.rarity].color : '#6b6458'}">${it ? it.name : '— пусто —'}</div></div></div>`;
          }).join('')}
        </div>
        <div class="stats">
          <div class="points ${p.statPoints ? 'has' : ''}">Свободные очки: <b>${p.statPoints}</b></div>
          ${STAT_KEYS.map((k) => `<div class="stat-row" data-tip="${k}"><span>${STAT_NAMES[k]}</span><b>${s[k]}</b>
            <button class="plus" data-stat="${k}" ${p.statPoints ? '' : 'disabled'}>+</button></div>`).join('')}
          <div class="sep"></div>
          <div class="drow"><span>Здоровье</span><b class="c-hp">${d.maxHp}</b></div>
          <div class="drow"><span>Мана</span><b class="c-mp">${d.maxMp}</b></div>
          <div class="drow ${prim === 'phys' ? 'prim' : ''}"><span>Физ. урон</span><b>${d.phys}</b></div>
          <div class="drow ${prim === 'magic' ? 'prim' : ''}"><span>Маг. урон</span><b>${d.magic}</b></div>
          <div class="drow"><span>Скорость атаки</span><b>${(1 / d.interval).toFixed(2)}/с</b></div>
          <div class="drow"><span>Броня</span><b>${d.armor} <small>(-${Math.round(d.reduction * 100)}%)</small></b></div>
          <div class="drow"><span>Шанс крита</span><b>${(d.crit * 100).toFixed(1)}%</b></div>
          <div class="drow"><span>Опыт</span><b>${p.level >= MAX_LEVEL ? 'макс.' : `${p.xp} / ${xpForLevel(p.level)}`}</b></div>
        </div>
      </div>`;
    body.querySelectorAll('.slot.eq').forEach((el) => {
      const slot = el.dataset.slot;
      const it = p.equipment[slot];
      if (!it) return;
      this.bindTip(el, () => this.itemTooltip(it, 'equip'));
      el.onclick = () => { this.hideTooltip(); p.unequip(slot); };
    });
    body.querySelectorAll('.plus').forEach((b) => (b.onclick = () => p.addStat(b.dataset.stat)));
    body.querySelectorAll('.stat-row').forEach((el) => this.bindTip(el, () => `<div class="tt-name">${STAT_NAMES[el.dataset.tip]}</div><div>${STAT_DESC[el.dataset.tip]}</div>`));
  }

  // ------------------------------------------------ задания
  questObjective(q, prog) {
    const verb = q.type === 'collect' ? 'Собрать' : 'Убить';
    return `${verb}: ${TARGET_NAMES[q.target]} — ${Math.min(prog, q.count)}/${q.count}`;
  }

  renderQuests() {
    const g = this.g, Q = g.player.quests;
    const body = $('#quests-body');
    const active = Object.keys(Q.active).map((id) => QUESTS.find((q) => q.id === id));
    let h = '';
    if (!active.length) h += '<div class="muted pad">Нет активных заданий. Ищите жителей с <b style="color:#ffd030">!</b> над головой.</div>';
    for (const q of active) {
      const ready = Q.active[q.id] >= q.count;
      const giver = NPCS.find((n) => n.id === q.giver);
      h += `<div class="q-card ${ready ? 'ready' : ''}"><div class="q-title">${q.title} <small>ур. ${q.level}</small></div>
        <div class="q-text">${q.text}</div>
        <div class="q-obj">${ready ? `✔ Вернитесь к: ${giver.name}` : this.questObjective(q, Q.active[q.id])}</div>
        <div class="q-rew">${rewardText(q.reward)}</div></div>`;
    }
    if (Q.done.length) {
      h += `<div class="q-done-h">Выполнено (${Q.done.length})</div>`;
      h += Q.done.map((id) => `<div class="q-done">✔ ${QUESTS.find((q) => q.id === id).title}</div>`).join('');
    }
    body.innerHTML = h;
  }

  renderTracker() {
    const Q = this.g.player.quests;
    const el = $('#quest-tracker');
    const ids = Object.keys(Q.active);
    if (!ids.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="qt-h">Задания</div>' + ids.map((id) => {
      const q = QUESTS.find((q) => q.id === id);
      const ready = Q.active[id] >= q.count;
      const giver = NPCS.find((n) => n.id === q.giver);
      return `<div class="qt-q ${ready ? 'ready' : ''}"><div class="qt-t">${q.title}</div>
        <div class="qt-o">${ready ? `Сдать: ${giver.name}` : `${TARGET_NAMES[q.target]}: ${Q.active[id]}/${q.count}`}</div></div>`;
    }).join('');
  }

  // ------------------------------------------------ диалоги
  openDialog(npc) {
    this.dialogNpc = npc;
    $('#dialog-title').textContent = npc.def.name;
    this.renderDialogMain();
    this.openWin('dialog');
  }

  renderDialogMain() {
    const g = this.g, npc = this.dialogNpc;
    const body = $('#dialog-body');
    let h = `<p class="dlg-greet">${npc.def.greeting}</p><div class="dlg-list">`;
    for (const q of QUESTS.filter((q) => q.giver === npc.def.id)) {
      const st = g.questState(q.id);
      if (st === 'ready') h += `<button class="dlg-opt ready" data-q="${q.id}">❓ ${q.title} <small>(сдать)</small></button>`;
      else if (st === 'available') h += `<button class="dlg-opt avail" data-q="${q.id}">❗ ${q.title}</button>`;
      else if (st === 'active') h += `<button class="dlg-opt" data-q="${q.id}">⏳ ${q.title} <small>(в процессе)</small></button>`;
      else if (st === 'lowlevel') h += `<div class="dlg-opt dis">🔒 ${q.title} <small>(с ${q.level} уровня)</small></div>`;
    }
    if (npc.def.shop) h += `<button class="dlg-opt shop" data-shop="1">🛒 Показать товары</button>`;
    h += `<button class="dlg-opt bye" data-bye="1">До встречи</button></div>`;
    body.innerHTML = h;
    body.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => this.renderQuestDetail(b.dataset.q)));
    const sb = body.querySelector('[data-shop]');
    if (sb) sb.onclick = () => { this.close('dialog'); this.openShop(npc); };
    body.querySelector('[data-bye]').onclick = () => this.close('dialog');
  }

  renderQuestDetail(id) {
    const g = this.g;
    const q = QUESTS.find((q) => q.id === id);
    const st = g.questState(id);
    const prog = g.player.quests.active[id] ?? 0;
    const body = $('#dialog-body');
    body.innerHTML = `<div class="q-title big">${q.title}</div>
      <p class="dlg-greet">${st === 'ready' ? q.doneText : q.text}</p>
      <div class="q-obj">${this.questObjective(q, prog)}</div>
      <div class="q-rew"><b>Награда:</b> ${rewardText(q.reward)}</div>
      <div class="dlg-btns">
        ${st === 'available' ? '<button class="btn gold" data-act="accept">Принять</button>' : ''}
        ${st === 'ready' ? '<button class="btn gold" data-act="complete">Завершить</button>' : ''}
        <button class="btn" data-act="back">Назад</button>
      </div>`;
    body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      if (b.dataset.act === 'accept') g.acceptQuest(id);
      if (b.dataset.act === 'complete') g.completeQuest(id);
      if (this.dialogNpc) this.renderDialogMain();
    }));
  }

  // ------------------------------------------------ магазин
  openShop(npc) {
    const p = this.g.player;
    this.shopNpc = npc;
    if (!this.shopItems.length || this.shopLevel !== p.level) {
      this.shopLevel = p.level;
      this.shopItems = [];
      for (let i = 0; i < 5; i++) {
        const it = generateItem(pick(['head', 'chest', 'hands', 'feet', 'weapon']), p.level, {
          rarity: Math.random() < 0.3 ? 'uncommon' : 'common', weaponType: p.cls.weapon,
        });
        this.shopItems.push({ item: it, price: it.value * 4 });
      }
    }
    this.openWin('shop');
    this.openWin('inventory');
  }

  renderShop() {
    const p = this.g.player;
    const list = $('#shop-list');
    list.innerHTML = '';
    const rows = [
      ...SHOP_POTIONS.map((sp) => ({ item: makePotion(sp.potion, 1), price: sp.price, potion: true })),
      ...this.shopItems,
    ];
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = 'shop-row' + (p.gold < r.price ? ' poor' : '');
      el.innerHTML = `<div class="slot filled" style="border-color:${RARITIES[r.item.rarity].color}">${itemIcon(r.item)}</div>
        <div class="sr-name" style="color:${RARITIES[r.item.rarity].color}">${r.item.name}</div><div class="sr-price">${r.price} 🪙</div>`;
      this.bindTip(el, () => this.itemTooltip(r.item, 'shop'));
      el.onclick = () => this.buy(r);
      list.appendChild(el);
    }
    $('#shop-gold').textContent = p.gold;
  }

  buy(r) {
    const p = this.g.player;
    if (p.gold < r.price) return this.error('Недостаточно золота');
    const item = r.potion ? makePotion(r.item.potion, 1) : r.item;
    if (!p.addItem(item)) return;
    p.gold -= r.price;
    if (!r.potion) this.shopItems.splice(this.shopItems.indexOf(r), 1);
    this.log(`Куплено: ${item.name} за ${r.price} золота`, 'loot');
    this.hideTooltip();
    this.refresh();
  }

  sell(i) {
    const p = this.g.player;
    const it = p.inventory[i];
    if (!it) return;
    if (it.type === 'potion') {
      p.gold += 3;
      if (--it.count <= 0) p.inventory[i] = null;
    } else {
      p.gold += it.value;
      p.inventory[i] = null;
      this.log(`Продано: ${it.name} за ${it.value} золота`, 'loot');
    }
    this.refresh();
  }

  // ------------------------------------------------ панель умений
  buildActionBar() {
    const p = this.g.player;
    const bar = $('#action-bar');
    bar.innerHTML = '';
    this.abSlots = [];
    p.cls.skills.forEach((sk, i) => {
      const el = this.abSlot(sk.icon, String(i + 1));
      el.onclick = () => p.useSkill(i);
      this.bindTip(el, () => `<div class="tt-name">${sk.name}</div><div class="tt-sub">Мана: ${sk.mana} • Перезарядка: ${sk.cd} сек</div><div>${sk.desc}</div>`);
      this.abSlots.push({ el, sk });
    });
    for (const [type, key] of [['hp', '4'], ['mp', '5']]) {
      const el = this.abSlot(itemIcon({ type: 'potion', potion: type }), key, true);
      el.onclick = () => p.usePotion(type);
      this.bindTip(el, () => `<div class="tt-name">${type === 'hp' ? 'Зелье здоровья' : 'Зелье маны'}</div><div>Восстанавливает 40% ${type === 'hp' ? 'здоровья' : 'маны'}. В сумке: ${p.countPotion(type)}</div>`);
      this.abSlots.push({ el, potion: type });
    }
  }

  abSlot(icon, key, html = false) {
    const el = document.createElement('div');
    el.className = 'ab-slot';
    el.innerHTML = `<div class="ab-icon">${icon}</div><div class="ab-cd"></div><div class="ab-cdt"></div><div class="ab-key">${key}</div><div class="ab-cnt"></div>`;
    $('#action-bar').appendChild(el);
    return el;
  }

  // ------------------------------------------------ цель
  refreshTarget() {
    const t = this.g.player.target;
    const tf = $('#target-frame');
    if (!t || t.dead) { tf.classList.add('hidden'); return; }
    tf.classList.remove('hidden');
    tf.classList.toggle('boss', !!t.def?.boss);
    $('#tf-name').textContent = t.def.name;
    $('#tf-level').textContent = t.level;
  }

  // ------------------------------------------------ каждый кадр
  update(dt) {
    this.mmAcc += dt;
    if (this.mmAcc > 0.05) { this.mmAcc = 0; this.drawMinimap(); }
    this.acc += dt;
    if (this.acc < 0.066) return;
    this.acc = 0;
    const g = this.g, p = g.player, d = p.derived();

    setBar('#hp-bar', p.hp / d.maxHp, `${Math.ceil(p.hp)} / ${d.maxHp}`);
    setBar('#mp-bar', p.mp / d.maxMp, `${Math.floor(p.mp)} / ${d.maxMp}`);
    const xpNeed = xpForLevel(p.level);
    $('#xp-fill').style.width = (p.level >= MAX_LEVEL ? 100 : (p.xp / xpNeed) * 100) + '%';
    $('#xp-text').textContent = p.level >= MAX_LEVEL ? 'Максимальный уровень' : `Опыт: ${p.xp} / ${xpNeed}`;
    $('#pf-level').textContent = p.level;
    $('#pf-combat').classList.toggle('on', p.combatTimer > 0);

    const t = p.target;
    if (t && !t.dead) {
      if ($('#target-frame').classList.contains('hidden')) this.refreshTarget();
      setBar('#tf-hp', t.hp / t.maxHp, `${Math.ceil(t.hp)} / ${t.maxHp}`);
      const dist = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      $('#tf-dist').textContent = `${dist.toFixed(0)} м${dist > p.cls.range + t.radius ? ' — далеко' : ''}`;
    } else if (!$('#target-frame').classList.contains('hidden')) this.refreshTarget();

    for (const s of this.abSlots) {
      const cd = s.el.querySelector('.ab-cd'), cdt = s.el.querySelector('.ab-cdt');
      let rem = 0, total = 1;
      if (s.sk) {
        rem = p.cooldowns[s.sk.id] || 0;
        total = s.sk.cd;
        s.el.classList.toggle('nomana', p.mp < s.sk.mana);
      } else {
        rem = Math.max(0, p.potionCd);
        total = 5;
        const n = p.countPotion(s.potion);
        s.el.querySelector('.ab-cnt').textContent = n;
        s.el.classList.toggle('nomana', n === 0);
      }
      cd.style.height = (rem > 0 ? (rem / total) * 100 : 0) + '%';
      cdt.textContent = rem > 0 ? Math.ceil(rem) : '';
    }

    const buffs = [];
    if (p.buffs.rage > 0) buffs.push(`<span class="buff" title="Боевой клич">📯<i>${Math.ceil(p.buffs.rage)}</i></span>`);
    if (p.buffs.haste > 0) buffs.push(`<span class="buff" title="Попутный ветер">💨<i>${Math.ceil(p.buffs.haste)}</i></span>`);
    $('#buffs').innerHTML = buffs.join('');

    const pr = $('#interact-prompt');
    if (g.nearNpc) { pr.innerHTML = `<kbd>E</kbd> Поговорить: ${g.nearNpc.def.name}`; pr.classList.remove('hidden'); }
    else if (g.nearHerb) { pr.innerHTML = '<kbd>E</kbd> Собрать лунник'; pr.classList.remove('hidden'); }
    else pr.classList.add('hidden');

    $('#zone-name').textContent = g.zone;
    $('#coords').textContent = `${p.pos.x.toFixed(0)}, ${p.pos.z.toFixed(0)}`;
    $('#online').textContent = `Онлайн: ${g.remotes.size + 1}`;

    // закрываем диалог/магазин, если игрок отошёл
    for (const [win, npc] of [['dialog', this.dialogNpc], ['shop', this.shopNpc]]) {
      if (npc && Math.hypot(npc.pos.x - p.pos.x, npc.pos.z - p.pos.z) > 7) this.close(win);
    }
  }

  drawMinimap() {
    const g = this.g, ctx = this.mmCtx, W = this.mm.width, R = W / 2;
    const scale = R / 60;
    const p = g.player.pos;
    const tx = (x) => R + (x - p.x) * scale, ty = (z) => R + (z - p.z) * scale;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#34482a';
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(160,130,80,.55)';
    ctx.beginPath(); ctx.arc(tx(0), ty(0), 26 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(170,140,90,.6)';
    ctx.lineWidth = 3;
    for (const z of SPAWN_ZONES) {
      ctx.beginPath(); ctx.moveTo(tx(0), ty(0)); ctx.lineTo(tx(z.center[0]), ty(z.center[1])); ctx.stroke();
    }
    for (const z of SPAWN_ZONES) {
      ctx.fillStyle = z.mob === 'boss' ? 'rgba(255,80,20,.25)' : 'rgba(200,60,40,.16)';
      ctx.beginPath(); ctx.arc(tx(z.center[0]), ty(z.center[1]), Math.max(z.radius, 8) * scale, 0, Math.PI * 2); ctx.fill();
    }
    const herbNeeded = Object.keys(g.player.quests.active).some((id) => QUESTS.find((q) => q.id === id).target === 'herb');
    if (herbNeeded) {
      ctx.fillStyle = '#d080ff';
      for (const h of g.world.herbs) if (h.active) dot(ctx, tx(h.x), ty(h.z), 2.5);
    }
    for (const e of g.enemies) {
      if (e.dead) continue;
      ctx.fillStyle = e.def.boss ? '#ff8a20' : e === g.player.target ? '#ffff60' : '#e03a30';
      dot(ctx, tx(e.pos.x), ty(e.pos.z), e.def.boss ? 5 : 2.5);
    }
    for (const r of g.remotes.values()) {
      ctx.fillStyle = '#5ae0ff';
      dot(ctx, tx(r.pos.x), ty(r.pos.z), 3.5);
    }
    for (const n of g.npcs) {
      ctx.fillStyle = '#ffd860';
      dot(ctx, tx(n.pos.x), ty(n.pos.z), 3);
    }
    ctx.restore();
    // стрелка игрока
    const f = g.player.model.rotation.y;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-f + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // направление взгляда камеры
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-g.cam.yaw);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffe0a0';
    ctx.font = 'bold 12px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('С', R, 13);
  }
}
UI.z = 100;

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function setBar(sel, frac, text) {
  const el = document.querySelector(sel);
  el.querySelector('.fill').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  el.querySelector('.txt').textContent = text;
}

function diffRow(v, label) {
  return `<div class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '▲ +' : '▼ '}${v} ${label}</div>`;
}

function rewardText(r) {
  const parts = [`${r.xp} опыта`, `${r.gold} 🪙`];
  if (r.potions) for (const t in r.potions) parts.push(`${r.potions[t]}× ${t === 'hp' ? 'зелье здоровья' : 'зелье маны'}`);
  if (r.item) parts.push(`<span style="color:${RARITIES[r.item.rarity].color}">${RARITIES[r.item.rarity].name.toLowerCase()} предмет (${SLOT_NAMES[r.item.slot].toLowerCase()})</span>`);
  return parts.join(' • ');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
