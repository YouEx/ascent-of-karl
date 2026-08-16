import type { ArchivedLife, ProfileV2 } from "../core/life";
import type { ProfileStore } from "./profile-store";

const DB_NAME = "karl-profile-v2";
const DB_VERSION = 1;
const PROFILE_STORE = "profile";
const ARCHIVE_STORE = "archives";
const PROFILE_KEY = "current";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDbProfileStore implements ProfileStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<IndexedDbProfileStore> {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE);
      }
      if (!database.objectStoreNames.contains(ARCHIVE_STORE)) {
        database.createObjectStore(ARCHIVE_STORE, { keyPath: "lifeId" });
      }
    };
    return new IndexedDbProfileStore(await requestResult(request));
  }

  async loadProfile(): Promise<ProfileV2 | null> {
    const transaction = this.database.transaction(PROFILE_STORE, "readonly");
    const value = await requestResult(
      transaction.objectStore(PROFILE_STORE).get(PROFILE_KEY),
    );
    await transactionDone(transaction);
    return value ? structuredClone(value as ProfileV2) : null;
  }

  async saveProfile(profile: ProfileV2): Promise<void> {
    const transaction = this.database.transaction(PROFILE_STORE, "readwrite");
    transaction.objectStore(PROFILE_STORE).put(structuredClone(profile), PROFILE_KEY);
    await transactionDone(transaction);
  }

  async listArchives(): Promise<ArchivedLife[]> {
    const transaction = this.database.transaction(ARCHIVE_STORE, "readonly");
    const values = await requestResult(
      transaction.objectStore(ARCHIVE_STORE).getAll(),
    );
    await transactionDone(transaction);
    return (values as ArchivedLife[])
      .map((archive) => structuredClone(archive))
      .sort((left, right) => left.endedAt.localeCompare(right.endedAt));
  }

  async loadArchive(lifeId: string): Promise<ArchivedLife | null> {
    const transaction = this.database.transaction(ARCHIVE_STORE, "readonly");
    const value = await requestResult(
      transaction.objectStore(ARCHIVE_STORE).get(lifeId),
    );
    await transactionDone(transaction);
    return value ? structuredClone(value as ArchivedLife) : null;
  }

  async replaceAll(
    profile: ProfileV2,
    archives: readonly ArchivedLife[],
  ): Promise<void> {
    const transaction = this.database.transaction(
      [PROFILE_STORE, ARCHIVE_STORE],
      "readwrite",
    );
    const archiveStore = transaction.objectStore(ARCHIVE_STORE);
    archiveStore.clear();
    for (const archive of archives) {
      archiveStore.add(structuredClone(archive));
    }
    transaction
      .objectStore(PROFILE_STORE)
      .put(structuredClone(profile), PROFILE_KEY);
    await transactionDone(transaction);
  }

  async finalizeLife(profile: ProfileV2, archive: ArchivedLife): Promise<void> {
    const transaction = this.database.transaction(
      [PROFILE_STORE, ARCHIVE_STORE],
      "readwrite",
    );
    transaction.objectStore(ARCHIVE_STORE).add(structuredClone(archive));
    transaction.objectStore(PROFILE_STORE).put(structuredClone(profile), PROFILE_KEY);
    await transactionDone(transaction);
  }
}
