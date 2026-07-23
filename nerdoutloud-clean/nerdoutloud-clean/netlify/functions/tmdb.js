// Netlify Function: proxies every TMDB request so the API key never ships to
// the browser. Set TMDB_KEY as an environment variable in the Netlify dashboard
// (Site configuration → Environment variables) — do NOT put it in the client code.
export default async (req) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return new Response(JSON.stringify({ error: "missing or invalid 'path' parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const key = process.env.TMDB_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "TMDB_KEY is not configured on the server" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const params = new URLSearchParams(url.searchParams);
  params.delete("path");
  params.set("api_key", key);

  const tmdbUrl = `https://api.themoviedb.org/3${path}?${params.toString()}`;

  try {
    const r = await fetch(tmdbUrl);
    const data = await r.text();
    return new Response(data, {
      status: r.status,
      headers: {
        "content-type": "application/json",
        // Cache at the edge briefly — cuts repeat calls for the same query without
        // going stale for long, since movie data doesn't change minute to minute.
        "cache-control": "public, max-age=1800",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "TMDB request failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/tmdb" };
