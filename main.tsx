// ─── OfficialModRelay – Mod Team Escalation & Shift Handoff Tool ─────────────────────
// A Reddit Devvit app for the "Mod Tools & Migrated Apps Hackathon"
//
// Features:
//   • Flag users with watch levels (low / medium / high / critical)
//   • Add mod notes to users, posts, and comments with categories
//   • Resolve / delete notes
//   • Generate shift handoff posts with auto-compiled open items
//   • Dashboard custom post showing live watch list + recent notes

import { Devvit, useState, useAsync, useForm } from '@devvit/public-api';
import {
  addNote,
  getNotes,
  getNotesForTarget,
  resolveNote,
  deleteNote,
  setWatchFlag,
  getWatchFlag,
  getAllWatchFlags,
  clearWatchFlag,
  createHandoff,
  getLatestHandoffs,
  watchLevelEmoji,
  categoryEmoji,
  timeAgo,
} from './redis-helpers.js';
import type { WatchLevel, NoteCategory, ModNote, WatchFlag } from './types.js';

// ─── Configure Devvit ─────────────────────────────────────────────────────────

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// ─── Helper: get current mod username safely ──────────────────────────────────

async function getCurrentMod(context: Devvit.Context): Promise<string> {
  try {
    // Try getUserById with context.userId first - more reliable in form handlers
    if (context.userId) {
      const user = await context.reddit.getUserById(context.userId);
      if (user?.username) return user.username;
    }
    // Fallback to getCurrentUser
    const user = await context.reddit.getCurrentUser();
    if (user?.username) return user.username;
    return 'unknown-mod';
  } catch {
    try {
      const user = await context.reddit.getCurrentUser();
      if (user?.username) return user.username;
    } catch {
      // nothing
    }
    return 'unknown-mod';
  }
}

// ─── Helper: get current subreddit name safely ────────────────────────────────

async function getSubredditName(context: Devvit.Context): Promise<string> {
  try {
    const sub = await context.reddit.getCurrentSubreddit();
    return sub.name.toLowerCase();
  } catch {
    return 'unknown-subreddit';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 1 – "Flag User for Watch" (on user context menu)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '🚨 OfficialModRelay: Flag User for Watch',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const { ui, reddit, redis } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);

    // Get post author
    let username = '';
    try {
      const post = await reddit.getPostById(event.targetId);
      username = post.authorName ?? '';
    } catch {
      ui.showToast('Could not retrieve post author.');
      return;
    }

    if (!username) {
      ui.showToast('No author found for this post.');
      return;
    }

    ui.showForm(flagUserForm, {
      username,
      mod,
      subreddit,
    });
  },
});

