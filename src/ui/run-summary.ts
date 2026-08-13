import type { ElementDef } from "../core/types";

export const MAX_SHARED_INVENTIONS = 5;

export interface InventionSummary {
  total: number;
  names: string[];
}

export function summarizeInventions(
  elements: readonly ElementDef[],
): InventionSummary {
  const inventions = elements.filter(
    (element) => element.origin === "improvised",
  );
  return {
    total: inventions.length,
    names: inventions
      .slice(0, MAX_SHARED_INVENTIONS)
      .map((element) => element.name),
  };
}

export function inventionSummaryText(summary: InventionSummary): string {
  if (summary.total === 0) return "No inventions this life.";
  const omitted = summary.total - summary.names.length;
  return `Karl's inventions: ${summary.names.join(", ")}${
    omitted > 0 ? ` +${omitted} more` : ""
  }`;
}
