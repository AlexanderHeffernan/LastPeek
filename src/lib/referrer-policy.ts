// Native account forms require an Origin; capability-bearing pages must not leak referrers.
export function referrerPolicy(routeId: string | null) {
  return [
    "/login",
    "/join/[token]",
    "/(app)/settings",
    "/(app)/drafts/[id]",
  ].includes(routeId ?? "")
    ? "strict-origin"
    : "no-referrer";
}
