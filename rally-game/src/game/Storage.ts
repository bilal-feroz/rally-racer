export interface BestRecord {
  time: number;
  splits: number[];
  date: number;
}

const KEY_BEST = 'timberline-rally.best.v1';
const KEY_SETTINGS = 'timberline-rally.settings.v1';

export function loadBest(): BestRecord | null {
  try {
    const raw = localStorage.getItem(KEY_BEST);
    if (!raw) return null;
    const v = JSON.parse(raw) as BestRecord;
    if (typeof v.time !== 'number' || !Array.isArray(v.splits)) return null;
    return v;
  } catch {
    return null;
  }
}

export function saveBest(b: BestRecord): void {
  try {
    localStorage.setItem(KEY_BEST, JSON.stringify(b));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

const KEY_TOP = 'timberline-rally.top.v1';

export interface TopEntry {
  time: number;
  date: number;
}

export function loadTop(): TopEntry[] {
  try {
    const raw = localStorage.getItem(KEY_TOP);
    const v = raw ? (JSON.parse(raw) as TopEntry[]) : [];
    return Array.isArray(v) ? v.filter((e) => typeof e.time === 'number').slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** Insert a finish time; returns its 1-based rank in the top 5 (or 0 if it didn't place). */
export function addTop(time: number): number {
  const list = loadTop();
  list.push({ time, date: Date.now() });
  list.sort((a, b) => a.time - b.time);
  const top = list.slice(0, 5);
  try {
    localStorage.setItem(KEY_TOP, JSON.stringify(top));
  } catch {
    /* ignore */
  }
  const idx = top.findIndex((e) => e.time === time);
  return idx >= 0 ? idx + 1 : 0;
}

export function clearBest(): void {
  try {
    localStorage.removeItem(KEY_BEST);
  } catch {
    /* ignore */
  }
}

export type Quality = 'high' | 'medium' | 'low';

export interface Settings {
  muted: boolean;
  volume: number;
  quality?: Quality;
  metric?: boolean;
  proAssists?: boolean;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (raw) return { muted: false, volume: 0.8, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { muted: false, volume: 0.8 };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
