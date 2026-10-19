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
