export interface ProductLifecycle {
  current: string;
  target: string;
  advancementGate: string;
}

export interface ProductOwnershipHints {
  sourceEntrypoints: string[];
  contentEntrypoints: string[];
  testEntrypoints: string[];
}

export interface ProductCapability {
  id: string;
  name: string;
  purpose: string;
  playerOutcome: string;
  currentTruth: string;
  approvedTarget: string;
  qualitativeAcceptance: string[];
  lifecycle: ProductLifecycle;
  dependencies: string[];
  semanticEvents: string[];
  ownershipHints: ProductOwnershipHints;
  searchTerms: string[];
}

export interface ProductManifest {
  schemaVersion: number;
  authority: string;
  product: {
    name: string;
    promise: string;
    primaryPurpose: string;
    northStar: string;
    completionDefinition: string[];
    hardBoundaries: string[];
    openDecisions: string[];
    crossCutting: Record<string, string>;
    currentArchitecture: string[];
    targetArchitecture: string[];
    authorityAnchors: string[];
  };
  lifecycleStates: string[];
  capabilities: ProductCapability[];
}

export interface ProductScenario {
  id: string;
  capabilities: string[];
  actor: string;
  trigger: string;
  playerJob: string;
  intendedOutcome: string;
  primaryAction: {
    kind: string;
    label: string | null;
    destination: string | null;
  };
  currentBehavior: string;
  targetBehavior: string;
  adjacentScenarios: {
    previous: string[];
    next: string[];
  };
  semanticEvent: string;
  evidenceSources: string[];
}

export interface ProductRelation {
  source: string;
  target: string;
  relation: string;
  rationale: string;
  provenance: "CURATED";
}

export interface KnownAnswer {
  id: string;
  question: string;
  expectedCapabilities: string[];
  requiredNodes: string[];
  requiredSources: string[];
  requiredTerms: string[];
}

export interface ProductContractData {
  capabilities: ProductManifest;
  scenarios: {
    schemaVersion: number;
    capabilityContract: string;
    scenarios: ProductScenario[];
  };
  relations: {
    schemaVersion: number;
    edges: ProductRelation[];
  };
  events: {
    schemaVersion: number;
    storageKey: string;
    maxEntries: number;
    events: Array<{
      id: string;
      capability: string;
      scenarios: string[];
      description: string;
      payloadRequired: string[];
    }>;
  };
  semanticUi: {
    schemaVersion: number;
    attributes: Record<string, string>;
    capabilityRoots: string[];
    scenarioStates: Array<{ scenario: string; state: string }>;
    actions: Array<{ id: string; capability: string }>;
    states: string[];
  };
  knownAnswers: {
    schemaVersion: number;
    queries: KnownAnswer[];
  };
}

export const REPO_ROOT: string;
export const CONTRACT_PATHS: Readonly<{
  capabilities: string;
  scenarios: string;
  relations: string;
  events: string;
  semanticUi: string;
  knownAnswers: string;
}>;
export const SCHEMA_PATHS: Readonly<{
  capabilities: string;
  scenarios: string;
  relations: string;
  events: string;
  semanticUi: string;
  knownAnswers: string;
}>;

export function validateProductContracts(root?: string): {
  errors: string[];
  data: ProductContractData;
};
export function validateProductData(
  root: string,
  data: ProductContractData,
): string[];
export function parseProductCapabilitySections(markdown: string): Map<
  string,
  { name: string; lines: string[] }
>;
