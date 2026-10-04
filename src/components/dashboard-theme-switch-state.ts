import type { ThemePreference } from "@/lib/theme";

export function resolvesToDark(preference: ThemePreference, systemDark: boolean): boolean {
  return preference === "dark" || (preference === "system" && systemDark);
}
