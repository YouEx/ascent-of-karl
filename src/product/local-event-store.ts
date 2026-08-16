import {
  PRODUCT_EVENT_MAX_ENTRIES,
  PRODUCT_EVENT_STORAGE_KEY,
} from "./generated/contracts";
import type { AnyProductEvent } from "./events";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isStoredEvent(value: unknown): value is AnyProductEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AnyProductEvent>;
  return (
    event.schemaVersion === 1 &&
    Number.isInteger(event.sequence) &&
    typeof event.type === "string" &&
    typeof event.capability === "string" &&
    typeof event.scenario === "string" &&
    Number.isInteger(event.turn) &&
    event.payload !== null &&
    typeof event.payload === "object"
  );
}

export function readProductEventJournal(
  storage: KeyValueStorage | null,
): AnyProductEvent[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PRODUCT_EVENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredEvent).slice(-PRODUCT_EVENT_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function appendProductEvent(
  storage: KeyValueStorage | null,
  event: AnyProductEvent,
): void {
  if (!storage) return;
  try {
    const current = readProductEventJournal(storage);
    current.push(event);
    storage.setItem(
      PRODUCT_EVENT_STORAGE_KEY,
      JSON.stringify(current.slice(-PRODUCT_EVENT_MAX_ENTRIES)),
    );
  } catch {
    // Local evidence must never block play.
  }
}

export function clearProductEventJournal(
  storage: KeyValueStorage | null,
): void {
  if (!storage) return;
  try {
    storage.removeItem(PRODUCT_EVENT_STORAGE_KEY);
  } catch {
    // Clearing optional local evidence is fail-open.
  }
}
