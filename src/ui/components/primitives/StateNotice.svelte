<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    CapabilityId,
    ScenarioId,
    UiState,
  } from "../../../product/generated/contracts";

  interface Props {
    id: string;
    capability: CapabilityId;
    scenario: ScenarioId;
    state: UiState;
    meaning: "blocking" | "retryable" | "informational" | "terminal";
    labelledby: string;
    hidden?: boolean;
    parityAddition?: boolean;
    children: Snippet;
  }

  let {
    id,
    capability,
    scenario,
    state,
    meaning,
    labelledby,
    hidden = false,
    parityAddition = false,
    children,
  }: Props = $props();
</script>

<section
  {id}
  data-capability={capability}
  data-scenario={scenario}
  data-state={state}
  data-notice-meaning={meaning}
  data-parity-addition={parityAddition ? "true" : undefined}
  aria-labelledby={labelledby}
  {hidden}
>
  {@render children()}
</section>
