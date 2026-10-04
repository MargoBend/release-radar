// Server-side proxy for Hardcover: keeps HARDCOVER_TOKEN out of the browser.
// GET /.netlify/functions/hardcover-books?month=YYYY-MM  ->  { books: [...] }
const QUERY = `query Releases($from: date!, $to: date!) {
  books(
    where: { release_date: { _gte: $from, _lte: $to }, book_status_id: { _eq: 1 }, canonical_id: { _is_null: true } }
    order_by: { users_count: desc }
    limit: 200
  ) {
    id title subtitle slug release_date description users_count rating
    cached_image cached_contributors cached_tags
  }
}`;

export default async (req) => {
  const month = new URL(req.url).searchParams.get('month') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return Response.json({ error: 'Pass month=YYYY-MM' }, { status: 400 });
  }
  const raw = (process.env.HARDCOVER_TOKEN || '').trim();
  if (!raw) return Response.json({ error: 'HARDCOVER_TOKEN is not set in Netlify' }, { status: 500 });
  const token = raw.replace(/^Bearer\s+/i, '');

  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const res = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'ReleaseRadar/1.0 (personal release calendar)'
    },
    body: JSON.stringify({ query: QUERY, variables: { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` } })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const msg = body.error_description || body.error || body.errors?.[0]?.message || `Hardcover returned ${res.status}`;
    return Response.json({ error: msg }, { status: 502 });
  }
  return Response.json({ books: body.data?.books || [] }, {
    headers: {
      // Cache on Netlify's CDN for 6 hours so friends' visits don't use up the 5,000/day API limit.
      'Netlify-CDN-Cache-Control': 'public, max-age=21600, stale-while-revalidate=3600',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};
