import { rand, randInt, pick, clamp, uid } from './utils.js';

export const MAX_LEVEL = 20;
export const INV_SIZE = 30;
export const POINTS_PER_LEVEL = 5;
export const xpForLevel = (l) => Math.round(100 * Math.pow(l, 1.55));

export const STAT_KEYS = ['str', 'agi', 'int', 'vit'];
export const STAT_NAMES = { str: 'Сила', agi: 'Ловкость', int: 'Интеллект', vit: 'Здоровье' };
export const STAT_DESC = {
  str: '+1.5 к физическому урону',
  agi: '+2% к скорости атаки, +0.2% к шансу крита',
  int: '+8 к мане, +1.8 к магическому урону',
  vit: '+12 к максимальному здоровью',
};

export const SLOTS = ['head', 'chest', 'hands', 'feet', 'weapon'];
export const SLOT_NAMES = { head: 'Голова', chest: 'Тело', hands: 'Перчатки', feet: 'Сапоги', weapon: 'Оружие' };
export const WEAPON_NAMES = { sword: 'Меч', staff: 'Посох', bow: 'Лук' };
export const WEAPON_CLASS = { sword: 'warrior', staff: 'mage', bow: 'archer' };

// ---------------------------------------------------------------- классы
export const CLASSES = {
  warrior: {
    id: 'warrior', name: 'Воин', icon: '⚔️',
    desc: 'Мастер ближнего боя. Много здоровья, сокрушительные удары мечом.',
    base: { str: 10, agi: 5, int: 2, vit: 10 },
    dmgType: 'phys', range: 2.6, atkCd: 1.5, weapon: 'sword', attackAnim: 'melee',
    look: { skin: 0xe0ac80, shirt: 0x7a2e24, pants: 0x3a3328, boots: 0x3a2a1c, hair: 0x5a3218, beard: true },
    skills: [
      { id: 'heavy', name: 'Сокрушающий удар', icon: '💥', type: 'strike', mult: 2.2, cd: 5, mana: 10, desc: 'Мощный удар по цели: 220% физического урона.' },
      { id: 'whirl', name: 'Вихрь клинков', icon: '🌀', type: 'whirl', mult: 1.4, radius: 5, cd: 9, mana: 20, desc: 'Круговой удар по всем врагам рядом: 140% урона.' },
      { id: 'rage', name: 'Боевой клич', icon: '📯', type: 'buff', buff: 'rage', duration: 10, cd: 25, mana: 15, desc: '+30% к урону на 10 секунд.' },
    ],
  },
  mage: {
    id: 'mage', name: 'Маг', icon: '🔮',
    desc: 'Повелитель стихий. Атакует издалека, мощная магия, но хрупкое тело.',
    base: { str: 2, agi: 4, int: 12, vit: 6 },
    dmgType: 'magic', range: 18, atkCd: 1.7, weapon: 'staff', attackAnim: 'cast', projectile: 'bolt',
    look: { skin: 0xf0c8a0, shirt: 0x2c3e8f, pants: 0x22264a, boots: 0x2a2030, hair: 0xd8d8d8, beard: true, robe: true },
    skills: [
      { id: 'fireball', name: 'Огненный шар', icon: '🔥', type: 'projectile', proj: 'fireball', mult: 2.4, cd: 4, mana: 15, range: 20, desc: 'Швыряет огненный шар: 240% магического урона.' },
      { id: 'nova', name: 'Ледяная нова', icon: '❄️', type: 'nova', mult: 1.2, radius: 7, slow: 4, cd: 10, mana: 30, desc: 'Волна холода вокруг: 120% урона и замедление на 4 сек.' },
      { id: 'heal', name: 'Исцеление', icon: '✨', type: 'heal', cd: 15, mana: 25, desc: 'Восстанавливает здоровье (зависит от интеллекта).' },
    ],
  },
  archer: {
    id: 'archer', name: 'Лучник', icon: '🏹',
    desc: 'Меткий стрелок. Быстрые атаки издалека и высокая подвижность.',
    base: { str: 6, agi: 12, int: 3, vit: 7 },
    dmgType: 'phys', range: 20, atkCd: 1.3, weapon: 'bow', attackAnim: 'bow', projectile: 'arrow',
    look: { skin: 0xe8b890, shirt: 0x2e5a2a, pants: 0x4a3a22, boots: 0x3a2a1c, hair: 0xc89a50 },
    skills: [
      { id: 'aimed', name: 'Прицельный выстрел', icon: '🎯', type: 'projectile', proj: 'bigarrow', mult: 2.5, cd: 6, mana: 10, desc: 'Точный выстрел: 250% физического урона.' },
      { id: 'volley', name: 'Залп', icon: '🏹', type: 'volley', mult: 1.3, radius: 7, cd: 10, mana: 20, desc: 'Град стрел по цели и врагам рядом с ней: 130% урона.' },
      { id: 'haste', name: 'Попутный ветер', icon: '💨', type: 'buff', buff: 'haste', duration: 6, cd: 20, mana: 15, desc: '+50% к скорости бега и +30% к скорости атаки на 6 сек.' },
    ],
  },
};

