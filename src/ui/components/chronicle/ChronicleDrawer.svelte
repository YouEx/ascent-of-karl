<script lang="ts">
  import MetaCollection from "./MetaCollection.svelte";
  interface Props {
    closeIcon: string;
  }

  let { closeIcon }: Props = $props();
</script>

<aside
  id="book-panel"
  data-capability="chronicle.life"
  data-scenario="chronicle.read-life"
  data-state="closed"
  aria-label="Chronicle archive"
>
  <button
    id="book-close"
    class="icon-btn"
    data-action="chronicle.close"
    aria-label="Close the chronicle archive">{@html closeIcon}</button
  >
  <section id="book"></section>
  <MetaCollection />
</aside>