const flagUserForm = Devvit.createForm(
  (data) => ({
    title: `🚨 Flag u/${data.username} for Watch`,
    description: 'Set a watch flag so all mods are alerted when this user is active.',
    fields: [
      {
        type: 'string',
        name: 'username',
        label: 'Username being flagged',
        required: true,
        defaultValue: String(data.username ?? ''),
      },
      {
        type: 'string',
        name: 'mod',
        label: 'Your username (auto-filled)',
        required: true,
        defaultValue: String(data.mod ?? 'unknown-mod'),
      },
      {
        type: 'select',
        name: 'level',
        label: 'Watch Level',
        required: true,
        options: [
          { label: '🟡 Low – Minor concern, keep an eye', value: 'low' },
          { label: '🟠 Medium – Recurring issues', value: 'medium' },
          { label: '🔴 High – Serious repeat offender', value: 'high' },
          { label: '🚨 Critical – Imminent ban / safety', value: 'critical' },
        ],
        defaultValue: ['medium'],
      },
      {
        type: 'string',
        name: 'reason',
        label: 'Reason for flagging',
        required: true,
        placeholder: 'e.g. Repeat rule 4 violations, evading previous temp ban',
      },
      {
        type: 'select',
        name: 'expiry',
        label: 'Auto-expiry',
        required: false,
        options: [
          { label: 'No expiry', value: 'none' },
          { label: '24 hours', value: '86400000' },
          { label: '7 days', value: '604800000' },
          { label: '30 days', value: '2592000000' },
        ],
        defaultValue: ['none'],
      },
    ],
    acceptLabel: 'Set Watch Flag',
    cancelLabel: 'Cancel',
  }),
  async (event, context) => {
    const { ui, redis } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);

    const username = (event.values as any).username as string ?? '';
    const modFromForm = (event.values as any).mod as string ?? '';
    const modName = modFromForm && modFromForm !== 'unknown-mod' ? modFromForm : mod;
    const level = ((event.values as any).level?.[0] ?? 'medium') as WatchLevel;
    const reason = (event.values as any).reason as string ?? '';
    const expiryRaw = (event.values as any).expiry?.[0] as string;
    const expiresAt =
      expiryRaw && expiryRaw !== 'none'
        ? Date.now() + parseInt(expiryRaw, 10)
        : undefined;

    await setWatchFlag(redis, subreddit, {
      username,
      level,
      reason,
      flaggedBy: modName,
      expiresAt,
    });

    // Also auto-create a note for the record
    await addNote(redis, subreddit, {
      authorMod: modName,
      text: `[AUTO] Watch flag set: ${reason}`,
      category: 'escalation',
      targetType: 'user',
      targetId: username,
      targetDisplay: `u/${username}`,
    });

    ui.showToast({
      text: `${watchLevelEmoji(level)} u/${username} flagged as ${level.toUpperCase()} watch.`,
      appearance: 'success',
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 2 – "Add Mod Note" (on post)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '📝 OfficialModRelay: Add Note to Post',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const { ui, reddit } = context;
    const mod = await getCurrentMod(context);
    let postTitle = '';
    try {
      const post = await reddit.getPostById(event.targetId);
      postTitle = post.title?.slice(0, 60) ?? event.targetId;
    } catch {
      postTitle = event.targetId;
    }

    ui.showForm(addNoteForm, {
      targetId: event.targetId,
      targetDisplay: postTitle,
      targetType: 'post',
      mod,
    });
  },
});


const addNoteForm = Devvit.createForm(
  (data) => ({
    title: `📝 Add Mod Note`,
    description: `Target: ${data.targetDisplay}`,
    fields: [
      {
        type: 'string',
        name: 'targetId',
        label: 'Target ID (auto-filled)',
        required: true,
        defaultValue: String(data.targetId ?? ''),
      },
      {
        type: 'string',
        name: 'targetDisplay',
        label: 'Target label (auto-filled)',
        required: true,
        defaultValue: String(data.targetDisplay ?? ''),
      },
      {
        type: 'string',
        name: 'targetType',
        label: 'Target type (auto-filled)',
        required: true,
        defaultValue: String(data.targetType ?? 'post'),
      },
      {
        type: 'string',
        name: 'mod',
        label: 'Your username (auto-filled)',
        required: true,
        defaultValue: String(data.mod ?? 'unknown-mod'),
      },
      {
        type: 'select',
        name: 'category',
        label: 'Category',
        required: true,
        options: [
          { label: '📝 General', value: 'general' },
          { label: '⚠️ Rule Violation', value: 'rule_violation' },
          { label: '🔺 Escalation', value: 'escalation' },
          { label: '🚫 Ban Warning', value: 'ban_warning' },
          { label: '✅ Positive / Resolved', value: 'positive' },
          { label: '🔄 Shift Note', value: 'shift_note' },
        ],
        defaultValue: ['general'],
      },
      {
        type: 'paragraph',
        name: 'text',
        label: 'Note',
        required: true,
        placeholder: 'Describe what happened, any context, or actions taken...',
      },
    ],
    acceptLabel: 'Save Note',
    cancelLabel: 'Cancel',
  }),
  async (event, context) => {
    const { ui, redis } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);

    const targetId = (event.values as any).targetId as string ?? '';
    const targetDisplay = (event.values as any).targetDisplay as string ?? targetId;
    const targetType = (event.values as any).targetType as 'post' | 'comment' | 'user' ?? 'post';
    const category = ((event.values as any).category?.[0] ?? 'general') as NoteCategory;
    const text = (event.values as any).text as string ?? '';
    const modFromForm = (event.values as any).mod as string ?? '';
    const modName = modFromForm && modFromForm !== 'unknown-mod' ? modFromForm : mod;

    await addNote(redis, subreddit, {
      authorMod: modName,
      text,
      category,
      targetType,
      targetId,
      targetDisplay,
    });

    ui.showToast({ text: '✅ Note saved!', appearance: 'success' });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 4 – "Add User Note" (directly from post, targets the author)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '👤 OfficialModRelay: Add Note to Post Author',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const { ui, reddit } = context;
    const mod = await getCurrentMod(context);
    let username = '';
    try {
      const post = await reddit.getPostById(event.targetId);
      username = post.authorName ?? '';
    } catch {
      ui.showToast('Could not retrieve post author.');
      return;
    }

    ui.showForm(addNoteForm, {
      targetId: username,
      targetDisplay: `u/${username}`,
      targetType: 'user',
      mod,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 5 – "Generate Shift Handoff" (subreddit level)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '🔄 OfficialModRelay: Generate Shift Handoff',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { ui } = context;
    ui.showForm(shiftHandoffForm);
  },
});

