export interface SourceImportEdge {
  source: string;
  target: string;
  specifier: string;
}

export function importsIn(source: string, fileName?: string): string[];
export function collectCodeFiles(root: string): string[];
export function scanImportGraph(root: string): {
  files: string[];
  edges: SourceImportEdge[];
};
