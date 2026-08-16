import type {
  ArchivedLife,
  ProfileV2,
} from "../core/life";

export interface ProfileStore {
  loadProfile(): Promise<ProfileV2 | null>;
  saveProfile(profile: ProfileV2): Promise<void>;
  listArchives(): Promise<ArchivedLife[]>;
  loadArchive(lifeId: string): Promise<ArchivedLife | null>;
  replaceAll(profile: ProfileV2, archives: readonly ArchivedLife[]): Promise<void>;
  finalizeLife(profile: ProfileV2, archive: ArchivedLife): Promise<void>;
}

export class InMemoryProfileStore implements ProfileStore {
  private profile: ProfileV2 | null = null;
  private readonly archives = new Map<string, ArchivedLife>();

  async loadProfile(): Promise<ProfileV2 | null> {
    return this.profile ? structuredClone(this.profile) : null;
  }

  async saveProfile(profile: ProfileV2): Promise<void> {
    this.profile = structuredClone(profile);
  }

  async listArchives(): Promise<ArchivedLife[]> {
    return [...this.archives.values()]
      .map((archive) => structuredClone(archive))
      .sort((left, right) => left.endedAt.localeCompare(right.endedAt));
  }

  async loadArchive(lifeId: string): Promise<ArchivedLife | null> {
    const archive = this.archives.get(lifeId);
    return archive ? structuredClone(archive) : null;
  }

  async replaceAll(
    profile: ProfileV2,
    archives: readonly ArchivedLife[],
  ): Promise<void> {
    const replacement = new Map<string, ArchivedLife>();
    for (const archive of archives) {
      if (replacement.has(archive.lifeId)) {
        throw new Error(`Duplicate life ${archive.lifeId}`);
      }
      replacement.set(archive.lifeId, structuredClone(archive));
    }
    this.archives.clear();
    for (const [lifeId, archive] of replacement) {
      this.archives.set(lifeId, archive);
    }
    this.profile = structuredClone(profile);
  }

  async finalizeLife(profile: ProfileV2, archive: ArchivedLife): Promise<void> {
    if (this.archives.has(archive.lifeId)) {
      throw new Error(`Life ${archive.lifeId} is already archived`);
    }
    this.archives.set(archive.lifeId, structuredClone(archive));
    this.profile = structuredClone(profile);
  }
}
