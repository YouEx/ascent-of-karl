<script lang="ts">
  import Action from "../primitives/Action.svelte";
  import StateNotice from "../primitives/StateNotice.svelte";

  // Static outage surface; runtime visibility is owned by SessionClient.
</script>

<StateNotice
  id="network-gate"
  capability="platform.cross-device"
  scenario="network.unavailable"
  state="unavailable"
  meaning="blocking"
  labelledby="network-gate-title"
  hidden={true}
  parityAddition={true}
>
  <div class="network-gate-card">
    <p class="kicker">Connection required</p>
    <h2 id="network-gate-title">Karl cannot continue this life offline</h2>
    <p>
      Active play is paused. Saved lives remain intact, and archived Chronicles
      stay readable.
    </p>
    <div class="network-gate-actions">
      <Action
        id="network-retry"
        capability="platform.cross-device"
        scenario="network.unavailable"
        state="retryable"
        action="connection.retry"
        label="Retry connection"
      />
      <Action
        id="network-archives"
        capability="chronicle.life"
        scenario="network.unavailable"
        state="available-offline"
        action="archive.open-life"
        label="View archived lives"
      />
    </div>
  </div>
</StateNotice>