// ---------------------------------------------------------------- предметы
export const RARITIES = {
  common: { name: 'Обычный', color: '#c9c9c9', bonus: [0, 1], mult: 1 },
  uncommon: { name: 'Необычный', color: '#4fd65f', bonus: [1, 2], mult: 1.15 },
  rare: { name: 'Редкий', color: '#4a90ff', bonus: [2, 3], mult: 1.3 },
  epic: { name: 'Эпический', color: '#b45cff', bonus: [3, 4], mult: 1.5 },
  legendary: { name: 'Легендарный', color: '#ff9a2a', bonus: [4, 4], mult: 1.8 }, // только от админа
};
const RARITY_WEIGHTS = [['common', 60], ['uncommon', 28], ['rare', 10], ['epic', 2]];

export function rollRarity() {
  let r = Math.random() * 100;
  for (const [id, w] of RARITY_WEIGHTS) if ((r -= w) <= 0) return id;
  return 'common';
}

const BASE_NAMES = {
  head: ['Кожаный капюшон', 'Железный шлем', 'Стальной шлем', 'Рунический шлем'],
  chest: ['Кожаная куртка', 'Кольчуга', 'Стальной доспех', 'Рунический доспех'],
  hands: ['Кожаные перчатки', 'Кольчужные рукавицы', 'Латные перчатки', 'Рунические перчатки'],
  feet: ['Кожаные сапоги', 'Подкованные сапоги', 'Стальные сабатоны', 'Рунические сапоги'],
  sword: ['Ржавый меч', 'Железный меч', 'Стальной клинок', 'Рунный клинок'],
  staff: ['Посох ученика', 'Дубовый посох', 'Посох чародея', 'Рунный посох'],
  bow: ['Короткий лук', 'Охотничий лук', 'Длинный лук', 'Рунный лук'],
};
const ARMOR_COLORS = [0x7a5230, 0x8d939c, 0xc9cfd8, 0x5a44c8];
const WEAPON_COLORS = {
  sword: [0x9a8a7a, 0xa8b0ba, 0xd8dee8, 0x9a80ff],
  staff: [0x6a4424, 0x5a3a1e, 0x3a2a2a, 0x2a1a40],
  bow: [0x8a5a2a, 0x6a4220, 0x4a2e18, 0x3a2050],
};
const SUFFIX = { str: 'силы', agi: 'ловкости', int: 'мудрости', vit: 'стойкости' };
const AFFINITY = { sword: 'str', staff: 'int', bow: 'agi' };
const ARMOR_MULT = { head: 1, chest: 1.6, hands: 0.7, feet: 0.8 };

