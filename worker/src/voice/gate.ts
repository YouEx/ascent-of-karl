/**
 * Produktions-indgang til stemmedommeren (TASK-007) — ét sted der
 * importerer det genererede facit (`../generated/voice-profile.json`) og
 * bygger scoreren ÉN gang pr. isolate, ikke pr. forespørgsel. `model.ts`
 * importerer KUN denne fil, aldrig `scorer.ts` direkte, så der findes ét
 * eneste sted profilen bindes til en kørende scorer.
 *
 * `VOICE_PROFILE_HASH`/`VOICE_PROFILE_VERSION` eksporteres til
 * `coordinator-do.ts`, som folder hash'en ind i cache-navnerummet (samme
 * automatiske mønster som `PROMPT_VERSION_INPUT`, se `cache-key.ts`) — en
 * ændring i stemmepolitikken (korpus, lexicon, kalibrering) ugyldiggør
 * dermed gamle cache-linjer af sig selv, uden et manuelt versionstal nogen
 * skal huske at bumpe.
 */
import voiceProfileJson from "../generated/voice-profile.json";
import { createScorer, type JudgeResult, type Source, type VoiceProfile } from "./scorer";

const VOICE_PROFILE: VoiceProfile = voiceProfileJson as unknown as VoiceProfile;
const scorer = createScorer(VOICE_PROFILE);

export const VOICE_PROFILE_HASH = VOICE_PROFILE.hash;
export const VOICE_PROFILE_VERSION = VOICE_PROFILE.version;
export const VOICE_THRESHOLD = VOICE_PROFILE.threshold.value;

/**
 * Fuld dom over én live-linje. `source` er altid `"grammar"` som standard —
 * opgaven ordret: "Live text gets source=grammar semantics" (se
 * `scorer.ts`'s `Source`-type for hvorfor der ikke findes et tredje
 * `"live"`-alternativ i selve scoringsalgoritmen).
 */
export function judgeLiveLine(text: string, source: Source = "grammar"): JudgeResult {
  return scorer.judgeLine(text, source);
}

/**
 * Sand hvis linjen består BÅDE de hårde afvisninger og den kalibrerede
 * tærskel (p5, `VOICE_THRESHOLD`) — samme to-trins-dom som `judge.py`s
 * `gate()` selv bruger til at afgøre bestået/underkendt.
 */
export function passesVoiceGate(text: string, source: Source = "grammar"): boolean {
  return scorer.passesVoiceGate(text, source);
}
