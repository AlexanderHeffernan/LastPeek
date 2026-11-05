import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Unknown paths always require the full pipeline. Markdown in src/static is
// application input, not documentation, and must not bypass verification.
export function documentationOnly(paths) {
  return paths.every((path) => /^(?:[^/]+\.md|docs\/.*\.md)$/.test(path));
}

// Only isolated public-page inputs qualify. Shared CSS/layouts, routes, server
// code, tests, dependencies and tooling deliberately fall back to the full gate.
export function releaseProfile(paths) {
  const application = paths.filter((path) => !documentationOnly([path]));
  return application.length > 0 &&
    application.every((path) =>
      /^(?:src\/lib\/components\/landing\/[^/]+\.(?:svelte|ts)|static\/landing\/.+)$/.test(
        path,
      ),
    )
    ? "landing"
    : "full";
}

export function changedPaths(base, head) {
  return execFileSync(
    "git",
    [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      ...(head ? [head] : []),
    ],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "plan") {
    const base = process.argv[3];
    const paths =
      base && !/^0+$/.test(base) ? changedPaths(base, "HEAD") : null;
    const runtime = paths === null || !documentationOnly(paths);
    // The newest push may sit on earlier failed/unpublished application work.
    // Only narrow the gate when the live baseline is known and an ancestor.
    let profile = "full";
    const deployed = process.env.RELEASE_BASE_SHA;
    if (runtime && paths && /^[a-f0-9]{40}$/.test(deployed || "")) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", deployed, "HEAD"]);
        profile = releaseProfile([...paths, ...changedPaths(deployed, "HEAD")]);
      } catch {
        console.error(
          "Unknown deployed baseline; requiring the full release gate",
        );
      }
    }
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const version = lock.packages["node_modules/playwright"].version;
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new Error("Playwright must have a stable, locked image version");
    console.log(
      `runtime=${runtime}\nplaywright=${version}\nprofile=${profile}`,
    );
  } else if (process.argv[2] === "promote") {
    const candidate = process.argv[3];
    execFileSync("git", [
      "merge-base",
      "--is-ancestor",
      candidate,
      "origin/main",
    ]);
    const promote = documentationOnly(changedPaths(candidate, "origin/main"));
    console.log(`promote=${promote}`);
    if (!promote)
      console.error(
        "Superseded by a newer application commit; leaving latest unchanged",
      );
  } else {
    throw new Error("Use release-policy.mjs plan [base] or promote <commit>");
  }
}
