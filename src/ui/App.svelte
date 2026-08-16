<script lang="ts">
  import GameHeader from "./components/game/GameHeader.svelte";
  import LivingChronicle from "./components/game/LivingChronicle.svelte";
  import Workshop from "./components/game/Workshop.svelte";
  import ChronicleDrawer from "./components/chronicle/ChronicleDrawer.svelte";
  import OverlayHosts from "./components/overlays/OverlayHosts.svelte";

  interface Props {
    icons: {
      book: string;
      titleTrophy: string;
      restart: string;
      soundOn: string;
      close: string;
    };
    improvisationEnabled: boolean;
  }

  let { icons, improvisationEnabled }: Props = $props();
</script>

<GameHeader
  bookIcon={icons.book}
  trophyIcon={icons.titleTrophy}
  restartIcon={icons.restart}
/>
<LivingChronicle soundIcon={icons.soundOn} />
<Workshop {improvisationEnabled} />
<ChronicleDrawer closeIcon={icons.close} />
<OverlayHosts />
