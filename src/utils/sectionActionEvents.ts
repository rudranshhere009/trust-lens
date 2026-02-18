export const SECTION_ACTION_EVENT = "trustlens:section-action";

export interface SectionActionDetail {
  tab: string;
  mode: "legal" | "compliance" | "truthdesk";
  action: string;
}

export const isSectionActionDetail = (value: unknown): value is SectionActionDetail => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.tab === "string" && typeof v.mode === "string" && typeof v.action === "string";
};
