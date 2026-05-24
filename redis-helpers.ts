import type { RedisClient } from '@devvit/public-api';
import {
  KEYS,
  ModNote,
  WatchFlag,
  ShiftHandoff,
  makeNoteId,
  NoteCategory,
  WatchLevel,
} from './types.js';

// ─── Note Helpers ─────────────────────────────────────────────────────────────

export async function addNote(
  redis: RedisClient,
  subreddit: string,
  params: Omit<ModNote, 'id' | 'createdAt' | 'resolved'>
): Promise<ModNote> {
  const note: ModNote = {
    ...params,
    id: makeNoteId(),
    createdAt: Date.now(),
    resolved: false,
  };
  const key = KEYS.subredditNotes(subreddit);
  try {
    await redis.zAdd(key, { score: note.createdAt, member: JSON.stringify(note) });
    } catch (err) {
    }
  return note;
}

export async function getNotes(
  redis: RedisClient,
  subreddit: string,
  limit = 50
): Promise<ModNote[]> {
  const key = KEYS.subredditNotes(subreddit);
  // Get most recent notes (highest scores = newest)
  try {
    const raw = await redis.zRange(key, 0, limit - 1, { reverse: true });
      return raw
      .map((r: any) => {
        try {
          // zRange returns objects with {score, member} or plain strings
          const str = typeof r === 'string' ? r : r.member;
          return JSON.parse(str) as ModNote;
        } catch {
          return null;
        }
      })
      .filter((n): n is ModNote => n !== null);
  } catch (err) {
      return [];
  }
}

export async function getNotesForTarget(
  redis: RedisClient,
  subreddit: string,
  targetId: string
): Promise<ModNote[]> {
  const all = await getNotes(redis, subreddit, 200);
  return all.filter((n) => n.targetId === targetId);
}

export async function resolveNote(
  redis: RedisClient,
  subreddit: string,
  noteId: string,
  resolvedBy: string
): Promise<boolean> {
  const key = KEYS.subredditNotes(subreddit);
  const raw = await redis.zRange(key, 0, -1);
  for (const r of raw) {
    try {
      const memberStr = typeof r === 'string' ? r : (r as any).member;
      const note = JSON.parse(memberStr) as ModNote;
      if (note.id === noteId) {
        const updated: ModNote = {
          ...note,
          resolved: true,
          resolvedBy,
          resolvedAt: Date.now(),
        };
        await redis.zRem(key, [memberStr]);
        await redis.zAdd(key, {
          score: note.createdAt,
          member: JSON.stringify(updated),
        });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function deleteNote(
  redis: RedisClient,
  subreddit: string,
  noteId: string
): Promise<boolean> {
  const key = KEYS.subredditNotes(subreddit);
  const raw = await redis.zRange(key, 0, -1);
  for (const r of raw) {
    try {
      const memberStr = typeof r === 'string' ? r : (r as any).member;
      const note = JSON.parse(memberStr) as ModNote;
      if (note.id === noteId) {
        await redis.zRem(key, [memberStr]);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

// ─── Watch Flag Helpers ───────────────────────────────────────────────────────

export async function setWatchFlag(
  redis: RedisClient,
  subreddit: string,
  params: Omit<WatchFlag, 'flaggedAt' | 'active'>
): Promise<WatchFlag> {
  const flag: WatchFlag = {
    ...params,
    flaggedAt: Date.now(),
    active: true,
  };
  const key = KEYS.watchFlags(subreddit);
  await redis.hSet(key, { [params.username]: JSON.stringify(flag) });
  return flag;
}

export async function getWatchFlag(
  redis: RedisClient,
  subreddit: string,
  username: string
): Promise<WatchFlag | null> {
  const key = KEYS.watchFlags(subreddit);
  const raw = await redis.hGet(key, username);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WatchFlag;
  } catch {
    return null;
  }
}

export async function getAllWatchFlags(
  redis: RedisClient,
  subreddit: string
): Promise<WatchFlag[]> {
  const key = KEYS.watchFlags(subreddit);
  const all = await redis.hGetAll(key);
  return Object.values(all)
    .map((v) => {
      try {
        return JSON.parse(v) as WatchFlag;
      } catch {
        return null;
      }
    })
    .filter((f): f is WatchFlag => f !== null && f.active);
}

export async function clearWatchFlag(
  redis: RedisClient,
  subreddit: string,
  username: string
): Promise<void> {
  const key = KEYS.watchFlags(subreddit);
  const raw = await redis.hGet(key, username);
  if (!raw) return;
  try {
    const flag = JSON.parse(raw) as WatchFlag;
    flag.active = false;
    await redis.hSet(key, { [username]: JSON.stringify(flag) });
  } catch {
    // nothing to do
  }
}

// ─── Shift Handoff Helpers ────────────────────────────────────────────────────

export async function createHandoff(
  redis: RedisClient,
  subreddit: string,
  params: Omit<ShiftHandoff, 'id' | 'createdAt' | 'subreddit'>
): Promise<ShiftHandoff> {
  const handoff: ShiftHandoff = {
    ...params,
    id: makeNoteId(),
    subreddit,
    createdAt: Date.now(),
  };
  const key = KEYS.handoffs(subreddit);
  await redis.zAdd(key, { score: handoff.createdAt, member: JSON.stringify(handoff) });
  return handoff;
}

export async function getLatestHandoffs(
  redis: RedisClient,
  subreddit: string,
  limit = 5
): Promise<ShiftHandoff[]> {
  const key = KEYS.handoffs(subreddit);
  const raw = await redis.zRange(key, 0, limit - 1, { reverse: true });
  return raw
    .map((r: any) => {
      try {
        const str = typeof r === 'string' ? r : r.member;
        return JSON.parse(str) as ShiftHandoff;
      } catch {
        return null;
      }
    })
    .filter((h): h is ShiftHandoff => h !== null);
}

// ─── Label helpers ─────────────────────────────────────────────────────────

export function watchLevelEmoji(level: WatchLevel): string {
  const map: Record<WatchLevel, string> = {
    low: '🟡',
    medium: '🟠',
    high: '🔴',
    critical: '🚨',
  };
  return map[level];
}

export function categoryEmoji(cat: NoteCategory): string {
  const map: Record<NoteCategory, string> = {
    general: '📝',
    rule_violation: '⚠️',
    escalation: '🔺',
    ban_warning: '🚫',
    positive: '✅',
    shift_note: '🔄',
  };
  return map[cat];
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
