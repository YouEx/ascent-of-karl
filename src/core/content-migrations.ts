import type { GameState } from "./engine";
import { improvisedElementId } from "./improvise";
import {
  decodeSeed,
  encodeSeed,
  type StoredLifePlan,
} from "./seed";
import type {
  ArchivedInvention,
  Compendium,
  CompletionKey,
} from "./compendium";
import type { ReplayTarget } from "./replay";
import type {
  ContentBundle,
  ContentMigrationsDef,
  ElementDef,
} from "./types";

type AliasKind = "element" | "branch" | "ending";

interface ArchivedLifeSummaryLike {
  lifeId: string;
  startedAt: string;
  endedAt: string;
  outcome:
    | { kind: "ending"; endingId: string }
    | { kind: "abandoned" };
  seedCode: string;
}

interface ArchivedLifeLike {
  version: 1;
  lifeId: string;
  startedAt: string;
  endedAt: string;
  outcome:
    | { kind: "ending"; endingId: string }
    | { kind: "abandoned" };
  plan: StoredLifePlan;
  target: ReplayTarget | null;
  events: unknown[];
  finalState: GameState;
  historyCompleteness: "full" | "legacy-summary";
}

interface ProfileLike {
  version: 2;
  activeLife: {
    version: 1;
    lifeId: string;
    startedAt: string;
    plan: StoredLifePlan;
    target: ReplayTarget | null;
    engine: GameState;
    narrator: unknown;
    events: unknown[];
  } | null;
  archives: ArchivedLifeSummaryLike[];
  compendium: Compendium;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resolveAlias(
  id: string,
  aliases: Readonly<Record<string, string>>,
  currentIds: ReadonlySet<string>,
  kind: AliasKind,
): string {
  if (currentIds.has(id)) return id;
  const seen = new Set<string>();
  let candidate = id;
  while (Object.hasOwn(aliases, candidate)) {
    if (seen.has(candidate)) {
      throw new Error(`Cyclic ${kind} alias at ${candidate}`);
    }
    seen.add(candidate);
    candidate = aliases[candidate]!;
    if (currentIds.has(candidate)) return candidate;
  }
  throw new Error(
    `Missing ${kind} alias for ${id}`,
  );
}

function migrationsFor(
  content: ContentBundle,
  sourceRevision: string,
  targetRevision: string,
): ContentMigrationsDef {
  const migrations = content.migrations;
  if (
    !migrations ||
    migrations.targetRevision !== targetRevision ||
    !migrations.supportedSourceRevisions.includes(sourceRevision)
  ) {
    throw new Error(`Unsupported content revision ${sourceRevision}`);
  }
  return migrations;
}

function migrateImprovisedElements(
  rawElements: readonly ElementDef[],
  migrations: ContentMigrationsDef,
  canonicalIds: ReadonlySet<string>,
): {
  elements: ElementDef[];
  idAliases: Map<string, string>;
} {
  const pending = new Map(
    rawElements.map((element) => [element.id, structuredClone(element)]),
  );
  const migrated = new Map<string, ElementDef>();
  const idAliases = new Map<string, string>();

  const parentId = (id: string): string | null => {
    if (canonicalIds.has(id)) return id;
    if (idAliases.has(id)) return idAliases.get(id)!;
    if (Object.hasOwn(migrations.elementAliases, id)) {
      return resolveAlias(
        id,
        migrations.elementAliases,
        canonicalIds,
        "element",
      );
    }
    return null;
  };

  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const [oldId, element] of pending) {
      if (!element.parents) {
        throw new Error(`Improvised element ${oldId} has no parents`);
      }
      const left = parentId(element.parents[0]);
      const right = parentId(element.parents[1]);
      if (!left || !right) continue;
      const parents = (left <= right ? [left, right] : [right, left]) as [
        string,
        string,
      ];
      const nextId = improvisedElementId(parents[0], parents[1]);
      const existing = migrated.get(nextId);
      if (existing && oldId !== nextId) {
        throw new Error(`Content migration collapses inventions into ${nextId}`);
      }
      const next = {
        ...element,
        id: nextId,
        parents,
      } satisfies ElementDef;
      migrated.set(nextId, next);
      idAliases.set(oldId, nextId);
      pending.delete(oldId);
      progressed = true;
    }
  }

  if (pending.size > 0) {
    throw new Error(
      `Cannot migrate invention parents for ${[...pending.keys()].sort().join(", ")}`,
    );
  }

  return {
    elements: rawElements.map((element) => migrated.get(idAliases.get(element.id)!)!),
    idAliases,
  };
}

