# PANDA

PANDA is a mobile-first social-network starter built with Next.js App Router, TypeScript, Tailwind CSS, Supabase, and Zod. Its interface uses an original panda mark and a charcoal, soft-white, and cyan palette.

## What works in this starter

- Responsive Home, Explore, Feed, Reels, Messages, Notifications, Profile, and Settings screens. Feed and Reels are separate, refresh-safe routes in the shared sidebar.
- An authenticated profile editor that saves username, display name, bio, account privacy, and a private profile photo. Follower and following counts and the profile's posts are loaded from Supabase.
- Light, dark, and system theme preferences, saved locally with an early theme initialization to reduce first-paint flicker.
- Persisted one-to-one messaging UI with username search, conversation history, realtime message updates, private media attachments, hide controls, and best-effort WebRTC audio/video calling.
- A separate Hidden Inbox opened by a user-configured Secret Code; the code is stored as a salted PBKDF2 hash, attempts are rate-limited, and per-conversation access remains grant- and RLS-protected.
- Database-backed public/private profiles, follow relationships, pending private-account requests, accept/decline controls, and follower/following lists. Feed reads paginated posts through Supabase RLS; Reels reads video posts only. Likes and comments are persisted. Bookmarks and post creation are not connected to the database and are disabled in the interface.
- Database-backed Stories with private media, 24-hour database-enforced expiry, private-account/follower authorization, one-time viewer records, reactions, and owner-only viewer lists and deletion.
- Accessible username/password sign-up and sign-in forms with Zod validation and Supabase Auth wiring. End-to-end authentication requires the server configuration below and is not verified by the local unit tests.
- Case-insensitive username reservations enforced by a database trigger; names stay reserved after a profile rename or account deletion.
- Server-side username-to-Supabase-Auth mapping. Passwords are verified by Supabase Auth and never stored by PANDA; the service-role key is server-only.
- A first database migration with profile, follow, post, messaging, notification, block, report, and private-storage tables/policies.

Account privacy, profile discovery, follow relationships, private-account requests, and follower/following lists are database-backed and protected by RLS. Explore discovers actual accounts; post discovery is unavailable, so use Feed to browse published content. Feed, Reels, Stories, profile posts, and notification reads use actual Supabase records and private-bucket signed URLs where applicable. Notifications can display and mark existing rows as read, but this repository does not currently generate activity notification rows. Post creation and bookmarks remain unavailable and are disabled in the interface. Story replies are not connected to messaging. Sharing uses the browser's native share sheet when available, with a copy-link fallback. Real browser-based two-account media and UI flows still need manual verification. Calls use WebRTC with a public STUN server only; a TURN relay and server-side short-lived TURN credentials are needed for reliable calls across restrictive networks.

## Requirements

- Node.js 20.9 or newer (the project was scaffolded using Node.js 24).
- A Supabase project to enable registration and login.

## Run locally

From the project root in PowerShell:

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). The social UI works in preview mode; this local setup does not verify authentication.

## Configure Supabase