export function generateItem(slot, level, opts = {}) {
  level = clamp(Math.round(level), 1, MAX_LEVEL);
  const rarity = opts.rarity || rollRarity();
  const R = RARITIES[rarity];
  const tier = clamp(Math.floor((level - 1) / 4), 0, 3);
  const item = { id: uid(), slot, level, rarity, tier, stats: {} };
  let baseName;
  if (slot === 'weapon') {
    const wt = opts.weaponType || pick(['sword', 'staff', 'bow']);
    item.weaponType = wt;
    item.dmg = Math.round((5 + level * 2.6) * R.mult * (opts.max ? 1.1 : rand(0.92, 1.08)));
    item.color = WEAPON_COLORS[wt][tier];
    baseName = BASE_NAMES[wt][tier];
  } else {
    item.armor = Math.max(1, Math.round((2 + level * 1.4) * ARMOR_MULT[slot] * R.mult * (opts.max ? 1.1 : rand(0.9, 1.1))));
    item.color = ARMOR_COLORS[tier];
    baseName = BASE_NAMES[slot][tier];
  }
  const nb = opts.noBonus ? 0 : randInt(R.bonus[0], R.bonus[1]);
  if (opts.max) {
    // максимальный бонус ко всем характеристикам, основная — у оружия ещё выше
    for (const k of STAT_KEYS) item.stats[k] = 1 + Math.ceil(level / 2);
    if (item.weaponType) item.stats[AFFINITY[item.weaponType]] += 5;
  } else for (let i = 0; i < nb; i++) {
    const st = i === 0 && item.weaponType && Math.random() < 0.7 ? AFFINITY[item.weaponType] : pick(STAT_KEYS);
    item.stats[st] = (item.stats[st] || 0) + randInt(1, 1 + Math.ceil(level / 2));
  }
  let best = null;
  for (const k in item.stats) if (!best || item.stats[k] > item.stats[best]) best = k;
  item.name = opts.max ? `${baseName} Владыки` : best ? `${baseName} ${SUFFIX[best]}` : baseName;
  item.value = Math.round((4 + level * 3) * R.mult * (1 + nb * 0.4));
  return item;
}

// самый сильный предмет для слота (админ-команда /max_item)
export function makeMaxItem(slot, weaponType) {
  return generateItem(slot, MAX_LEVEL, { rarity: 'legendary', weaponType, max: true });
}

export const MAX_ALLOC = 99; // очков в каждую характеристику по /max_stat

export function makePotion(type, count = 1) {
  return {
    id: uid(), type: 'potion', potion: type, count, rarity: 'common', value: 5,
    name: type === 'hp' ? 'Зелье здоровья' : 'Зелье маны',
    desc: type === 'hp' ? 'Восстанавливает 40% здоровья.' : 'Восстанавливает 40% маны.',
  };
}

export function randomDrop(level, classWeapon) {
  const slot = pick(SLOTS);
  const weaponType = Math.random() < 0.7 ? classWeapon : pick(['sword', 'staff', 'bow']);
  return generateItem(slot, level, { weaponType });
}

// ---------------------------------------------------------------- монстры
export const MOBS = {
  wolf: { name: 'Серый волк', model: 'wolf', hp: 50, dmg: 8, armor: 1, speed: 5.2, range: 1.9, atkCd: 1.6, aggro: 11, xp: 22, radius: 0.7, hitHeight: 0.7, plateY: 1.7 },
  goblin: { name: 'Гоблин-воришка', model: 'goblin', hp: 70, dmg: 10, armor: 2, speed: 4.6, range: 1.8, atkCd: 1.5, aggro: 10, xp: 30, radius: 0.5, hitHeight: 0.8, plateY: 1.9 },
  skeleton: { name: 'Скелет-страж', model: 'skeleton', hp: 120, dmg: 16, armor: 4, speed: 4.0, range: 2.2, atkCd: 1.8, aggro: 12, xp: 48, radius: 0.5, hitHeight: 1.1, plateY: 2.5 },
  orc: { name: 'Орк-громила', model: 'orc', hp: 190, dmg: 24, armor: 6, speed: 4.4, range: 2.6, atkCd: 2.0, aggro: 13, xp: 75, radius: 0.8, hitHeight: 1.4, plateY: 3.0 },
  boss: { name: 'Гром-Вожак', model: 'ogre', hp: 1400, dmg: 40, armor: 12, speed: 4.2, range: 3.8, atkCd: 2.2, aggro: 16, xp: 600, radius: 1.6, hitHeight: 2.6, plateY: 5.4, boss: true, respawn: 90 },
};