function migratePlan(
  plan: StoredLifePlan,
  content: ContentBundle,
  migrations: ContentMigrationsDef,
  targetRevision: string,
  elementIds: ReadonlySet<string>,
  branchIds: ReadonlySet<string>,
): StoredLifePlan {
  const openingIds = new Set(
    content.lifeVariation?.openings.map((opening) => opening.id) ?? [],
  );
  const challengeIds = new Set(
    content.challenges.map((challenge) => challenge.id),
  );
  if (
    plan.seedVersion === 1 &&
    openingIds.size > 0 &&
    !openingIds.has(plan.openingId)
  ) {
    throw new Error(`Unsupported opening id ${plan.openingId}`);
  }
  for (const challengeId of plan.challengeIds) {
    if (!challengeIds.has(challengeId)) {
      throw new Error(`Unsupported challenge id ${challengeId}`);
    }
  }
  return {
    ...plan,
    contentRevision: targetRevision,
    seedCode:
      plan.seedVersion === 1
        ? encodeSeed(plan.seed, targetRevision)
        : plan.seedCode,
    startingElementIds: unique(
      plan.startingElementIds.map((id) =>
        resolveAlias(
          id,
          migrations.elementAliases,
          elementIds,
          "element",
        ),
      ),
    ),
    sidequestIds: unique(
      plan.sidequestIds.map((id) =>
        resolveAlias(
          id,
          migrations.branchAliases,
          branchIds,
          "branch",
        ),
      ),
    ),
  };
}

export function migrateGameStateToCurrentContent(
  content: ContentBundle,
  state: GameState,
): GameState {
  const copy = structuredClone(state);
  const targetRevision = content.completionManifest?.contentRevision;
  const plan = copy.lifePlan;
  if (!targetRevision || !plan || plan.contentRevision === targetRevision) {
    return copy;
  }

  const migrations = migrationsFor(
    content,
    plan.contentRevision,
    targetRevision,
  );
  const elementIds = new Set(content.elements.map((element) => element.id));
  const branchIds = new Set(
    (content.branches ?? []).map((branch) => branch.id),
  );
  const endingIds = new Set(content.endings.map((ending) => ending.id));
  const improvised = migrateImprovisedElements(
    copy.improvisedElements ?? [],
    migrations,
    elementIds,
  );
  const elementReference = (id: string): string =>
    improvised.idAliases.get(id) ??
    resolveAlias(id, migrations.elementAliases, elementIds, "element");

  copy.lifePlan = migratePlan(
    plan,
    content,
    migrations,
    targetRevision,
    elementIds,
    branchIds,
  );
  copy.discovered = unique(copy.discovered.map(elementReference));
  copy.completedBranchIds = unique(
    (copy.completedBranchIds ?? []).map((id) =>
      resolveAlias(id, migrations.branchAliases, branchIds, "branch"),
    ),
  );
  copy.ended =
    copy.ended === null
      ? null
      : resolveAlias(
          copy.ended,
          migrations.endingAliases,
          endingIds,
          "ending",
        );
  copy.improvisedElements = improvised.elements;
  copy.creditedImprovised = unique(
    (copy.creditedImprovised ?? []).map((id) => {
      const migratedId = improvised.idAliases.get(id);
      if (!migratedId) {
        throw new Error(`Missing invention alias for ${id}`);
      }
      return migratedId;
    }),
  );
  if (copy.decisions) {
    copy.decisions.taken = copy.decisions.taken.map((decision) => ({
      ...decision,
      answeredWith: elementReference(decision.answeredWith),
    }));
  }
  return copy;
}

