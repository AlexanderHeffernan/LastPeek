export const themes = ["auto", "dark", "light"] as const;
export type Theme = (typeof themes)[number];

export function themePreference(value: unknown): Theme {
  return themes.includes(value as Theme) ? (value as Theme) : "auto";
}
