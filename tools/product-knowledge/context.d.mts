import type {
  ProductCapability,
  ProductScenario,
} from "./validate.mjs";
import type { ProductGraphEdge } from "./export.mjs";

export interface ProductContextPack {
  query: string;
  capabilityIds: string[];
  product: {
    promise: string;
    primaryPurpose: string;
    northStar: string;
    hardBoundaries: string[];
    openDecisions: string[];
  };
  capabilities: ProductCapability[];
  scenarios: ProductScenario[];
  relatedCapabilities: Array<{
    id: string;
    name: string;
    purpose: string;
  }>;
  principles: Array<{
    id: string;
    label: string;
    text: string;
  }>;
  nodeIds: string[];
  graphEdges: ProductGraphEdge[];
  sourceFiles: string[];
  contentFiles: string[];
  testFiles: string[];
  text: string;
}

export function compileProductContext(options?: {
  root?: string;
  query?: string;
  capabilityId?: string | null;
  maxCapabilities?: number;
}): ProductContextPack;
export function assertContextArtifactsCurrent(
  root: string,
  graphText: string,
  metadataText: string,
): void;
