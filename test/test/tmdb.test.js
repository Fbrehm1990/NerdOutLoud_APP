import { describe, it, expect } from "vitest";
import { tmdbMood, tmdbSvc, tmdbToFilm } from "../src/lib/tmdb.js";

// ---------------------------------------------------------------------------
// tmdbMood — every film's genre filter and taste-profile matching depends on
// this mapping from TMDB's raw genre IDs to the app's own mood categories.
// ---------------------------------------------------------------------------
describe("tmdbMood", () => {
  it("maps a known TMDB genre ID to the correct mood", () => {
    expect(tmdbMood([27])).toBe("horror"); // 27 = Horror
    expect(tmdbMood([878])).toBe("scifi"); // 878 = Science Fiction
  });

  it("picks the first recognized genre when a film has several", () => {
    expect(tmdbMood([28, 12])).toBe("action"); // Action before Adventure
  });

  it("falls back to drama for an unrecognized or empty genre list", () => {
    expect(tmdbMood([99999])).toBe("drama");
    expect(tmdbMood([])).toBe("drama");
    expect(tmdbMood(null)).toBe("drama");
  });
});

// ---------------------------------------------------------------------------
// tmdbSvc — determines which streaming service badge a film gets, which
// directly controls whether it's eligible to be picked under a given service
// filter. A bug here means films silently show up on (or vanish from) the
// wrong service.
// ---------------------------------------------------------------------------
describe("tmdbSvc", () => {
  const providers = (name) => ({
    results: { US: { flatrate: [{ provider_name: name }] } },
  });

  it("recognizes each supported streaming service", () => {
    expect(tmdbSvc(providers("Netflix"))).toBe("Netflix");
    expect(tmdbSvc(providers("Amazon Prime Video"))).toBe("Prime");
    expect(tmdbSvc(providers("Max"))).toBe("Max");
    expect(tmdbSvc(providers("Hulu"))).toBe("Hulu");
    expect(tmdbSvc(providers("Disney Plus"))).toBe("Disney+");
    expect(tmdbSvc(providers("Tubi"))).toBe("Tubi");
  });

  it("falls back to Other for an unrecognized provider", () => {
    expect(tmdbSvc(providers("Peacock"))).toBe("Other");
  });

  it("falls back to Other when there's no US flatrate data at all", () => {
    expect(tmdbSvc({})).toBe("Other");
    expect(tmdbSvc(null)).toBe("Other");
    expect(tmdbSvc({ results: {} })).toBe("Other");
  });

  it("never throws on malformed input — a bad TMDB response shouldn't crash the picker", () => {
    expect(() => tmdbSvc({ results: { US: null } })).not.toThrow();
    expect(() => tmdbSvc("not even an object")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tmdbToFilm — the single place a raw TMDB API response becomes a film object
// the rest of the app can actually use. Every field here feeds something real:
// the picker's pool, the landed card, the library entry.
// ---------------------------------------------------------------------------
describe("tmdbToFilm", () => {
  it("extracts the director from the credits crew list", () => {
    const raw = {
      title: "Inception", release_date: "2010-07-16", runtime: 148,
      genres: [{ id: 878 }], overview: "A thief who steals corporate secrets...",
      credits: { crew: [{ job: "Producer", name: "Someone Else" }, { job: "Director", name: "Christopher Nolan" }] },
    };
    expect(tmdbToFilm(raw).d).toBe("Christopher Nolan");
  });

  it("falls back to Unknown when no director credit is present", () => {
    const raw = { title: "Mystery Movie", credits: { crew: [] } };
    expect(tmdbToFilm(raw).d).toBe("Unknown");
  });

  it("falls back to Untitled when a film has no title", () => {
    expect(tmdbToFilm({}).n).toBe("Untitled");
  });

  it("truncates an overly long synopsis to 200 characters", () => {
    const raw = { title: "Long Synopsis Film", overview: "x".repeat(500) };
    expect(tmdbToFilm(raw).syn.length).toBeLessThanOrEqual(200);
  });

  it("pulls the release year from the release date", () => {
    const raw = { title: "Some Film", release_date: "1999-03-31" };
    expect(tmdbToFilm(raw).y).toBe(1999);
  });
});
