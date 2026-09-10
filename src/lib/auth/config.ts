import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { admin } from "better-auth/plugins/admin";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sendInvitationEmail } from "@/lib/email/send";
import { hashPassword, verifyPassword } from "./hash";

// Display label for a member role. Inlined rather than imported from
// src/lib/auth/index.ts — that file imports this one.
const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  support_agent: "Support Agent",
  supplier: "Supplier",
};

// The single better-auth instance. See docs/plans/better-auth-migration.md
// and docs/adr/0002-multi-tenancy-mvp.md for why this replaced the
// self-rolled auth in this directory.
//
// Feature code must never import this file. It calls requireUser() /
// withCurrentOrganization() instead — that indirection is what keeps a
// future swap (to Cognito, or anything else) a two-file change rather than
// a rewrite. See ARCHITECTURE_ROADMAP.md §1.
// Explicit BETTER_AUTH_URL wins; on Vercel fall back to the stable
// production domain, then the per-deployment URL, so a deploy works without
// hardcoding anything. (This app never mounts better-auth's HTTP handler —
// see the note in src/lib/auth — so baseURL only matters for the library's
// own internal URL building, not for browser CSRF/redirects.)
function resolveBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

export const auth = betterAuth({
  baseURL: resolveBaseURL(),
  secret: process.env.BETTER_AUTH_SECRET,

  // usePlural covers every table name at once — our schema exports `users`,
  // `sessions`, `organizations`, `accounts`, `members`, `invitations` and
  // `verifications`, which are exactly better-auth's singular model names
  // pluralised. No per-model `modelName` mapping needed.
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: true,
  }),

  advanced: {
    database: {
      // better-auth's own default emits text ids. Ours are `uuid` columns
      // everywhere, referenced by every tenant table's organization_id and
      // by products.created_by / orders.created_by — and the RLS policies
      // cast `current_setting('app.organization_id')::uuid`. Generating
      // UUIDs keeps all of that working untouched, instead of converting
      // every key and policy in the schema to text.
      generateId: "uuid",
    },
  },

  databaseHooks: {
    session: {
      create: {
        // Stamp the active Organization at sign-in. Without this a new
        // session carries a null activeOrganizationId, getCurrentUser()
        // resolves to null, and the app bounces straight back to /login.
        //
        // Picking the oldest membership is arbitrary but deterministic; a
        // user in more than one Organization changes it with the switcher.
        before: async (session) => {
          const [membership] = await db
            .select({ organizationId: schema.members.organizationId })
            .from(schema.members)
            .where(eq(schema.members.userId, session.userId))
            .orderBy(schema.members.createdAt)
            .limit(1);

          return {
            data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
          };
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    // One place for the rule, rather than each caller inventing its own.
    minPasswordLength: 8,
    // Keeps the existing argon2 hashes working, so migrating users never see
    // a forced password reset. better-auth's own default is scrypt; ours
    // stays argon2id (hash.ts) and the stored hashes move across verbatim.
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },

  session: {
    // Removes the per-request Postgres round-trip that getSessionUser() used
    // to make on every single request — the single biggest latency win in
    // this migration for a user on a Myanmar mobile network.
    //
    // The cost: revocation is not instant. A suspended Organization's staff
    // keep working until this expires. Five minutes is the deliberate
    // trade-off, not a default we inherited.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  plugins: [
    organization({
      schema: {
        organization: {
          additionalFields: {
            // Pre-dates better-auth; drives suspension. `input: false` keeps
            // it out of the plugin's own create/update payloads — status is
            // ours to set, not something an org admin can send.
            status: { type: "string", input: false },
          },
        },
      },

      // Stores are provisioned by a Platform Admin, never self-created by a
      // tenant user (ADR-0005 §1). This closes the plugin's own create path.
      allowUserToCreateOrganization: async () => false,

      // Joining a Store is by invitation (ADR-0005 §6, ADR-0006). A link is
      // valid for 7 days; re-inviting the same address supersedes the old
      // one rather than leaving two live.
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,

      // The plugin creates the `invitations` row, then calls this to deliver
      // the link. A throw here propagates to the caller (the Admin's action),
      // which tells them to use Resend — the row is already committed
      // (ADR-0006 §5). Kept out of any service transaction by construction:
      // the plugin fires it after its own write.
      sendInvitationEmail: async (data) => {
        await sendInvitationEmail({
          to: data.email,
          storeName: data.organization.name,
          roleLabel: ROLE_LABEL[data.role] ?? data.role,
          token: data.id,
          inviterName: data.inviter.user.name,
        });
      },
    }),

    // Platform-level administration, which is us — not a tenant role. The
    // functional roles (support_agent / supplier) live on `members`.
    // Two separate axes; see the migration plan §3.
    admin({
      // Allowlist rather than a populated user.role column: fewer moving
      // parts, and no in-app path to granting yourself platform admin.
      adminUserIds: (process.env.PLATFORM_ADMIN_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    }),

    // Must stay last — it flushes Set-Cookie headers from Server Actions.
    nextCookies(),
  ],
});
