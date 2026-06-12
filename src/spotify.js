import 'dotenv/config';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Spotify auth failed: ' + JSON.stringify(data));

  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

export async function searchTracks(query, limit = 10) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit * 2) });
  const res = await fetch(`${SPOTIFY_API_BASE}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const tracks = data.tracks?.items ?? [];
  return tracks
    .filter(t => t.preview_url)
    .slice(0, limit)
    .map(t => ({
      spotify_id: t.id,
      title: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      preview_url: t.preview_url,
      genre: t.album?.genres?.[0] ?? null,
    }));
}

export async function getAudioFeatures(spotifyId) {
  const token = await getAccessToken();
  const res = await fetch(`${SPOTIFY_API_BASE}/audio-features/${spotifyId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.energy ?? null;
}
