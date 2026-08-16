<script lang="ts">
  interface Props {
    bookIcon: string;
    trophyIcon: string;
    restartIcon: string;
  }

  let { bookIcon, trophyIcon, restartIcon }: Props = $props();
</script>

<header
  data-capability="platform.cross-device"
  data-scenario="platform.session-ready"
  data-state="ready"
>
  <span class="mark" aria-hidden="true"></span>
  <h1>The Ascent of Karl</h1>
  <span id="act-label"></span>
  <span id="age"></span>
  <div class="header-actions">
    <button
      id="book-btn"
      class="icon-btn"
      data-action="chronicle.open"
      aria-label="Open the chronicle archive"
      >{@html bookIcon}<span id="book-badge"></span></button
    >
    <button
      id="trophies"
      class="icon-btn"
      data-action="fates.open"
      aria-label="Fates discovered"
      >{@html trophyIcon}</button
    >
    <button
      id="restart"
      class="icon-btn"
      data-action="life.restart"
      aria-label="Start over">{@html restartIcon}</button
    >
  </div>
</header>