const shiftHandoffForm = Devvit.createForm(
  () => ({
    title: '🔄 Generate Shift Handoff',
    description:
      'Create a handoff post summarising this shift for the next mod team. Open unresolved notes and watch flags will be auto-attached.',
    fields: [
      {
        type: 'paragraph',
        name: 'summary',
        label: 'Shift Summary',
        required: true,
        placeholder:
          'e.g. Quiet shift. Removed 3 spam posts, warned u/exampleuser about rule 2. Watch for any followup from the earlier drama thread.',
      },
      {
        type: 'string',
        name: 'openItems',
        label: 'Open Items (comma-separated)',
        required: false,
        placeholder: 'e.g. Check modmail from u/user1, Pending ban review for u/user2',
      },
    ],
    acceptLabel: 'Post Handoff',
    cancelLabel: 'Cancel',
  }),
  async (event, context) => {
    const { ui, redis, reddit } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);

    const summary = (event.values as any).summary as string ?? '';
    const openItemsRaw = (event.values as any).openItems as string ?? '';
    const openItems = openItemsRaw
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    // Auto-pull unresolved notes and active watch flags
    const allNotes = await getNotes(redis, subreddit, 100);
    const unresolvedNotes = allNotes.filter((n) => !n.resolved);
    const watchFlags = await getAllWatchFlags(redis, subreddit);

    // Build urgent note ids (unresolved escalation / ban_warning)
    const urgentNotes = unresolvedNotes
      .filter((n) => n.category === 'escalation' || n.category === 'ban_warning')
      .map((n) => n.id);

    const watchUsers = watchFlags.map((f) => f.username);

    // Create handoff record in Redis
    const handoff = await createHandoff(redis, subreddit, {
      writtenBy: mod,
      summary,
      openItems,
      watchUsers,
      urgentNotes,
    });

    // Build the post body
    const lines: string[] = [
      `# 🔄 Mod Shift Handoff — r/${subreddit}`,
      `**Written by:** u/${mod}  `,
      `**Time:** ${new Date().toUTCString()}`,
      '',
      '---',
      '',
      '## 📋 Shift Summary',
      summary,
      '',
    ];

    if (openItems.length > 0) {
      lines.push('## 📌 Open Items for Next Shift');
      openItems.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }

    if (watchUsers.length > 0) {
      lines.push('## 👀 Active Watch List');
      for (const flag of watchFlags) {
        lines.push(
          `- ${watchLevelEmoji(flag.level)} **u/${flag.username}** [${flag.level.toUpperCase()}] – ${flag.reason} *(flagged by u/${flag.flaggedBy})*`
        );
      }
      lines.push('');
    }

    if (unresolvedNotes.length > 0) {
      lines.push('## ⚠️ Unresolved Notes');
      for (const note of unresolvedNotes.slice(0, 15)) {
        lines.push(
          `- ${categoryEmoji(note.category)} **${note.targetDisplay}** – ${note.text.slice(0, 100)} *(by u/${note.authorMod}, ${timeAgo(note.createdAt)})*`
        );
      }
      if (unresolvedNotes.length > 15) {
        lines.push(`- *…and ${unresolvedNotes.length - 15} more. Check the dashboard.*`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by ModRelay · Install at [developers.reddit.com](https://developers.reddit.com)*');

    const body = lines.join('\n');

    // Submit handoff post to subreddit
    try {
      const post = await reddit.submitPost({
        title: `[MOD HANDOFF] Shift Summary — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        subredditName: subreddit,
        text: body,
      });

      // Distinguish (mod) it so it stands out
      // Store last handoff post id
      await redis.set(`modrelay:lasthandoffpost:${subreddit}`, post.id);

      ui.showToast({ text: '✅ Shift handoff posted!', appearance: 'success' });
      ui.navigateTo(post);
    } catch (err) {
      ui.showToast(`Error posting handoff: ${String(err)}`);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 6 – "Open ModRelay Dashboard" (subreddit level)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '📊 OfficialModRelay: Open Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { ui, reddit, redis } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);

    // Create the dashboard custom post
    const post = await reddit.submitPost({
      title: `[OfficialModRelay Dashboard] r/${subreddit}`,
      subredditName: subreddit,
      preview: (
        <vstack alignment="center middle" height="100%">
          <text size="large" weight="bold" color="neutral-content">
            📊 Loading OfficialModRelay Dashboard…
          </text>
        </vstack>
      ),
    });

    ui.showToast('Dashboard post created!');
    ui.navigateTo(post);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU ITEM 7 – "Clear Watch Flag" (subreddit level)
// ─────────────────────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '✅ OfficialModRelay: Clear User Watch Flag',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { ui } = context;
    ui.showForm(clearFlagForm);
  },
});

const clearFlagForm = Devvit.createForm(
  () => ({
    title: '✅ Clear Watch Flag',
    description: 'Remove the active watch flag from a user.',
    fields: [
      {
        type: 'string',
        name: 'username',
        label: 'Reddit username (without u/)',
        required: true,
        placeholder: 'exampleuser',
      },
      {
        type: 'string',
        name: 'reason',
        label: 'Reason for clearing',
        required: true,
        placeholder: 'e.g. User has been on good behaviour for 30 days',
      },
    ],
    acceptLabel: 'Clear Flag',
    cancelLabel: 'Cancel',
  }),
  async (event, context) => {
    const { ui, redis } = context;
    const subreddit = await getSubredditName(context);
    const mod = await getCurrentMod(context);
    const username = (event.values as any).username as string ?? '';
    const reason = (event.values as any).reason as string ?? '';

    const existing = await getWatchFlag(redis, subreddit, username);
    if (!existing || !existing.active) {
      ui.showToast(`No active watch flag found for u/${username}.`);
      return;
    }

    await clearWatchFlag(redis, subreddit, username);

    // Log a note for the record
    await addNote(redis, subreddit, {
      authorMod: mod,
      text: `[AUTO] Watch flag cleared. Reason: ${reason}`,
      category: 'positive',
      targetType: 'user',
      targetId: username,
      targetDisplay: `u/${username}`,
    });

    ui.showToast({ text: `✅ Watch flag cleared for u/${username}.`, appearance: 'success' });
  }
);



// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM POST COMPONENT – OfficialModRelay Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type DashboardPage = 'watchlist' | 'notes' | 'handoffs';

const ModRelayDashboard: Devvit.CustomPostComponent = (context) => {
  const { redis, reddit } = context;
  const [page, setPage] = useState<DashboardPage>('watchlist');

  // ── Async data ──────────────────────────────────────────────────────────────
  const { data: subredditName } = useAsync(async () => {
    try {
      const sub = await reddit.getCurrentSubreddit();
      return sub.name.toLowerCase();
    } catch {
      return 'subreddit';
    }
  });



  const [refreshTick, setRefreshTick] = useState(0);
  const [notesPage, setNotesPage] = useState(0);
  const NOTES_PER_PAGE = 4;
  const [pendingNoteId, setPendingNoteId] = useState('');

  const confirmResolveForm = useForm(
    {
      title: '✔ Resolve this note?',
      description: 'Are you sure you want to mark this note as resolved? This cannot be undone.',
      fields: [],
      acceptLabel: 'Yes, Resolve',
      cancelLabel: 'Cancel',
    },
    async () => {
      if (!pendingNoteId) return;
      const mod = await getCurrentMod(context);
      const success = await resolveNote(redis, subredditName ?? '', pendingNoteId, mod);
      if (success) {
        context.ui.showToast({ text: '✅ Note resolved!', appearance: 'success' });
        setRefreshTick(refreshTick + 1);
      } else {
        context.ui.showToast('Could not resolve note. Try refreshing.');
      }
    }
  );

  const { data: watchFlags, loading: loadingFlags } = useAsync(async () => {
    if (!subredditName) return [] as WatchFlag[];
    return getAllWatchFlags(redis, subredditName);
  }, { depends: [subredditName ?? '', String(refreshTick)] });

  const { data: notes, loading: loadingNotes } = useAsync(async () => {
    if (!subredditName) return [] as ModNote[];
    return getNotes(redis, subredditName, 30);
  }, { depends: [subredditName ?? '', String(refreshTick)] });

  const { data: handoffs, loading: loadingHandoffs } = useAsync(async () => {
    if (!subredditName) return [] as import('./types.js').ShiftHandoff[];
    return getLatestHandoffs(redis, subredditName, 3);
  }, { depends: [subredditName ?? '', String(refreshTick)] });

  // ── Colour map for watch levels ─────────────────────────────────────────────
  const levelColor: Record<WatchLevel, string> = {
    low: 'caution',
    medium: 'caution',
    high: 'danger',
    critical: 'danger',
  };

  // ── Render helper for watch list ────────────────────────────────────────────
  const renderWatchList = () => {
    if (loadingFlags) {
      return (
        <vstack alignment="center middle" grow>
          <text color="neutral-content-weak">Loading watch list…</text>
        </vstack>
      );
    }
    const flags = watchFlags ?? [];
    if (flags.length === 0) {
      return (
        <vstack alignment="center middle" grow>
          <text size="xlarge">✅</text>
          <text color="neutral-content-weak">No active watch flags</text>
        </vstack>
      );
    }
    return (
      <vstack gap="small" grow>
        {flags.map((flag) => (
          <hstack
            key={flag.username}
            backgroundColor="neutral-background-weak"
            cornerRadius="medium"
            padding="small"
            gap="small"
            alignment="middle"
          >
            <text size="xlarge">{watchLevelEmoji(flag.level)}</text>
            <vstack grow>
              <text weight="bold" size="medium">u/{flag.username}</text>
              <text size="small" color="neutral-content-weak" wrap>
                {flag.reason.slice(0, 80)}
              </text>
              <text size="xsmall" color="neutral-content-weak">
                by u/{flag.flaggedBy} · {timeAgo(flag.flaggedAt)}
              </text>
            </vstack>
            <text
              size="small"
              color={levelColor[flag.level] === 'danger' ? 'danger-plain' : 'caution-plain'}
              weight="bold"
            >
              {flag.level.toUpperCase()}
            </text>
          </hstack>
        ))}
      </vstack>
    );
  };

  // ── Render helper for notes list ─────────────────────────────────────────────
  const renderNotes = () => {
    if (loadingNotes) {
      return (
        <vstack alignment="center middle" grow>
          <text color="neutral-content-weak">Loading notes…</text>
        </vstack>
      );
    }
    const noteList = notes ?? [];
    if (noteList.length === 0) {
      return (
        <vstack alignment="center middle" grow>
          <text size="xlarge">📭</text>
          <text color="neutral-content-weak">No notes yet</text>
        </vstack>
      );
    }
    const totalPages = Math.ceil(noteList.length / NOTES_PER_PAGE);
    const pageNotes = noteList.slice(notesPage * NOTES_PER_PAGE, (notesPage + 1) * NOTES_PER_PAGE);
    return (
      <vstack gap="small" grow>
        {pageNotes.map((note) => (
          <hstack
            key={note.id}
            backgroundColor={note.resolved ? 'neutral-background-weak' : 'secondary-background'}
            cornerRadius="medium"
            padding="small"
            gap="small"
          >
            <text size="large">{categoryEmoji(note.category)}</text>
            <vstack grow>
              <hstack gap="small" alignment="middle">
                <text weight="bold" size="small">{note.targetDisplay}</text>
                {note.resolved && (
                  <text size="xsmall" color="success-plain">✔ resolved</text>
                )}
              </hstack>
              <text size="small" wrap color="neutral-content">
                {note.text.slice(0, 100)}
              </text>
              <text size="xsmall" color="neutral-content-weak">
                u/{note.authorMod} · {timeAgo(note.createdAt)}
              </text>
              {!note.resolved && (
                <hstack
                  backgroundColor="#c45c00"
                  cornerRadius="small"
                  padding="xsmall"
                  onPress={() => {
                    setPendingNoteId(note.id);
                    context.ui.showForm(confirmResolveForm);
                  }}
                >
                  <text size="xsmall" color="white">✔ Resolve</text>
                </hstack>
              )}
            </vstack>
          </hstack>
        ))}
        {totalPages > 1 && (
          <hstack gap="small" alignment="center middle" padding="xsmall">
            <hstack
              backgroundColor={notesPage > 0 ? '#2b2b2b' : 'neutral-background-weak'}
              cornerRadius="small"
              padding="xsmall"
              onPress={() => { if (notesPage > 0) setNotesPage(notesPage - 1); }}
            >
              <text size="xsmall" color="white">◀ Prev</text>
            </hstack>
            <text size="xsmall" color="neutral-content-weak">
              {notesPage + 1} / {totalPages}
            </text>
            <hstack
              backgroundColor={notesPage < totalPages - 1 ? '#2b2b2b' : 'neutral-background-weak'}
              cornerRadius="small"
              padding="xsmall"
              onPress={() => { if (notesPage < totalPages - 1) setNotesPage(notesPage + 1); }}
            >
              <text size="xsmall" color="white">Next ▶</text>
            </hstack>
          </hstack>
        )}
      </vstack>
    );
  };

  // ── Render helper for handoffs ─────────────────────────────────────────────
  const renderHandoffs = () => {
    if (loadingHandoffs) {
      return (
        <vstack alignment="center middle" grow>
          <text color="neutral-content-weak">Loading handoffs…</text>
        </vstack>
      );
    }
    const handoffList = handoffs ?? [];
    if (handoffList.length === 0) {
      return (
        <vstack alignment="center middle" grow>
          <text size="xlarge">🔄</text>
          <text color="neutral-content-weak">No handoffs yet. Use "Generate Shift Handoff" from the subreddit menu.</text>
        </vstack>
      );
    }
    return (
      <vstack gap="small" grow>
        {handoffList.map((h) => (
          <vstack
            key={h.id}
            backgroundColor="neutral-background-weak"
            cornerRadius="medium"
            padding="small"
            gap="xsmall"
          >
            <hstack alignment="middle" gap="small">
              <text size="large">🔄</text>
              <vstack grow>
                <text weight="bold" size="small">
                  u/{h.writtenBy} · {timeAgo(h.createdAt)}
                </text>
              </vstack>
            </hstack>
            <text size="small" wrap color="neutral-content">
              {h.summary.slice(0, 120)}
            </text>
            {h.openItems.length > 0 && (
              <text size="xsmall" color="caution-plain">
                📌 {h.openItems.length} open item(s)
              </text>
            )}
            {h.watchUsers.length > 0 && (
              <text size="xsmall" color="danger-plain">
                👀 {h.watchUsers.length} watched user(s)
              </text>
            )}
          </vstack>
        ))}
      </vstack>
    );
  };

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  const tabs: { id: DashboardPage; label: string; icon: string }[] = [
    { id: 'watchlist', label: 'Watch List', icon: '👀' },
    { id: 'notes', label: 'Mod Notes', icon: '📝' },
    { id: 'handoffs', label: 'Handoffs', icon: '🔄' },
  ];

  return (
    <vstack height="100%" width="100%" backgroundColor="neutral-background">
      {/* Header */}
      <hstack
        backgroundColor="#2b2b2b"
        padding="small"
        alignment="middle"
        gap="small"
      >
        <text size="xlarge">🚔</text>
        <vstack grow>
          <text weight="bold" size="large" color="white">
            OfficialModRelay Dashboard
          </text>
          <text size="xsmall" color="white">
            r/{subredditName ?? '…'}
          </text>
        </vstack>
        <vstack alignment="end">
          <text size="xsmall" color="white">
            {(watchFlags ?? []).length} watched
          </text>
          <text size="xsmall" color="white">
            {(notes ?? []).filter((n) => !n.resolved).length} open / {(notes ?? []).length} total notes
          </text>
        </vstack>
      </hstack>

      {/* Tab bar */}
      <hstack backgroundColor="neutral-background-strong" gap="none">
        {tabs.map((tab) => (
          <hstack
            key={tab.id}
            grow
            alignment="center middle"
            padding="xsmall"
            backgroundColor={page === tab.id ? '#2b2b2b' : 'neutral-background-strong'}
            onPress={() => setPage(tab.id)}
          >
            <text
              size="small"
              weight={page === tab.id ? 'bold' : 'regular'}
              color={page === tab.id ? 'white' : 'neutral-content-weak'}
            >
              {tab.icon} {tab.label}
            </text>
          </hstack>
        ))}
      </hstack>

      {/* Content area */}
      <vstack grow padding="small" gap="small" overflow="auto">
        {page === 'watchlist' && renderWatchList()}
        {page === 'notes' && renderNotes()}
        {page === 'handoffs' && renderHandoffs()}
      </vstack>

      {/* Footer with refresh button */}
      <hstack
        backgroundColor="neutral-background-weak"
        padding="xsmall"
        alignment="center middle"
        gap="small"
      >
        <text size="xsmall" color="neutral-content-weak" grow>
          Use subreddit/post menus to add notes & flags · ModRelay v1.0
        </text>
        <hstack
          backgroundColor="#2b2b2b"
          cornerRadius="small"
          padding="xsmall"
          onPress={() => setRefreshTick(refreshTick + 1)}
        >
          <text size="xsmall" color="white">🔄 Refresh</text>
        </hstack>
      </hstack>
    </vstack>
  );
};

// Register the custom post type
Devvit.addCustomPostType({
  name: 'OfficialModRelay Dashboard',
  description: 'Live mod team dashboard: watch list, notes, and shift handoffs.',
  height: 'tall',
  render: ModRelayDashboard,
});

export default Devvit;