function currentIds(content: ContentBundle) {
  return {
    elements: new Set(content.elements.map((element) => element.id)),
    branches: new Set((content.branches ?? []).map((branch) => branch.id)),
    endings: new Set(content.endings.map((ending) => ending.id)),
  };
}

function migrateReplayTarget(
  target: ReplayTarget | null,
  migrations: ContentMigrationsDef,
  ids: ReturnType<typeof currentIds>,
): ReplayTarget | null {
  if (!target) return null;
  if (target.kind === "branch") {
    return {
      ...target,
      branchId: resolveAlias(
        target.branchId,
        migrations.branchAliases,
        ids.branches,
        "branch",
      ),
    };
  }
  if (target.kind === "ending") {
    return {
      ...target,
      endingId: resolveAlias(
        target.endingId,
        migrations.endingAliases,
        ids.endings,
        "ending",
      ),
    };
  }
  return structuredClone(target);
}

function migrateArchivedInventions(
  inventions: readonly ArchivedInvention[],
  migrations: ContentMigrationsDef,
  canonicalIds: ReadonlySet<string>,
): ArchivedInvention[] {
  const pending = new Map(
    inventions.map((invention) => [
      invention.id,
      structuredClone(invention),
    ]),
  );
  const migrated = new Map<string, ArchivedInvention>();
  const idAliases = new Map<string, string>();
  const parentId = (id: string): string | null => {
    if (canonicalIds.has(id)) return id;
    if (idAliases.has(id)) return idAliases.get(id)!;
    if (Object.hasOwn(migrations.elementAliases, id)) {
      return resolveAlias(
        id,
        migrations.elementAliases,
        canonicalIds,
        "element",
      );
    }
    return null;
  };

  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const [oldId, invention] of pending) {
      const left = parentId(invention.parents[0]);
      const right = parentId(invention.parents[1]);
      if (!left || !right) continue;
      const parents = (left <= right ? [left, right] : [right, left]) as [
        string,
        string,
      ];
      const id = improvisedElementId(parents[0], parents[1]);
      if (migrated.has(id) && oldId !== id) {
        throw new Error(`Content migration collapses inventions into ${id}`);
      }
      migrated.set(id, { ...invention, id, parents });
      idAliases.set(oldId, id);
      pending.delete(oldId);
      progressed = true;
    }
  }
  if (pending.size > 0) {
    throw new Error(
      `Cannot migrate archived invention parents for ${[
        ...pending.keys(),
      ]
        .sort()
        .join(", ")}`,
    );
  }
  return inventions.map(
    (invention) => migrated.get(idAliases.get(invention.id)!)!,
  );
}

function migrateCompendium(
  compendium: Compendium,
  migrations: ContentMigrationsDef,
  ids: ReturnType<typeof currentIds>,
): Compendium {
  const unlocks: Compendium["unlocks"] = {};
  for (const [key, provenance] of Object.entries(compendium.unlocks)) {
    const separator = key.indexOf(":");
    if (separator < 0) throw new Error(`Invalid completion key ${key}`);
    const prefix = key.slice(0, separator);
    const id = key.slice(separator + 1);
    let migratedId: string;
    if (prefix === "discovery") {
      migratedId = resolveAlias(
        id,
        migrations.elementAliases,
        ids.elements,
        "element",
      );
    } else if (prefix === "branch") {
      migratedId = resolveAlias(
        id,
        migrations.branchAliases,
        ids.branches,
        "branch",
      );
    } else if (prefix === "ending") {
      migratedId = resolveAlias(
        id,
        migrations.endingAliases,
        ids.endings,
        "ending",
      );
    } else {
      throw new Error(`Invalid completion key ${key}`);
    }
    const migratedKey = `${prefix}:${migratedId}` as CompletionKey;
    if (!Object.hasOwn(unlocks, migratedKey)) {
      unlocks[migratedKey] = structuredClone(provenance);
    }
  }
  return {
    version: 1,
    unlocks,
    inventions: migrateArchivedInventions(
      compendium.inventions,
      migrations,
      ids.elements,
    ),
  };
}