1. Create a Supabase project.
2. Start or use a local Supabase environment and apply only pending migrations with `npx supabase migration up --local`. The current migration sequence includes the initial schema, username authentication/reservations, Hidden Chats and messaging, security/follow-policy hardening, [`supabase/migrations/20261101154000_account_privacy_and_follows.sql`](./supabase/migrations/20261101154000_account_privacy_and_follows.sql), [`supabase/migrations/20261101155000_private_profile_discovery.sql`](./supabase/migrations/20261101155000_private_profile_discovery.sql), [`supabase/migrations/20261101160000_private_account_messaging.sql`](./supabase/migrations/20261101160000_private_account_messaging.sql), [`supabase/migrations/20261101161000_secret_code_hidden_inbox.sql`](./supabase/migrations/20261101161000_secret_code_hidden_inbox.sql), [`supabase/migrations/20261101162000_profile_connection_lists.sql`](./supabase/migrations/20261101162000_profile_connection_lists.sql), [`supabase/migrations/20261101163000_stories.sql`](./supabase/migrations/20261101163000_stories.sql), [`supabase/migrations/20261101164000_story_feed_pagination.sql`](./supabase/migrations/20261101164000_story_feed_pagination.sql), [`supabase/migrations/20261101165000_story_feed_argument_guards.sql`](./supabase/migrations/20261101165000_story_feed_argument_guards.sql), and [`supabase/migrations/20261101166000_story_media_cleanup_queue.sql`](./supabase/migrations/20261101166000_story_media_cleanup_queue.sql). Do not use a reset command against an initialized database. Run the SQL regression files in `supabase/tests/` against local Supabase. The username migration is additive: it seeds reservations for existing profiles, normalizes their usernames to lowercase, and retains usernames after later renames or account deletion.
3. Set the Project URL and publishable key from **Project Settings → API** in `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   The publishable key is intended for browser use. The server-side username lookup, account-creation, Hidden Chats PIN, Secret Code, and Stories publishing/cleanup routes also require a separately configured `SUPABASE_SERVICE_ROLE_KEY`; do not add that secret to browser code, prefix it with `NEXT_PUBLIC_`, or share it.
4. In **Authentication → URL Configuration**, set the site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` and `http://localhost:3000/reset-password` as redirect URLs.
5. Keep Supabase password authentication enabled. New username-only accounts are created server-side with an internal `@users.panda.invalid` Auth identity and marked confirmed; no confirmation email is sent. The profile trigger claims each username in the permanent reservation table. Existing Auth identities and account data are not deleted.
6. Restart the dev server after changing environment variables.

Registration asks for a unique username, display name, password, password confirmation, and an explicit Public or Private account choice. Availability checks are advisory; the PostgreSQL reservation trigger decides the claim atomically, including simultaneous signup or rename attempts. Login accepts only username and password. After a username change, sign-in resolves the new profile username to the existing Auth user and verifies the password against that user's existing internal Auth identity. The server-side service-role key is never sent to the browser. The username-auth migration also provides a database-backed limit of 8 attempts per username and 20 per client address per 15-minute window.

Existing accounts keep their current Auth identities and can sign in using the normalized username stored on their profile. Apply the additive rate-limit and username-reservation migrations to enable those database workflows. Username ownership from accounts deleted before the reservation migration cannot be reconstructed; the migration reserves usernames belonging to profiles that still exist when it is applied. The Auth callback remains for recovery links sent to existing accounts that have a real, verified recovery address.

New username-only accounts have no verified recovery address, so password recovery is not available for them yet. The recovery screen accepts a username and only sends a recovery link when the account already has a real recovery address. Establish a verified recovery method before relying on password reset for new accounts.

## Privacy and unfinished workflows

