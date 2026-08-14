import { afterEach, describe, expect, it, vi } from "vitest";
import { PageTurn, StoryBook } from "../src/ui/story-book";
import type { StoryPagePayload } from "../src/ui/story-page";

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

function payload(title: string): StoryPagePayload {
  return {
    kind: "attempt",
    pairLabel: "Stone + Grass",
    kicker: "Attempt",
    title,
  };
}

function fakeBook(immediate = false): {
  book: StoryBook;
  root: { classList: FakeClassList };
  outcome: { innerHTML: string };
} {
  const root = { classList: new FakeClassList() };
  const outcome = { innerHTML: "" };
  return {
    book: new StoryBook(
      root as unknown as HTMLElement,
      outcome as unknown as HTMLElement,
      () => immediate,
      240,
    ),
    root,
    outcome,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PageTurn", () => {
  it("lets only the newest turn reach its midpoint", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const turn = new PageTurn(240);

    turn.start(() => seen.push("old"));
    turn.start(() => seen.push("new"));
    vi.advanceTimersByTime(120);

    expect(seen).toEqual(["new"]);
  });

  it("swaps immediately when motion is reduced or frozen", () => {
    const seen: string[] = [];
    const turn = new PageTurn(240);

    turn.start(() => seen.push("now"), true);

    expect(seen).toEqual(["now"]);
  });
});

describe("StoryBook", () => {
  it("renders a story page as semantic outcome copy", () => {
    const { book, outcome } = fakeBook();

    book.render({
      kind: "opening",
      pairLabel: "The first page",
      kicker: "Karl's story",
      title: "The page is waiting",
      body: "Combine two elements to write what happens next.",
    });

    expect(outcome.innerHTML).toContain("story-pair");
    expect(outcome.innerHTML).toContain("The first page");
    expect(outcome.innerHTML).toContain("The page is waiting");
    expect(outcome.innerHTML).toContain(
      "Combine two elements to write what happens next.",
    );
  });

  it("swaps at the midpoint and ends the authored turn", () => {
    vi.useFakeTimers();
    const { book, root, outcome } = fakeBook();
    book.render(payload("Old page"));

    book.present(payload("New page"));

    expect(root.classList.contains("is-turning")).toBe(true);
    expect(outcome.innerHTML).toContain("Old page");
    vi.advanceTimersByTime(120);
    expect(outcome.innerHTML).toContain("New page");
    vi.advanceTimersByTime(120);
    expect(root.classList.contains("is-turning")).toBe(false);
  });

  it("prevents a stale turn from overwriting a newer page", () => {
    vi.useFakeTimers();
    const { book, outcome } = fakeBook();

    book.present(payload("Old page"));
    vi.advanceTimersByTime(60);
    book.present(payload("Newest page"));
    vi.advanceTimersByTime(120);

    expect(outcome.innerHTML).toContain("Newest page");
    expect(outcome.innerHTML).not.toContain("Old page");
  });

  it("swaps immediately without a turning state when motion is disabled", () => {
    const { book, root, outcome } = fakeBook(true);

    book.present(payload("Immediate page"));

    expect(outcome.innerHTML).toContain("Immediate page");
    expect(root.classList.contains("is-turning")).toBe(false);
  });
});
