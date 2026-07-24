// Netlify Function: proxies OMDb requests so the API key never ships to the
// browser. OMDb (omdbapi.com) is the standard source for Rotten Tomatoes,
// IMDb, and Metacritic scores in one place — TMDB does not provide these.
//
// Set OMDB_KEY as an environment variable in the Netlify dashboard (Site
// configuration → Environment variables). Get a free key (1,000 requests/day)
// at https://www.omdbapi.com/apikey.aspx — no cost, just an email signup.
export default async (req) => {
  const url = new URL(req.url);
  const title = url.searchParams.get("t");
  const year = url.searchParams.get("y");
  if (!title) {
    return new Response(JSON.stringify({ error: "missing 't' (title) parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const key = process.env.OMDB_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "OMDB_KEY is not configured on the server" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const params = new URLSearchParams({ apikey: key, t: title, type: "movie" });
  if (year) params.set("y", year);

  try {
    const r = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
    const data = await r.text();
    return new Response(data, {
      status: r.status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "OMDb request failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/omdb" };