export const SPAWN_ZONES = [
  { mob: 'wolf', name: 'Волчий лес', center: [55, 45], radius: 22, count: 9, level: [1, 3] },
  { mob: 'goblin', name: 'Гоблинские холмы', center: [-62, 55], radius: 20, count: 9, level: [2, 4] },
  { mob: 'skeleton', name: 'Старое кладбище', center: [25, -88], radius: 18, count: 8, level: [4, 6] },
  { mob: 'orc', name: 'Лагерь орков', center: [-85, -68], radius: 16, count: 7, level: [6, 8] },
  { mob: 'boss', name: 'Логово Гром-Вожака', center: [-112, -112], radius: 3, count: 1, level: [10, 10] },
];

// ---------------------------------------------------------------- NPC и задания
export const NPCS = [
  {
    id: 'elder', name: 'Старейшина Арвид', pos: [0, -7],
    look: { skin: 0xe0b090, shirt: 0x6a5a8a, pants: 0x3a3048, hair: 0xe0e0e0, beard: true, robe: true },
    greeting: 'Добро пожаловать в деревню Рассвет, странник. Тёмные времена настали — нам нужна помощь каждого, кто способен держать оружие.',
  },
  {
    id: 'captain', name: 'Капитан Брам', pos: [9, 3],
    look: { skin: 0xd8a070, shirt: 0x8d939c, pants: 0x33302a, hair: 0x2a1a10, beard: true },
    equip: { head: { tier: 2, color: 0xc9cfd8 }, chest: { tier: 2, color: 0xc9cfd8 }, weapon: { weaponType: 'sword', tier: 2, color: 0xd8dee8 } },
    greeting: 'Стража на посту, но людей не хватает. Если руки крепкие — работа найдётся.',
  },
  {
    id: 'healer', name: 'Травница Мира', pos: [-9, 3],
    look: { skin: 0xf0c8a0, shirt: 0x3a7a4a, pants: 0x2a3a2a, hair: 0x8a3a1a, robe: true },
    greeting: 'Травы шепчут мне, что ты пришёл не случайно. Присядь, отдохни у огня.',
  },
  {
    id: 'merchant', name: 'Торговец Гаспар', pos: [-4, 11], shop: true,
    look: { skin: 0xe0b088, shirt: 0xb08a2a, pants: 0x4a3020, hair: 0x1a1a1a },
    greeting: 'Лучшие товары по эту сторону гор! Зелья, броня, оружие — всё за честную монету.',
  },
];

