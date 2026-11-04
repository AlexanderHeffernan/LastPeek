// Native account forms require an Origin; capability-bearing pages must not leak referrers.
export function referrerPolicy(routeId: string | null, signedIn: boolean) {
  if (routeId === "/") return signedIn ? "no-referrer" : "strict-origin";
  return [
    "/login",
    "/join/[token]",
    "/(app)/settings",
    "/(app)/drafts/[id]",
    "/(app)/notifications",
    "/(app)/feedback",
    "/oauth/authorize",
  ].includes(routeId ?? "")
    ? "strict-origin"
    : "no-referrer";
}
