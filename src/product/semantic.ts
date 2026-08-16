import {
  ACTION_CAPABILITY,
  ACTION_IDS,
  CAPABILITY_IDS,
  SCENARIO_IDS,
  SEMANTIC_ATTRIBUTES,
  UI_STATES,
  type ActionId,
  type CapabilityId,
  type ScenarioId,
  type UiState,
} from "./generated/contracts";

export interface SemanticDescriptor {
  capability: CapabilityId;
  scenario: ScenarioId;
  state: UiState;
  action?: ActionId;
  entityId?: string;
}

function includes<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T);
}

export function semanticAttributes(
  descriptor: SemanticDescriptor,
): Record<string, string> {
  if (!includes(CAPABILITY_IDS, descriptor.capability)) {
    throw new Error(`Unknown capability ${descriptor.capability}`);
  }
  if (!includes(SCENARIO_IDS, descriptor.scenario)) {
    throw new Error(`Unknown scenario ${descriptor.scenario}`);
  }
  if (!includes(UI_STATES, descriptor.state)) {
    throw new Error(`Unknown UI state ${descriptor.state}`);
  }
  if (descriptor.action) {
    if (!includes(ACTION_IDS, descriptor.action)) {
      throw new Error(`Unknown action ${descriptor.action}`);
    }
    const owner = ACTION_CAPABILITY[descriptor.action];
    if (owner !== descriptor.capability) {
      throw new Error(
        `${descriptor.action} belongs to ${owner}, not ${descriptor.capability}`,
      );
    }
  }

  return {
    [SEMANTIC_ATTRIBUTES.capability]: descriptor.capability,
    [SEMANTIC_ATTRIBUTES.scenario]: descriptor.scenario,
    [SEMANTIC_ATTRIBUTES.state]: descriptor.state,
    ...(descriptor.action
      ? { [SEMANTIC_ATTRIBUTES.action]: descriptor.action }
      : {}),
    ...(descriptor.entityId
      ? { [SEMANTIC_ATTRIBUTES.entity]: descriptor.entityId }
      : {}),
  };
}