export const QUESTS = [
  {
    id: 'wolves', giver: 'elder', title: 'Волчья угроза', level: 1, type: 'kill', target: 'wolf', count: 5,
    text: 'Волки из леса на северо-востоке совсем обнаглели — режут скот и нападают на путников. Убей пятерых, и деревня будет у тебя в долгу.',
    doneText: 'Ты справился! Пастухи наконец смогут спать спокойно.',
    reward: { xp: 150, gold: 30, item: { slot: 'feet', rarity: 'uncommon' } },
  },
  {
    id: 'herbs', giver: 'healer', title: 'Целебные травы', level: 1, type: 'collect', target: 'herb', count: 5,
    text: 'Фиолетовые цветы лунника растут на лугах вокруг деревни. Принеси мне пять — и я сварю тебе зелий в дорогу.',
    doneText: 'Чудесные цветы! Держи зелья, они не раз спасут тебе жизнь.',
    reward: { xp: 120, gold: 15, potions: { hp: 3, mp: 3 } },
  },
  {
    id: 'goblins', giver: 'elder', requires: 'wolves', title: 'Гоблинские воришки', level: 2, type: 'kill', target: 'goblin', count: 6,
    text: 'Гоблины с холмов на северо-западе таскают наши припасы. Проучи шестерых этих мелких пакостников.',
    doneText: 'Отлично! Теперь они дважды подумают, прежде чем лезть в наши амбары.',
    reward: { xp: 260, gold: 45, item: { slot: 'hands', rarity: 'uncommon' } },
  },
  {
    id: 'herbs2', giver: 'healer', requires: 'herbs', title: 'Лунник для лазарета', level: 3, type: 'collect', target: 'herb', count: 8,
    text: 'Капитан привёл раненых с кладбища. Мне нужно больше лунника — восемь цветков.',
    doneText: 'Ты спас не одну жизнь сегодня. Возьми это в знак благодарности.',
    reward: { xp: 300, gold: 40, potions: { hp: 5 }, item: { slot: 'head', rarity: 'uncommon' } },
  },
  {
    id: 'skeletons', giver: 'captain', requires: 'goblins', title: 'Беспокойные мертвецы', level: 4, type: 'kill', target: 'skeleton', count: 8,
    text: 'На старом кладбище к югу поднялись мертвецы. Мои люди боятся туда идти. Упокой восьмерых.',
    doneText: 'Клянусь честью, ты храбрее половины моей стражи!',
    reward: { xp: 480, gold: 70, item: { slot: 'head', rarity: 'rare' } },
  },
  {
    id: 'orcs', giver: 'captain', requires: 'skeletons', title: 'Орочья орда', level: 6, type: 'kill', target: 'orc', count: 6,
    text: 'Разведчики донесли: на юго-западе разбили лагерь орки. Их нужно остановить, пока они не двинулись на деревню.',
    doneText: 'Орки отступают! Это твоя победа.',
    reward: { xp: 750, gold: 110, item: { slot: 'chest', rarity: 'rare' } },
  },
  {
    id: 'boss', giver: 'elder', requires: 'orcs', title: 'Гром-Вожак', level: 8, type: 'kill', target: 'boss', count: 1,
    text: 'Орками командует чудовищный огр — Гром-Вожак. Его логово в дальнем юго-западном углу долины, за кольцом камней. Сразить его — значит спасти всех нас.',
    doneText: 'Легенды будут слагать о тебе, герой! Прими этот дар — лучшее, что есть у нашей деревни.',
    reward: { xp: 1600, gold: 300, item: { slot: 'weapon', rarity: 'epic' } },
  },
];

export const SHOP_POTIONS = [
  { potion: 'hp', price: 15 },
  { potion: 'mp', price: 15 },
];

// ---------------------------------------------------------------- новый персонаж
export function newSave(name, classId) {
  const cls = CLASSES[classId];
  const inventory = Array(INV_SIZE).fill(null);
  inventory[0] = makePotion('hp', 5);
  inventory[1] = makePotion('mp', 5);
  return {
    name, classId, level: 1, xp: 0, gold: 20, statPoints: 0,
    alloc: { str: 0, agi: 0, int: 0, vit: 0 },
    inventory,
    equipment: {
      head: null, hands: null, feet: null,
      chest: generateItem('chest', 1, { rarity: 'common', noBonus: true }),
      weapon: generateItem('weapon', 1, { rarity: 'common', weaponType: cls.weapon, noBonus: true }),
    },
    quests: { active: {}, done: [] },
    pos: [0, 7],
  };
}
