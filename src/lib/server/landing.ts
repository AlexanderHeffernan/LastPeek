import type { Cookies } from "@sveltejs/kit";
import { devSignIn } from "$lib/server/auth";
import { xAuthEnabled } from "$lib/server/x-auth";
import {
  linkedinAuthAvailable,
  linkedinAuthConfigured,
} from "$lib/server/linkedin-auth";

// Signed-out visitors see the landing page at /, /login and invitation links.
export async function landing(cookies: Cookies) {
  return {
    landing: true as const,
    // The cosmetic theme cookie is only written after signing in on this browser.
    returning: cookies.get("lastpeek_theme") !== undefined,
    xEnabled: xAuthEnabled(),
    linkedinEnabled:
      linkedinAuthConfigured() && (await linkedinAuthAvailable(null)),
    devSignIn: devSignIn(),
  };
}
