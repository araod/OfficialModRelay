🚔 **OfficialModRelay - Mod Team Escalation & Shift Handoff Tool**


---

**What is OfficialModRelay?**

OfficialModRelay is a Devvit-powered mod team CRM (Customer Relationship Manager) that solves the **#1 coordination problem** for large subreddit mod teams: *information dying when a shift ends.*

Right now, when a mod signs off, there's no native Reddit way to:
- Tell the next mod who to watch out for
- Leave notes on specific users and posts that all mods can see
- Auto-generate a structured handoff so nothing falls through the cracks

OfficialModRelay fills that gap entirely.

---

**Features**

👀 **Watch Flags**
Flag problem users with four escalation levels:
| Level | Meaning |
|-------|---------|
| 🟡 Low | Minor concern, keep an eye |
| 🟠 Medium | Recurring issues |
| 🔴 High | Serious repeat offender |
| 🚨 Critical | Imminent ban / safety concern |

- Set optional auto-expiry (24h, 7 days, 30 days)
- Automatically logs a note when a flag is set or cleared
- Cleared flags are archived (not deleted) for full audit trail

📝 **Mod Notes**
Leave structured notes on **users** and **posts**:
- Categories: General, Rule Violation, Escalation, Ban Warning, Positive/Resolved, Shift Note
- Notes persist in Redis — visible to all mods, all shifts
- Each note has a unique ID for easy resolving
- Notes show: author mod, time ago, target, category icon

🔄 **Shift Handoff Generator**
One click generates a full handoff:
- Mod writes a shift summary + manual open items
- App **auto-compiles** all unresolved notes + active watch flags
- Posts a distinguished mod post to the subreddit
- Handoff is also stored in Redis so the dashboard can surface the last 3

📊 **Live Dashboard (Custom Post)**
A pinned interactive dashboard post showing:
- **Watch List tab** – all active watch flags with level, reason, flagging mod
- **Mod Notes tab** – 30 most recent notes, resolved/unresolved status, note IDs
- **Handoffs tab** – last 3 shift handoffs with summaries and open item counts

---

**How Mods Use It**

   **During a shift:**
1. See a problem user on a post → **Post menu → "🚨 OfficialModRelay: Flag User for Watch"**
2. Need to leave context on a post → **Post menu → "📝 OfficialModRelay: Add Note to Post"**
3. Need to note something about a user → **Post menu → "👤 OfficialModRelay: Add Note to Post Author"**

**At end of shift:**
5. **Subreddit menu → "🔄 OfficialModRelay: Generate Shift Handoff"** → type summary → post is auto-created

**Any time:**
6. **Subreddit menu → "📊 OfficialModRelay: Open Dashboard"** → pinned post with live data
7. **Subreddit menu → "✅ OfficialModRelay: Clear User Watch Flag"** → clear a resolved situation
8. **Dashboard → Mod Notes tab → tap "✔ Resolve"** on any note to resolve it directly

---

  **Project Impact**

  **Communities that would benefit immediately:**
1. **r/AskReddit** (34M+ members) – Massive mod team across timezones. Shift handoffs are a constant coordination challenge.
2. **r/worldnews** (32M+ members) – Fast-moving news events require rapid escalation of bad actors across shifts.
3. **r/gaming** (39M+ members) – Regular drama events, ban waves, and watch-listed users need cross-mod tracking.

   **Time savings estimate:**
- Average large subreddit mod spends **15–30 minutes per shift** on "catch-up" from reading modmail and mod logs.
- OfficialModRelay's handoff post + dashboard reduces this to **2–3 minutes** of reading.
- Watch flags eliminate duplicated work where multiple mods unknowingly handle the same user.

---

  **Technical Architecture**

```
modrelay/
├── devvit.yaml          # App name & version
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx         # All Devvit menu items, forms, custom post component
    ├── types.ts         # TypeScript types + Redis key helpers
    └── redis-helpers.ts # All Redis read/write operations
```

   **Data Model (Redis)**

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `modrelay:notes:{sub}` | Sorted Set (score=createdAt) | All mod notes |
| `modrelay:watchflags:{sub}` | Hash (field=username) | All watch flags |
| `modrelay:handoffs:{sub}` | Sorted Set (score=createdAt) | Shift handoffs |
| `modrelay:lasthandoffpost:{sub}` | String | Last handoff post ID |

   **Devvit APIs Used**
- `Devvit.addMenuItem` – 7 menu items across post and subreddit contexts
- `Devvit.createForm` – 6 interactive forms for data entry
- `Devvit.addCustomPostType` – Live dashboard with 3-tab navigation
- `context.redis` – All persistent storage (sorted sets, hashes, strings)
- `context.reddit` – Post submission, user resolution, post distinguishing
- `useState` / `useAsync` – Reactive dashboard state

---

 **Installation (Developers)**

```bash
# Prerequisites: Node.js 18+, devvit CLI
npm install -g devvit

# Clone and install
git clone <your-repo>
cd officialmodrelay
npm install

# Authenticate
devvit login

# Upload to Reddit Developer Platform
devvit upload

# Test in your dev subreddit
devvit dev
```

   **Installation (Moderators)**

1. Go to [developers.reddit.com](https://developers.reddit.com)
2. Search for **OfficialModRelay**
3. Click **Install** and select your subreddit
4. Go to your subreddit → click **"📊 OfficialModRelay: Open Dashboard"** from the subreddit menu to create your pinned dashboard post

---

   **Devvit Rules Compliance**

- ✅ No external HTTP calls (all data stays in Reddit's Redis)
- ✅ Moderator-only menu items (`forUserType: 'moderator'`)
- ✅ No user data collected beyond what mods explicitly enter
- ✅ No automated moderation actions — all actions are mod-initiated
- ✅ No spam or unsolicited messaging

---

  **Roadmap (Post-Hackathon)**

- [ ] Modmail integration – link notes to modmail threads
- [ ] Discord webhook notifications for critical-level watch flags
- [ ] Note search by username across the dashboard
- [ ] Weekly digest auto-post (scheduled job)
- [ ] Reddit Developer Funds milestone tracking

---

*Built for the Reddit Mod Tools & Migrated Apps Hackathon 2026*  
