// ─── OfficialModRelay Types ───────────────────────────────────────────────────────────

export type WatchLevel = 'low' | 'medium' | 'high' | 'critical';
export type NoteCategory =
  | 'general'
  | 'rule_violation'
  | 'escalation'
  | 'ban_warning'
  | 'positive'
  | 'shift_note';

export interface ModNote {
  id: string;           // uuid-ish: timestamp + random
  authorMod: string;    // mod username who wrote the note
  text: string;         // note body
  category: NoteCategory;
  targetType: 'user' | 'post' | 'comment';
  targetId: string;     // username OR post/comment fullname (t1_xxx, t3_xxx)
  targetDisplay: string;// human-readable label (username, post title truncated)
  createdAt: number;    // unix ms
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface WatchFlag {
  username: string;
  level: WatchLevel;
  reason: string;
  flaggedBy: string;
  flaggedAt: number;
  expiresAt?: number; // optional expiry, unix ms
  active: boolean;
}

export interface ShiftHandoff {
  id: string;
  writtenBy: string;
  subreddit: string;
  createdAt: number;
  summary: string;           // general shift summary
  openItems: string[];       // list of unresolved items mods should know
  watchUsers: string[];      // usernames currently flagged
  urgentNotes: string[];     // note ids that are unresolved + high/critical
}

// Redis key helpers ─────────────────────────────────────────────────────────

export const KEYS = {
  // Sorted set: score = createdAt, member = note JSON
  subredditNotes: (subreddit: string) => `modrelay:notes:${subreddit}`,
  // Hash: field = username, value = WatchFlag JSON
  watchFlags: (subreddit: string) => `modrelay:watchflags:${subreddit}`,
  // Sorted set: score = createdAt, member = ShiftHandoff JSON
  handoffs: (subreddit: string) => `modrelay:handoffs:${subreddit}`,
  // String: last handoff post id (for pinning)
  lastHandoffPost: (subreddit: string) => `modrelay:lasthandoffpost:${subreddit}`,
} as const;

export function makeNoteId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
