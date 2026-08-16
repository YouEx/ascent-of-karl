export interface ProductGraphNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  [key: string]: unknown;
}

export interface ProductGraphEdge {
  source: string;
  target: string;
  relation: string;
  provenance: string;
  [key: string]: unknown;
}

export interface ProductGraph {
  schemaVersion: number;
  directed: true;
  authority: string;
  nodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
}

export interface ProductGraphArtifacts {
  graph: ProductGraph;
  graphText: string;
  metadataText: string;
}

export const GRAPH_PATH: string;
export const METADATA_PATH: string;
export function assertArtifactCurrent(
  actual: string,
  expected: string,
  label: string,
): void;
export function productGraphArtifacts(root?: string): ProductGraphArtifacts;
export function writeProductGraph(root?: string): ProductGraphArtifacts;
