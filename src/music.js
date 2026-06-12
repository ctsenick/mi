const ITUNES_API = 'https://itunes.apple.com/search';

export async function searchTracks(query, limit = 10) {
  const params = new URLSearchParams({
    term: query,
    entity: 'song',
    limit: String(limit * 2),
    media: 'music',
  });

  const res = await fetch(`${ITUNES_API}?${params}`);
  const data = await res.json();

  return (data.results ?? [])
    .filter(t => t.previewUrl)
    .slice(0, limit)
    .map(t => ({
      spotify_id: String(t.trackId),
      title: t.trackName,
      artist: t.artistName,
      preview_url: t.previewUrl,
      genre: t.primaryGenreName ?? null,
    }));
}

// iTunes doesn't provide energy values — return null so DB stores null
// Song contrast will fall back to random selection
export async function getAudioFeatures(_trackId) {
  return null;
}
