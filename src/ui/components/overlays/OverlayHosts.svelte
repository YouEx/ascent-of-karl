<script lang="ts">
  import NetworkGate from "./NetworkGate.svelte";

  // No props yet; the controller owns overlay contents and visibility.
</script>

<NetworkGate />
<div id="persistence-error" role="alert" hidden data-parity-addition="true">
  <span id="persistence-error-text"></span>
  <button id="persistence-retry" data-action="persistence.retry">
    Retry saving
  </button>
</div>
<div id="banner" hidden></div>
<div id="card" hidden></div>
<div
  id="ending"
  data-capability="fate.ending"
  data-scenario="ending.unlocked"
  data-state="terminal"
  hidden
></div>
<div
  id="trophy-modal"
  data-capability="collection.compendium"
  data-scenario="compendium.review-gap"
  data-state="closed"
  hidden
></div>
<div id="title-screen" data-capability="life.begin" data-state="fresh"></div>
