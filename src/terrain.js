// Общая для клиента и сервера геометрия мира (без three.js и DOM)
import { SPAWN_ZONES } from './data.js';
import { smoothstep } from './utils.js';

export const WORLD_HALF = 150;
export const VILLAGE_RADIUS = 26;

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  let h = Math.sin(x * 0.035) * Math.cos(z * 0.03) * 3.5
    + Math.sin(x * 0.08 + 1.3) * Math.sin(z * 0.07 + 0.7) * 1.2
    + Math.sin((x - z) * 0.015) * 2.5;
  h *= smoothstep(20, 40, d);
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(128, 158, e) * 26;
  return h;
}

export function zoneNameAt(x, z) {
  if (Math.hypot(x, z) < VILLAGE_RADIUS + 4) return 'Деревня Рассвет';
  for (const zn of SPAWN_ZONES) {
    if (Math.hypot(x - zn.center[0], z - zn.center[1]) < Math.max(zn.radius + 12, 18)) return zn.name;
  }
  return 'Долина Эльдории';
}

export const inSafeZone = (x, z) => Math.hypot(x, z) < VILLAGE_RADIUS - 2;
