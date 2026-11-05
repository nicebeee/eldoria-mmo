// Взаимодействие игроков: группы, обмен вещами, дуэли и PvP на арене
import { inArena } from '../src/terrain.js';
import { sanitizeFx } from '../src/data.js';

const REQ_TTL = 30000;
const PARTY_MAX = 5;
const KINDS = ['party', 'trade', 'duel'];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export class Social {
  constructor(world) {
    this.w = world;
    this.parties = new Map();
    this.nextParty = 1;
    this.trades = new Set();
    this.duels = new Set();
  }

  get(id) { return this.w.players.get(id); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  sys(p, msg) { p?.send({ t: 'sys', msg }); }

  handle(p, m) {
    switch (m.t) {
      case 'req': return this.request(p, m.kind, this.get(m.to));
      case 'req_answer': return this.answer(p, m.kind, this.get(m.from), !!m.ok);
      case 'party_leave': return this.leaveParty(p);
      case 'party_kick': {
        const party = this.partyOf(p), target = this.get(m.id);
        if (party && party.leader === p.id && target && target.partyId === party.id && target !== p) {
          this.sys(target, 'Вас исключили из группы');
          this.leaveParty(target);
        }
        return;
      }
      case 'pchat': {
        const msg = String(m.msg || '').slice(0, 120).trim();
        const party = this.partyOf(p);
        if (!party) return this.sys(p, 'Вы не в группе');
        if (msg) for (const mate of this.members(party)) mate.send({ t: 'chat', from: p.name, msg, party: 1 });
        return;
      }
      case 'trade_offer': return this.offer(p, m);
      case 'trade_ready': return this.ready(p, m);
      case 'trade_cancel': return this.closeTrade(p.trade, `${p.name} отменил обмен`);
      case 'pvp_hit': return this.pvpHit(p, m);
      case 'pvp_took': return this.get(m.to)?.send({ t: 'pvp_dmg', to: p.id, dmg: num(m.dmg), crit: m.crit ? 1 : 0 });
      case 'pvp_death': {
        const k = this.get(m.by);
        if (k && inArena(p.x, p.z)) this.w.broadcast({ t: 'sys', msg: `⚔ ${k.name} одолел ${p.name} на арене!` });
        return;
      }
      case 'duel_lost': return this.duelLost(p);
    }
  }

  // ------------------------------------------------ запросы
  request(p, kind, to) {
    if (!KINDS.includes(kind)) return;
    if (!to || to === p) return this.sys(p, 'Игрок не найден');
    if (kind === 'party') {
      const party = this.partyOf(p);
      if (party && party.leader !== p.id) return this.sys(p, 'Приглашать может только лидер группы');
      if (party && party.members.length >= PARTY_MAX) return this.sys(p, 'Группа заполнена (максимум 5)');
      if (to.partyId && to.partyId === p.partyId) return this.sys(p, `${to.name} уже в вашей группе`);
      if (to.partyId) return this.sys(p, `${to.name} уже состоит в другой группе`);
    }
    if (kind === 'trade') {
      if (p.trade) return this.sys(p, 'Вы уже обмениваетесь');
      if (to.trade) return this.sys(p, `${to.name} сейчас занят обменом`);
      if (this.dist(p, to) > 10) return this.sys(p, 'Подойдите ближе для обмена (до 10 м)');
    }
    if (kind === 'duel') {
      if (p.duel) return this.sys(p, 'Вы уже участвуете в дуэли');
      if (to.duel) return this.sys(p, `${to.name} уже сражается на дуэли`);
      if (this.dist(p, to) > 30) return this.sys(p, 'Слишком далеко для вызова на дуэль');
      if (p.dead || to.dead) return;
    }
    to.reqs ??= new Map();
    to.reqs.set(`${kind}:${p.id}`, Date.now() + REQ_TTL);
    to.send({ t: 'req', kind, from: p.id, name: p.name });
    this.sys(p, `Запрос отправлен игроку ${to.name}`);
  }

  answer(p, kind, from, ok) {
    const key = `${kind}:${from?.id}`;
    if (!from || !p.reqs?.has(key) || p.reqs.get(key) < Date.now()) return this.sys(p, 'Запрос устарел');
    p.reqs.delete(key);
    if (!ok) return this.sys(from, `${p.name} отклонил ваш запрос`);
    if (kind === 'party') this.joinParty(from, p);
    if (kind === 'trade') this.openTrade(from, p);
    if (kind === 'duel') this.startDuel(from, p);
  }

  // ------------------------------------------------ группы
  partyOf(p) { return p?.partyId ? this.parties.get(p.partyId) : null; }
  members(party) { return party.members.map((id) => this.get(id)).filter(Boolean); }

  // все, кто получает награду вместе с игроком: он сам и его группа
  mates(p) {
    const party = this.partyOf(p);
    return party ? this.members(party) : [p];
  }

  joinParty(leader, p) {
    if (p.partyId) this.leaveParty(p);
    let party = this.partyOf(leader);
    if (!party) {
      party = { id: this.nextParty++, leader: leader.id, members: [leader.id] };
      this.parties.set(party.id, party);
      leader.partyId = party.id;
    }
    if (party.members.length >= PARTY_MAX) return this.sys(p, 'Группа уже заполнена');
    party.members.push(p.id);
    p.partyId = party.id;
    for (const m of this.members(party)) this.sys(m, `${p.name} вступает в группу`);
    this.syncParty(party);
  }

  leaveParty(p) {
    const party = this.partyOf(p);
    if (!party) return;
    party.members = party.members.filter((id) => id !== p.id);
    p.partyId = null;
    p.send({ t: 'party', members: [] });
    this.sys(p, 'Вы покинули группу');
    if (party.members.length <= 1) {
      for (const m of this.members(party)) {
        m.partyId = null;
        m.send({ t: 'party', members: [] });
        this.sys(m, 'Группа распущена');
      }
      this.parties.delete(party.id);
      return;
    }
    if (party.leader === p.id) party.leader = party.members[0];
    for (const m of this.members(party)) this.sys(m, `${p.name} покидает группу`);
    this.syncParty(party);
  }

  syncParty(party) {
    const list = this.members(party).map((m) => ({ id: m.id, name: m.name, classId: m.classId, level: m.level }));
    for (const m of this.members(party)) m.send({ t: 'party', leader: party.leader, members: list });
  }

  // ------------------------------------------------ обмен
  openTrade(a, b) {
    if (a.trade || b.trade) return this.sys(a, 'Обмен невозможен: игрок занят');
    if (this.dist(a, b) > 12) return this.sys(a, 'Слишком далеко для обмена');
    const empty = () => ({ items: [], gold: 0, ready: false });
    const tr = { a: a.id, b: b.id, o: { [a.id]: empty(), [b.id]: empty() } };
    a.trade = b.trade = tr;
    this.trades.add(tr);
    a.send({ t: 'trade_open', with: b.id, name: b.name });
    b.send({ t: 'trade_open', with: a.id, name: a.name });
  }

  other(tr, id) { return tr.a === id ? tr.b : tr.a; }

  sendTrade(tr) {
    for (const id of [tr.a, tr.b]) this.get(id)?.send({ t: 'trade_state', mine: tr.o[id], theirs: tr.o[this.other(tr, id)] });
  }

  offer(p, m) {
    const tr = p.trade;
    if (!tr) return;
    const items = (Array.isArray(m.items) ? m.items : []).filter((i) => i && typeof i === 'object' && i.id).slice(0, 6);
    if (JSON.stringify(items).length > 20000) return;
    tr.o[p.id] = { items, gold: Math.max(0, Math.floor(num(m.gold))), ready: false };
    tr.o[this.other(tr, p.id)].ready = false;
    this.sendTrade(tr);
  }

  ready(p, m) {
    const tr = p.trade;
    if (!tr) return;
    tr.o[p.id].ready = !!m.ready;
    if (tr.o[tr.a].ready && tr.o[tr.b].ready) return this.completeTrade(tr);
    this.sendTrade(tr);
  }

  completeTrade(tr) {
    const A = this.get(tr.a), B = this.get(tr.b);
    for (const [x, y] of [[A, B], [B, A]]) {
      x.trade = null;
      x.send({ t: 'trade_done', give: tr.o[x.id].items.map((i) => i.id), gold: tr.o[x.id].gold, receive: tr.o[y.id].items, rgold: tr.o[y.id].gold, name: y.name });
    }
    this.trades.delete(tr);
  }

  closeTrade(tr, msg) {
    if (!tr || !this.trades.has(tr)) return;
    for (const id of [tr.a, tr.b]) {
      const p = this.get(id);
      if (p) { p.trade = null; p.send({ t: 'trade_closed', msg }); }
    }
    this.trades.delete(tr);
  }

  // ------------------------------------------------ дуэли и PvP
  startDuel(a, b) {
    const d = { a: a.id, b: b.id, startAt: Date.now() + 3000, active: false };
    a.duel = b.duel = d;
    this.duels.add(d);
    a.send({ t: 'duel', with: b.id, name: b.name });
    b.send({ t: 'duel', with: a.id, name: a.name });
    this.w.broadcast({ t: 'sys', msg: `⚔ ${a.name} и ${b.name} начинают дуэль!` });
  }

  endDuel(d, msg) {
    if (!this.duels.has(d)) return;
    this.duels.delete(d);
    for (const id of [d.a, d.b]) {
      const p = this.get(id);
      if (p) { p.duel = null; p.send({ t: 'duel_end' }); }
    }
    if (msg) this.w.broadcast({ t: 'sys', msg });
  }

  duelLost(p) {
    const d = p.duel;
    if (!d || !d.active) return;
    const winner = this.get(d.a === p.id ? d.b : d.a);
    this.endDuel(d, `🏆 ${winner?.name ?? '?'} побеждает ${p.name} в дуэли!`);
  }

  canHit(a, b) {
    if (a.duel && a.duel === b.duel && a.duel.active) return true;
    return inArena(a.x, a.z) && inArena(b.x, b.z);
  }

  pvpHit(p, m) {
    const to = this.get(m.to);
    if (!to || to.dead || p.dead || !this.canHit(p, to)) return;
    const duel = p.duel && p.duel === to.duel ? 1 : 0;
    to.send({ t: 'pvp_hurt', from: p.id, dmg: Math.min(5000, Math.max(0, num(m.dmg))), crit: m.crit ? 1 : 0, duel, fx: sanitizeFx(m.fx), dot: m.dot ? 1 : 0 });
  }

  onLeave(p) {
    this.leaveParty(p);
    this.closeTrade(p.trade, `${p.name} вышел из игры — обмен отменён`);
    if (p.duel) this.endDuel(p.duel, `Дуэль прервана: ${p.name} вышел из игры`);
  }

  tick() {
    const now = Date.now();
    for (const d of this.duels) {
      const A = this.get(d.a), B = this.get(d.b);
      if (!A || !B) { this.endDuel(d); continue; }
      if (!d.active && now >= d.startAt) {
        d.active = true;
        A.send({ t: 'duel_go' });
        B.send({ t: 'duel_go' });
      }
      if (this.dist(A, B) > 45) this.endDuel(d, `Дуэль ${A.name} и ${B.name} прервана: бойцы разошлись`);
    }
    for (const tr of this.trades) {
      const A = this.get(tr.a), B = this.get(tr.b);
      if (!A || !B || this.dist(A, B) > 15) this.closeTrade(tr, 'Обмен прерван: игроки слишком далеко');
    }
  }
}