function sourceRevisionFromSummary(
  summary: ArchivedLifeSummaryLike,
): string | null {
  if (!summary.seedCode.startsWith("K1.")) return null;
  return decodeSeed(summary.seedCode).contentRevision;
}

function migrateArchiveSummary(
  summary: ArchivedLifeSummaryLike,
  content: ContentBundle,
  migrations: ContentMigrationsDef,
  ids: ReturnType<typeof currentIds>,
): ArchivedLifeSummaryLike {
  const revision = content.completionManifest?.contentRevision;
  if (!revision) return structuredClone(summary);
  const source = sourceRevisionFromSummary(summary);
  const seedCode =
    source && source !== revision
      ? encodeSeed(decodeSeed(summary.seedCode).seed, revision)
      : summary.seedCode;
  return {
    ...summary,
    seedCode,
    outcome:
      summary.outcome.kind === "ending"
        ? {
            kind: "ending",
            endingId: resolveAlias(
              summary.outcome.endingId,
              migrations.endingAliases,
              ids.endings,
              "ending",
            ),
          }
        : { kind: "abandoned" },
  };
}

export function migrateArchivedLifeToCurrentContent<
  T extends ArchivedLifeLike,
>(
  content: ContentBundle,
  archive: T,
): T {
  const revision = content.completionManifest?.contentRevision;
  if (!revision || archive.plan.contentRevision === revision) {
    return structuredClone(archive);
  }
  const migrations = migrationsFor(
    content,
    archive.plan.contentRevision,
    revision,
  );
  const ids = currentIds(content);
  const finalState = migrateGameStateToCurrentContent(
    content,
    archive.finalState,
  );
  return {
    ...structuredClone(archive),
    plan: finalState.lifePlan ?? archive.plan,
    target: migrateReplayTarget(archive.target, migrations, ids),
    outcome:
      archive.outcome.kind === "ending"
        ? {
            kind: "ending",
            endingId: resolveAlias(
              archive.outcome.endingId,
              migrations.endingAliases,
              ids.endings,
              "ending",
            ),
          }
        : { kind: "abandoned" },
    finalState,
  } as T;
}

export function migrateProfileToCurrentContent<T extends ProfileLike>(
  content: ContentBundle,
  profile: T,
): T {
  const revision = content.completionManifest?.contentRevision;
  if (!revision) return structuredClone(profile);
  const sourceRevisions = new Set<string>();
  if (
    profile.activeLife &&
    profile.activeLife.plan.contentRevision !== revision
  ) {
    sourceRevisions.add(profile.activeLife.plan.contentRevision);
  }
  for (const summary of profile.archives) {
    const source = sourceRevisionFromSummary(summary);
    if (source && source !== revision) sourceRevisions.add(source);
  }
  if (sourceRevisions.size === 0) return structuredClone(profile);
  for (const source of sourceRevisions) {
    migrationsFor(content, source, revision);
  }
  const migrations = content.migrations!;
  const ids = currentIds(content);
  const activeLife = profile.activeLife
    ? (() => {
        const engine = migrateGameStateToCurrentContent(
          content,
          profile.activeLife.engine,
        );
        return {
          ...structuredClone(profile.activeLife),
          plan: engine.lifePlan ?? profile.activeLife.plan,
          target: migrateReplayTarget(
            profile.activeLife.target,
            migrations,
            ids,
          ),
          engine,
        };
      })()
    : null;
  return {
    version: 2,
    activeLife,
    archives: profile.archives.map((summary) =>
      migrateArchiveSummary(summary, content, migrations, ids),
    ),
    compendium: migrateCompendium(
      profile.compendium,
      migrations,
      ids,
    ),
  } as T;
}
