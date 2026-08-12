/**
 * To små samtidighedshjælpere, brugt sammen af koordinatoren
 * (`coordinator.ts`).
 *
 * Cloudflare Durable Objects garanterer selv, at `await`-kæder uden
 * mellemliggende netværkskald kører uden at flette sig ind i hinanden
 * ("input/output gating"). `SerialGate` er den samme garanti skrevet ind i
 * koden selv, uafhængig af hvilket lager der ligger bagved — kravet beder
 * eksplicit om "Durable Object storage transactions ELLER TILSVARENDE
 * SERIALISERET RESERVATION", og det er hvad dette er: koster stort set
 * intet, gør reglen sand uanset runtime, og lader sig teste med en helt
 * almindelig hukommelsesattrap.
 */

/** Kører funktioner én ad gangen, i den rækkefølge de kommer ind. */
export class SerialGate {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Én fejlet kørsel må ikke stoppe køen for alle bagved.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Kald i luften pr. nøgle, så en stime af samtidige cache-misses på samme
 * par+dom kun koster ét opstrømskald (TASK-004: "dedupliker samtidige
 * misses... så en stime koster ét kald").
 */
export class InFlightRegistry<T> {
  private inFlight = new Map<string, Promise<T>>();

  get(key: string): Promise<T> | undefined {
    return this.inFlight.get(key);
  }

  /** Starter arbejdet NU (synkront op til første await) og registrerer det. */
  start(key: string, factory: () => Promise<T>): Promise<T> {
    const p = factory().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
    return p;
  }
}
