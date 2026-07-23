export const ARCHETYPE_NAMES = {
  alakazam: "Alakazam",
  archaludon: "Archaludon",
  beartic: "Beartic",
  clefairy: "Clefairy / Kangaskhan",
  comfey_control: "Comfey Control",
  crustle: "Crustle",
  cynthia: "Cynthia's Garchomp",
  dragapult: "Dragapult",
  froslass: "Froslass",
  hop: "Hop's Trevenant",
  iono: "Iono's Bellibolt",
  libraryout: "Library Out",
  lopunny: "Mega Lopunny",
  lucario: "Mega Lucario",
  marnie: "Marnie's Grimmsnarl",
  okidogi: "Okidogi / Lunatone",
  raging_bolt: "Raging Bolt",
  rocket_mill: "Team Rocket Mill",
  starmie: "Mega Starmie",
  unknown: "Unclassified",
};

export const ARCHETYPE_KO = ARCHETYPE_NAMES;

export const STRATEGY_NAMES = {
  prevention_wall: "Damage Wall",
  recovery_loop: "Recovery",
  hand_disruption: "Hand Disruption",
  energy_denial: "Energy Denial",
  gust_pressure: "Gust Pressure",
  energy_turbo: "Energy Acceleration",
  bulk_boost: "Bulk Boost",
  bench_snipe: "Bench Snipe",
  setup_consistency: "Setup Consistency",
  prize_trade: "Prize Trade",
  mill: "Mill",
};

export const TIER_META = {
  S: { label: "S", name: "Observed leader", color: "#b8f34a" },
  A: { label: "A", name: "Strong result", color: "#42d99a" },
  B: { label: "B", name: "Situational", color: "#f2bd57" },
  C: { label: "C", name: "Challenging", color: "#f07078" },
};

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function strategyNames(row) {
  return (row?.strategy_tags || []).map((tag) => STRATEGY_NAMES[tag] || tag.replaceAll("_", " "));
}

export function shortDeckName(row) {
  if (!row) return "Unknown deck";
  const base = ARCHETYPE_NAMES[row.l1] || row.l1.replaceAll("_", " ");
  const tags = strategyNames(row);
  return tags.length ? `${base} · ${tags.join(" / ")}` : `${base} · Standard`;
}

export function viewLabel(key, filters = {}) {
  if (key === "elite") return `Top ${filters.elite_top_rank || 50}`;
  if (key === "high") return `${filters.high_min_score || 1000}+ cohort`;
  return `${filters.min_score || 800}+ cohort`;
}

export function rowMap(rows) {
  return new Map((rows || []).map((row) => [row.unit, row]));
}

export function filterAndSortRows(rows, { query = "", tier = "all", sort = "bt" } = {}) {
  const needle = query.trim().toLowerCase();
  const filtered = (rows || []).filter((row) => {
    if (tier !== "all" && row.tier !== tier) return false;
    if (!needle) return true;
    const haystack = [row.unit, ARCHETYPE_NAMES[row.l1], ...(row.strategy_tags || []), ...strategyNames(row), ...(row.main_cards || []).map((card) => card.name)].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
  const field = { bt: "bt_wr_shrunk", pick: "pick_rate", games: "seats", raw: "raw_wr" }[sort] || "bt_wr_shrunk";
  return filtered.sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0) || Number(b.seats || 0) - Number(a.seats || 0) || shortDeckName(a).localeCompare(shortDeckName(b), "en"));
}

export function matchupResult(matrix, unitA, unitB) {
  if (!matrix || !unitA || !unitB) return null;
  if (unitA === unitB) return { rate: 0.5, n: 0, wins: 0, mirror: true, source: "mirror" };
  const direct = matrix.cells?.[`${unitA}|${unitB}`];
  if (direct?.n > 0) return { rate: direct.w / direct.n, n: direct.n, wins: direct.w, mirror: false, source: "direct" };
  const reverse = matrix.cells?.[`${unitB}|${unitA}`];
  if (reverse?.n > 0) return { rate: 1 - reverse.w / reverse.n, n: reverse.n, wins: reverse.n - reverse.w, mirror: false, source: "reverse" };
  return null;
}

export function confidenceFor(n, minReliable = 30) {
  if (!Number.isFinite(n) || n <= 0) return { key: "none", label: "No direct games", description: "These decks have not met directly." };
  if (n < minReliable) return { key: "low", label: "Low sample", description: `Only ${n} direct games; treat the direction cautiously.` };
  if (n < minReliable * 3) return { key: "medium", label: "Moderate sample", description: `${n} direct games.` };
  return { key: "high", label: "Strong sample", description: `${n} direct games.` };
}

export function tierCounts(rows) {
  const counts = { S: 0, A: 0, B: 0, C: 0 };
  for (const row of rows || []) if (Object.hasOwn(counts, row.tier)) counts[row.tier] += 1;
  return counts;
}

export function archetypeDistribution(view) {
  const source = view?.l1_distribution || {};
  const total = Object.entries(source).filter(([key]) => key !== "unknown").reduce((sum, [, value]) => sum + Number(value || 0), 0);
  return Object.entries(source).filter(([key]) => key !== "unknown").map(([key, count]) => ({ key, name: ARCHETYPE_NAMES[key] || key.replaceAll("_", " "), count, rate: total ? count / total : 0 })).sort((a, b) => b.count - a.count);
}

export function deriveInsights(aggregates) {
  const mainRows = aggregates?.views?.main?.rows || [];
  const eliteRows = aggregates?.views?.elite?.rows || [];
  return {
    strongest: [...mainRows].sort((a, b) => b.bt_wr_shrunk - a.bt_wr_shrunk)[0],
    mostPlayed: [...mainRows].sort((a, b) => b.pick_rate - a.pick_rate)[0],
    eliteLeader: [...eliteRows].sort((a, b) => b.bt_wr_shrunk - a.bt_wr_shrunk)[0],
  };
}

export function validateDatasetShape(aggregates, matchups) {
  const errors = [];
  if (!aggregates || typeof aggregates !== "object") errors.push("aggregates missing");
  if (!matchups || typeof matchups !== "object") errors.push("matchups missing");
  for (const key of ["main", "high", "elite"]) {
    const view = aggregates?.views?.[key];
    const matrix = matchups?.[key];
    if (!view || !Array.isArray(view.rows)) errors.push(`${key} rows missing`);
    if (!matrix || !Array.isArray(matrix.units) || typeof matrix.cells !== "object") { errors.push(`${key} matrix missing`); continue; }
    const units = new Set((view?.rows || []).map((row) => row.unit));
    for (const unit of matrix.units) if (!units.has(unit)) errors.push(`${key} matrix unit absent from rows: ${unit}`);
  }
  return errors;
}