- Media buckets are private. Public post media is readable only when the corresponding post is readable; private-post media requires an authenticated approved follower. Message media is limited to conversation participants. Story media is authorized against its active, visible story row.
- The service-role credential is used only by server-side username-auth routes and is never sent to browser code. No secret belongs in `.env.local` committed to source control.
- Account privacy updates are sent through an origin-checked server route using the authenticated publishable-key Supabase client; profile RLS independently restricts updates to the signed-in user's own profile. Follow-table writes are restricted to authenticated RPCs that validate self-follow, blocks, privacy, request ownership, and duplicate state.
- Explore uses a bounded `discover_profiles` RPC so private accounts can receive follow requests without exposing their bio, avatar, posts, or other private profile data. Blocked accounts are excluded; full profile and post reads remain subject to RLS.
- Messaging a private account requires an approved follow relationship. Pending or declined requests cannot create or send in a conversation; this is enforced for conversation creation, existing conversation reads, message mutations, attachments, storage media, and Realtime call topics. Changing an account to private preserves conversation history but hides it from unapproved participants until follow approval.
- Story expiry is enforced in database reads and storage access at `expires_at`; expired story media is inaccessible even if the object remains stored. To remove expired rows and files, configure a strong server-only `STORIES_CLEANUP_SECRET` and schedule `POST /api/stories/cleanup` with `Authorization: Bearer <secret>` (the repository does not configure a scheduler). The endpoint handles at most 100 records per request and leaves failed cleanups for a later retry.
- The messaging migration adds an authenticated direct-conversation RPC, message attachment policies, private profile-avatar storage, call-signal RLS, and Realtime publication setup. These migrations and SQL policies have been checked against the configured local PostgreSQL database; the actual Storage API and full two-browser flows still need manual verification.
- Username reservation rows have no foreign key to `auth.users`, are inaccessible to `anon` and `authenticated` roles, and are written only by a database trigger. The availability RPC reveals only whether a normalized name can be claimed; it does not expose reservation owners. Run [`supabase/tests/username_reservations.sql`](./supabase/tests/username_reservations.sql) against a local or staging project after applying the migrations. It rolls back its fixture account rows. A true two-session race test still requires a database integration environment.
- Hidden Chats has per-user hide/unhide controls for persisted conversations, a PIN-gated section, and server-side PIN hashing and rate limits. PINs are 6–12 digits, hashed server-side with PBKDF2-HMAC-SHA-256 (600,000 iterations) and a per-PIN random salt. The optional Secret Code is configured in Settings after setting a PIN; it opens the separate Hidden Inbox and is stored as a salted hash. Five verification attempts are allowed per 15-minute window. Listing and conversation grants expire within five minutes, and the conversation grant cannot outlive an active listing grant. Changing the code requires the PIN and revokes existing grants.
- [`supabase/tests/secret_code_hidden_inbox.sql`](./supabase/tests/secret_code_hidden_inbox.sql) checks Secret Code credential isolation, service-role-only rate limiting and listing, multiple hidden conversations, listing-versus-conversation grant scope, grant expiry, read counts, and grant invalidation after changing the code.
- End-to-end encryption, message requests, voice recording, push notifications, blocking/report review operations, and disappearing-media view limits/timers are **not implemented**. The disappearing-media tables alone do not enforce secure view counts or expiry, so do not use them to deliver view-limited media.
- Audio/video calls use browser WebRTC peer connections and authenticated private Realtime broadcast signaling. Calls require the messaging migration, the app to be open for both users, browser media permissions, and compatible network paths. STUN-only connectivity is best-effort; configure a TURN provider and server-issued expiring credentials before relying on calls across NAT/firewall-restricted networks. Background/push ringing is not implemented.
- Private chat attachments and profile photos use short-lived signed URLs; do not make their storage buckets public. Test access as authorized and unauthorized users before deployment.
- The preview's sample photos are loaded from Unsplash; provide your own licensed media for a production deployment.

## Checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The Vitest suite covers input validation and related pure logic. [`supabase/tests/security_regressions.sql`](./supabase/tests/security_regressions.sql), [`supabase/tests/hidden_chats.sql`](./supabase/tests/hidden_chats.sql), [`supabase/tests/secret_code_hidden_inbox.sql`](./supabase/tests/secret_code_hidden_inbox.sql), and [`supabase/tests/username_reservations.sql`](./supabase/tests/username_reservations.sql) are SQL integration checks run against local PostgreSQL with authenticated/anonymous roles and JWT claims. They do not replace manual browser testing of two distinct accounts or Storage API upload/download behavior.

## Deploy to Vercel

1. Push the project to a Git provider and import it into Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel's environment settings for Preview and Production. The service-role key must remain server-only and must not have the `NEXT_PUBLIC_` prefix.
3. After validating every migration against a disposable local or staging project, deploy the migrations in the documented order only with explicit approval. Update the Auth site URL/redirect allowlist to include your production domain and `https://your-domain/auth/callback`, plus `https://your-domain/reset-password`.
4. Deploy and smoke-test new account registration, username sign-in (including an existing account), account privacy changes, and two-account follow requests. Feed posts, likes, comments, and notifications remain preview workflows.

`vercel.json` identifies the project as a Next.js deployment. The Vercel build command is `npm run build`.
