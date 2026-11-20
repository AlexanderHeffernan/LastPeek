import type { Content } from "$lib/contracts";

/** Group only the versions in this queue; a posted X must not hide an unfinished LinkedIn. */
export function groupDraftVersions<
  T extends {
    id: string;
    related_id: string | null;
    content: Content;
    updated_at: string;
  },
>(drafts: T[]) {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const seen = new Set<string>();
  return drafts
    .flatMap((draft) => {
      if (seen.has(draft.id)) return [];
      const counterpart = draft.related_id
        ? byId.get(draft.related_id)
        : undefined;
      const versions = counterpart ? [draft, counterpart] : [draft];
      versions.sort(
        (a, b) =>
          Number(a.content.platform === "linkedin") -
          Number(b.content.platform === "linkedin"),
      );
      for (const version of versions) seen.add(version.id);
      return [
        {
          ...versions[0],
          updated_at: versions.reduce(
            (latest, version) =>
              version.updated_at > latest ? version.updated_at : latest,
            draft.updated_at,
          ),
          versions,
        },
      ];
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
