<script lang="ts">
  import type {
    ActionId,
    CapabilityId,
    ScenarioId,
    UiState,
  } from "../../../product/generated/contracts";

  interface Props {
    id?: string;
    capability: CapabilityId;
    scenario: ScenarioId;
    state: UiState;
    action: ActionId;
    label: string;
    className?: string;
    disabled?: boolean;
    onclick?: () => void;
  }

  let {
    id,
    capability,
    scenario,
    state,
    action,
    label,
    className,
    disabled = false,
    onclick,
  }: Props = $props();
</script>

<button
  {id}
  class={className}
  data-capability={capability}
  data-scenario={scenario}
  data-state={state}
  data-action={action}
  {disabled}
  {onclick}
>
  {label}
</button>
