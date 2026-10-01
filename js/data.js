// Lädt die statischen JSON-Dateien (Teilekatalog, Preise, Status, Zielpreise, FPS).

async function get(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadAll() {
  const fresh = { cache: 'no-cache' };
  const [catalog, prices, targets, fps] = await Promise.all([
    get('data/parts.json'),
    get('data/prices.json', fresh),
    get('config/targets.json'),
    get('data/fps.json'),
  ]);
  // status.json wird vom Workflow beim Deploy erzeugt und fehlt lokal oft – dann nur der Preisstand.
  const status = await get('data/status.json', fresh).catch(() => null);
  return { catalog, prices, targets, fps, status };
}

/** Aktueller Preis eines Teils: feste Preise (z. B. „keine Paste") oder Eintrag aus prices.json. */
export function currentOf(data, part) {
  if (part.fixed_price != null) return { price: part.fixed_price, merchant: null, url: null, source: 'fixed', availability: 'in_stock' };
  return data.prices.parts[part.id]?.current ?? null;
}

export const historyOf = (data, id) => data.prices.parts[id]?.history ?? [];

export function geizhalsUrl(part) {
  const slug = part.sources?.geizhals;
  return slug ? `https://geizhals.de/${slug}.html?hloc=de` : null;
}
