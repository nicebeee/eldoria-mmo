// SVG-иконки предметов, окрашенные в цвет предмета
const svg = (inner) => `<svg viewBox="0 0 48 48" class="ico">${inner}</svg>`;
const hex = (n) => '#' + (n ?? 0x999999).toString(16).padStart(6, '0');
const S = 'stroke="#120c06" stroke-width="1.6" stroke-linejoin="round"';

export function itemIcon(item) {
  if (item.type === 'potion') {
    const c = item.potion === 'hp' ? '#e0343a' : '#3a78e8';
    return svg(`<path d="M19 6h10v9c7 3 10 8 10 14 0 8-7 14-15 14S9 37 9 29c0-6 3-11 10-14z" fill="#d8e4ee" fill-opacity=".25" ${S}/>
      <path d="M11 28c3-2 7 0 13-1s9-2 13 0c0 7-6 12-13 12s-13-4-13-11z" fill="${c}"/>
      <circle cx="18" cy="31" r="2.5" fill="#fff" fill-opacity=".5"/>
      <rect x="18" y="3" width="12" height="5" rx="1.5" fill="#8a5a2a" ${S}/>`);
  }
  const c = hex(item.color);
  const kind = item.slot === 'weapon' ? item.weaponType : item.slot;
  switch (kind) {
    case 'head':
      return svg(`<path d="M8 31C8 17 15 8 24 8s16 9 16 23v7h-8v-9H16v9H8z" fill="${c}" ${S}/>
        <path d="M22 21h4v14h-4z" fill="${c}" ${S}/><path d="M12 22c2-7 7-10 12-10" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"/>`);
    case 'chest':
      return svg(`<path d="M15 7l5 4h8l5-4 9 6-4 10-3-2v21H13V21l-3 2-4-10z" fill="${c}" ${S}/>
        <path d="M24 12v28M17 20h14M17 28h14" stroke="#120c06" stroke-opacity=".45" stroke-width="1.4"/>`);
    case 'hands':
      return svg(`<path d="M14 41V22c0-3 1-4 3-4V10c0-2 1-3 2.5-3S22 8 22 10v6V8c0-2 1-3 2.5-3S27 6 27 8v8-7c0-2 1-3 2.5-3S32 7 32 9v13l3.5-4c2-2 4.5-1 4 1.5L34 32v9z" fill="${c}" ${S}/>
        <path d="M14 36h20" stroke="#120c06" stroke-width="1.6"/>`);
    case 'feet':
      return svg(`<path d="M16 6h14v24l11 4c3 1 3 6 0 7H11V30c3-2 5-4 5-8z" fill="${c}" ${S}/>
        <path d="M11 37h31M16 13h14" stroke="#120c06" stroke-width="1.6"/>`);
    case 'sword':
      return svg(`<path d="M39 5l4 4-21 21-4-4z" fill="${c}" ${S}/><path d="M12 24l12 12-2.5 2.5-12-12z" fill="#c8a040" ${S}/>
        <path d="M15 33l-7 7" stroke="#5a3a1e" stroke-width="5" stroke-linecap="round"/><circle cx="7" cy="41" r="2.6" fill="#c8a040" ${S}/>`);
    case 'staff':
      return svg(`<path d="M11 43L33 15" stroke="${c}" stroke-width="5" stroke-linecap="round"/><path d="M11 43L33 15" stroke="#120c06" stroke-opacity=".4" stroke-width="1"/>
        <circle cx="36" cy="11" r="7" fill="#6cd0ff" ${S}/><circle cx="34" cy="9" r="2.2" fill="#fff" fill-opacity=".7"/>`);
    case 'bow':
      return svg(`<path d="M14 5c22 8 22 30 0 38" fill="none" stroke="#120c06" stroke-width="6" stroke-linecap="round"/>
        <path d="M14 5c22 8 22 30 0 38" fill="none" stroke="${c}" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M14 5v38" stroke="#e8e0d0" stroke-width="1.2"/><path d="M9 24h28l-4-3m4 3l-4 3" stroke="#d8d8d8" stroke-width="1.6" fill="none"/>`);
  }
  return svg('');
}

export const SLOT_PLACEHOLDER = {
  head: itemIcon({ slot: 'head', color: 0x3a3428 }),
  chest: itemIcon({ slot: 'chest', color: 0x3a3428 }),
  hands: itemIcon({ slot: 'hands', color: 0x3a3428 }),
  feet: itemIcon({ slot: 'feet', color: 0x3a3428 }),
  weapon: itemIcon({ slot: 'weapon', weaponType: 'sword', color: 0x3a3428 }),
};
