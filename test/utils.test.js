import { describe, it, expect } from "vitest";
import { slugify, calStats, computeStreak, tasteProfile, weightedPick } from "../src/lib/utils.js";

// ---------------------------------------------------------------------------
// slugify — used everywhere a film title needs to become a stable, URL/key-safe
// identifier (community lobby matching, watch history lookups, etc.). If this
// breaks, films silently stop matching each other across features.
// ---------------------------------------------------------------------------
describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("The Grand Budapest Hotel")).toBe("the-grand-budapest-hotel");
  });

  it("strips punctuation", () => {
    expect(slugify("Everything Everywhere All at Once!")).toBe("everything-everywhere-all-at-once");
  });

  it("collapses multiple separators into one hyphen", () => {
    expect(slugify("Spider-Man: Into the Spider-Verse")).toBe("spider-man-into-the-spider-verse");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  (2024) Dune ")).toBe("2024-dune");
  });

  it("produces the same slug for titles that only differ in case or spacing", () => {
    expect(slugify("Mad Max: Fury Road")).toBe(slugify("mad max   fury road"));
  });
});

// ---------------------------------------------------------------------------
// calStats — the calibration score is the core "how well do you know your own
// taste" number shown throughout the app. A regression here would silently
// show people the wrong number about themselves.
// ---------------------------------------------------------------------------
describe("calStats", () => {
  it("returns null calibration when there are no settled predictions yet", () => {
    const state = { predictions: [{ filmId: 1, pred: 7, actual: null }] };
    const { calibration, avgGap, done } = calStats(state);
    expect(done).toHaveLength(0);
    expect(avgGap).toBeNull();
    expect(calibration).toBeNull();
  });

  it("scores a perfect prediction as 100", () => {
    const state = { predictions: [{ filmId: 1, pred: 8, actual: 8 }] };
    expect(calStats(state).calibration).toBe(100);
  });

  it("penalizes larger gaps between prediction and actual rating", () => {
    const closeGuess = { predictions: [{ filmId: 1, pred: 7, actual: 7.5 }] };
    const wildGuess = { predictions: [{ filmId: 1, pred: 3, actual: 9 }] };
    expect(calStats(closeGuess).calibration).toBeGreaterThan(calStats(wildGuess).calibration);
  });

  it("never returns a calibration below 0, even for a maximally wrong guess", () => {
    const state = { predictions: [{ filmId: 1, pred: 1, actual: 10 }] };
    expect(calStats(state).calibration).toBeGreaterThanOrEqual(0);
  });

  it("averages the gap across multiple settled predictions", () => {
    const state = {
      predictions: [
        { filmId: 1, pred: 7, actual: 7 },   // gap 0
        { filmId: 2, pred: 5, actual: 7 },   // gap 2
      ],
    };
    expect(calStats(state).avgGap).toBe(1);
  });

  it("ignores predictions that haven't been settled yet when averaging", () => {
    const state = {
      predictions: [
        { filmId: 1, pred: 7, actual: 7 },
        { filmId: 2, pred: 5, actual: null }, // still open, shouldn't count
      ],
    };
    expect(calStats(state).done).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeStreak — consecutive-day tracking with an explicit "yesterday still
// counts" grace period. This has the kind of subtle date-boundary logic that
// is very easy to accidentally break in a future edit without a test to catch it.
// ---------------------------------------------------------------------------
describe("computeStreak", () => {
  const toISO = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return toISO(d);
  };

  it("returns 0 for an empty log", () => {
    expect(computeStreak([])).toBe(0);
    expect(computeStreak(null)).toBe(0);
  });

  it("returns 0 if the most recent night was more than a day ago", () => {
    expect(computeStreak([daysAgo(3)])).toBe(0);
  });

  it("counts a single night logged today as a streak of 1", () => {
    expect(computeStreak([daysAgo(0)])).toBe(1);
  });

  it("still counts the streak as active if the last night was yesterday, not today", () => {
    expect(computeStreak([daysAgo(1)])).toBe(1);
  });

  it("counts multiple genuinely consecutive days correctly", () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3);
  });

  it("stops counting at the first gap", () => {
    // today, yesterday, then a gap, then an older night — streak should stop at the gap
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(5)])).toBe(2);
  });

  it("doesn't double-count a duplicate date in the log", () => {
    expect(computeStreak([daysAgo(0), daysAgo(0), daysAgo(1)])).toBe(2);
  });

  it("doesn't care what order the dates were logged in", () => {
    const forward = computeStreak([daysAgo(2), daysAgo(1), daysAgo(0)]);
    const backward = computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)]);
    expect(forward).toBe(backward);
  });
});

// ---------------------------------------------------------------------------
// tasteProfile — powers the "Match my taste" picker source's genre weighting.
// ---------------------------------------------------------------------------
describe("tasteProfile", () => {
  it("identifies the highest-rated genre as the best mood", () => {
    const films = [
      { status: "watched", rating: 9, mood: "action", d: "Dir A" },
      { status: "watched", rating: 4, mood: "drama", d: "Dir B" },
    ];
    expect(tasteProfile(films).bestMood).toBe("action");
  });

  it("ignores unrated and unwatched films when scoring", () => {
    const films = [
      { status: "watched", rating: 9, mood: "action", d: "Dir A" },
      { status: "watchlist", rating: null, mood: "horror", d: "Dir B" }, // not watched yet
      { status: "watched", rating: null, mood: "comedy", d: "Dir C" },   // watched, not rated
    ];
    const profile = tasteProfile(films);
    // only the one genuinely rated film should influence anything
    expect(profile.bestMood).toBe("action");
  });

  it("tracks the highest rating given to each director", () => {
    const films = [
      { status: "watched", rating: 6, mood: "drama", d: "Nolan" },
      { status: "watched", rating: 9, mood: "action", d: "Nolan" },
    ];
    expect(tasteProfile(films).dirScore["Nolan"]).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// weightedPick — the actual randomness behind "spin" landing on a film.
// ---------------------------------------------------------------------------
describe("weightedPick", () => {
  it("returns the only item when given a single-item list", () => {
    const items = ["only-film"];
    expect(weightedPick(items, () => 5)).toBe("only-film");
  });

  it("never picks an item whose weight is zero, given a real alternative", () => {
    const items = ["never", "always"];
    const weightFn = (item) => (item === "never" ? 0 : 1);
    for (let i = 0; i < 50; i++) {
      expect(weightedPick(items, weightFn)).toBe("always");
    }
  });

  it("only ever returns items that were actually in the input list", () => {
    const items = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(weightedPick(items, () => Math.random() + 0.1));
    }
  });
});
