<script lang="ts">
  interface Props {
    improvisationEnabled: boolean;
  }

  let { improvisationEnabled }: Props = $props();
</script>

<section
  id="challenge"
  data-capability="story.challenges"
  data-scenario="challenge.active"
  data-state="idle"
  hidden
  aria-live="assertive"
></section>
<section
  id="problems"
  data-capability="guidance.needs"
  data-scenario="need.active"
  data-state="active"
  aria-label="Karl's problems"
></section>

<div
  id="tools"
  data-capability="craft.combine"
  data-scenario="need.active"
  data-state="ready"
>
  <input
    id="search"
    data-action="elements.search"
    type="search"
    placeholder="Search elements…"
    aria-label="Search elements"
    autocomplete="off"
  />
  <button
    id="filter-new"
    data-action="elements.filter-new"
    class="chip-btn"
    aria-pressed="false">New finds</button
  >
  <button
    id="filter-done"
    data-action="elements.filter-finished"
    class="chip-btn"
    aria-pressed="false"
    aria-label="Hide finished elements that lead nowhere further"
    >Hide finished</button
  >
</div>

<section
  id="grid"
  data-capability="collection.canonical-discovery"
  data-state="available"
  aria-label="Elements"
></section>
<p id="grid-empty" hidden>Nothing matches that. Karl checked twice.</p>

<div
  id="dock"
  data-capability="craft.combine"
  data-scenario="need.active"
  data-state="empty"
>
  <div class="slot" id="slot-a"></div>
  <span class="plus">+</span>
  <div class="slot" id="slot-b"></div>
  <button id="combine" data-action="combination.submit" disabled>Combine</button>
</div>
{#if improvisationEnabled}
  <div id="improvise-status-host"></div>
{/if}
