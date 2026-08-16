<script lang="ts">
  interface Props {
    soundIcon: string;
  }

  let { soundIcon }: Props = $props();
</script>

<section
  id="story-book"
  data-capability="chronicle.life"
  data-scenario="chronicle.read-life"
  data-state="closed"
  aria-label="Karl's living chronicle"
>
  <div class="story-cover">
    <article
      id="bubble"
      class="story-page story-page-narrator"
      data-capability="narrator.react"
    >
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button
          id="mute"
          class="icon-btn"
          data-action="narrator.mute"
          aria-pressed="false"
          aria-label="Mute the narrator">{@html soundIcon}</button
        >
      </div>
      <p id="narrator-text" aria-live="polite"></p>
    </article>
    <div class="story-gutter" aria-hidden="true"></div>
    <article
      id="story-outcome"
      class="story-page story-page-outcome"
      aria-live="polite"
    ></article>
    <div class="story-turn-leaf" aria-hidden="true"></div>
  </div>
</section>
