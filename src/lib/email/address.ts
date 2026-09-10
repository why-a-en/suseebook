import { promises as dns } from "node:dns";
import { ServiceError } from "@/services/types";

// Address validation that runs *before* we hand anything to Resend.
//
// Every credential email in this app is triggered by one person typing
// another person's address into a form — a new hire, a new Organization's
// Admin. A typo there (`name@gmial.com`) becomes a hard bounce, and Resend
// counts hard bounces against the whole domain's sender reputation. So the
// bar to clear before we send is "this address could plausibly receive
// mail", checked in two cheap layers — RFC-5322-ish syntax, then a DNS
// lookup for a mail exchanger. No SMTP probe (unreliable, and outbound
// port 25 is blocked on Vercel) and no paid verification API — overkill for
// an internal tool at this volume. See docs/adr/0006-transactional-email.md.

// Deliberately stricter than the spec permits: no quoted local parts, no IP
// literals, no consecutive dots, a real dotted domain. Those forms are legal
// but never what a colleague's work address looks like, and each one is a
// way for a bad value to slip through to the send step.
const SYNTAX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Known throwaway-inbox providers. These frequently *do* have valid MX, so
// the DNS layer never catches them — a blocklist is the only lever. Kept
// short on purpose; extend it when one gets through rather than pulling in a
// 30k-entry package.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mvrht.net",
]);

// A slow or flaky resolver must not hang a Server Action. If the lookup
// hasn't answered by here we fail closed — protecting Resend's reputation
// matters more than accepting an address we couldn't check.
const DNS_TIMEOUT_MS = 4000;

/** Trimmed and lower-cased — the form every caller and the DB should store. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Syntax only, no I/O. Shared with the services so their own guard and the
 * pre-send check can never disagree on what a well-formed address is.
 */
export function isValidEmailSyntax(email: string): boolean {
  return email.length <= 254 && email.split("@")[0].length <= 64 && SYNTAX.test(email);
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Does this domain publish a way to receive mail? An MX record is the
 * direct answer; RFC 5321 §5 also lets a bare A/AAAA record stand in as an
 * implicit MX, so we accept that too. A single MX of "." is RFC 7505's
 * "this domain sends no mail" — an explicit no.
 */
async function domainAcceptsMail(domain: string): Promise<boolean> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
    const usable = mx.filter((r) => r.exchange && r.exchange !== ".");
    if (usable.length > 0) return true;
    // Empty, or only a null-MX record: fall through to the A/AAAA check
    // only if it was genuinely empty; a null MX is a hard no.
    if (mx.length > 0) return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA") {
      // ESERVFAIL, our own DNS_TIMEOUT, anything else: we don't *know* it's
      // bad, and failing closed is the safe direction here.
      throw new ServiceError(
        "Couldn't verify that email's domain right now. Check the address and try again.",
      );
    }
  }

  try {
    const [v4, v6] = await Promise.allSettled([
      withTimeout(dns.resolve(domain), DNS_TIMEOUT_MS),
      withTimeout(dns.resolve6(domain), DNS_TIMEOUT_MS),
    ]);
    return (
      (v4.status === "fulfilled" && v4.value.length > 0) ||
      (v6.status === "fulfilled" && v6.value.length > 0)
    );
  } catch {
    return false;
  }
}

/**
 * Throws a `ServiceError` (shown to the Admin verbatim) unless `email` is
 * well-formed and its domain can receive mail. Call it in the action, before
 * the service creates anything — never inside a DB transaction, since the
 * DNS round-trip would hold a connection open.
 */
export async function assertDeliverableEmail(email: string): Promise<void> {
  if (!email) throw new ServiceError("Email is required.");
  if (!isValidEmailSyntax(email)) throw new ServiceError("Enter a valid email address.");

  const domain = domainOf(email);
  if (DISPOSABLE_DOMAINS.has(domain)) {
    throw new ServiceError("Use a permanent email address, not a disposable one.");
  }

  if (!(await domainAcceptsMail(domain))) {
    throw new ServiceError(
      `That email's domain (${domain}) can't receive mail — check the spelling.`,
    );
  }
}
