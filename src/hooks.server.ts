import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { sessionUser } from "$lib/server/auth";
import { referrerPolicy } from "$lib/referrer-policy";
import { db } from "$lib/server/db";
import { deliverPush } from "$lib/server/notifications";
import { syncXCredits } from "$lib/server/x-usage";
import { recordBrowserSession } from "$lib/server/browser-sessions";
import { themePreference } from "$lib/theme";
export function init() {
  const timer = setInterval(() => {
    void deliverPush().catch(() =>
      console.error("Notification delivery unavailable"),
    );
  }, 10000);
  timer.unref();
  let syncing = false;
  const credits = setInterval(() => {
    if (syncing) return;
    syncing = true;
    void syncXCredits()
      .catch(() => console.error("X credit reconciliation unavailable"))
      .finally(() => {
        syncing = false;
      });
  }, 300000);
  credits.unref();
}
export const handle: Handle = async ({ event, resolve }) => {
  const contentType =
    event.request.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase() ?? "";
  // OAuth clients exchange PKCE-bound codes without a browser Origin or cookie.
  // Keep every other form protected, including forms with missing/opaque origins.
  if (
    event.url.pathname !== "/oauth/token" &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(event.request.method) &&
    [
      "",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
      "text/plain",
    ].includes(contentType) &&
    event.request.headers.get("origin") !== event.url.origin
  )
    return new Response(
      `Cross-site ${event.request.method} form submissions are forbidden`,
      { status: 403 },
    );
  event.locals.user = await sessionUser(event);
  if (event.locals.user && event.locals.pushSession)
    await recordBrowserSession(
      event.locals.pushSession,
      event.locals.user.id,
      event.request.headers.get("user-agent"),
    );
  if (event.locals.user)
    await db.query(
      `UPDATE users SET last_seen_at=now() WHERE id=$1
       AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
      [event.locals.user.id],
    );
  // Keep the last account choice on sign-in/review pages and the offline screen.
  // This cosmetic cookie contains no account identity or authority.
  if (
    event.locals.user &&
    event.cookies.get("lastpeek_theme") !== event.locals.user.theme
  )
    event.cookies.set("lastpeek_theme", event.locals.user.theme, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: event.url.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace(
        'data-theme="auto"',
        `data-theme="${themePreference(event.locals.user?.theme ?? event.cookies.get("lastpeek_theme"))}"`,
      ),
  });
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Native account forms need a non-null Origin for CSRF checks, even before hydration.
  // Send only the origin on these pages; review capabilities keep no-referrer.
  response.headers.set("Referrer-Policy", referrerPolicy(event.route.id));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (!event.url.pathname.startsWith("/_app/"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
};
export const handleError: HandleServerError = ({ error, kind }) => {
  // Kit 3 also calls this hook for deliberate 4xx errors. Keep their safe, actionable messages.
  if (kind !== "unknown") return;
  const id = crypto.randomUUID();
  // Deliberately omit URLs, tokens, bodies and database exception details.
  console.error(
    "LastPeek request failed",
    id,
    error instanceof Error ? error.name : "UnknownError",
  );
  return { message: `Something went wrong. Try again. Reference: ${id}` };
};
