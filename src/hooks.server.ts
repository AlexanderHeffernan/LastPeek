import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { sessionUser } from "$lib/server/auth";
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await sessionUser(event);
  const response = await resolve(event);
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Native account forms need a non-null Origin for CSRF checks, even before hydration.
  // Send only the origin on these pages; review capabilities keep no-referrer.
  response.headers.set(
    "Referrer-Policy",
    ["/login", "/join/[token]", "/(app)/settings"].includes(
      event.route.id ?? "",
    )
      ? "strict-origin"
      : "no-referrer",
  );
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
