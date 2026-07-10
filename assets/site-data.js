export const ARCHETYPE_KO = {
  alakazam: "후딘",
  archaludon: "아르카루돈",
  beartic: "툰베어",
  clefairy: "삐삐 캥카",
  comfey_control: "큐아링 컨트롤",
  crustle: "암팰리스",
  cynthia: "난천 한카리아스",
  dragapult: "드래펄트",
  froslass: "눈여아",
  hop: "호브 백솜모카",
  iono: "나예리 일렉트릭",
  libraryout: "라이브러리 덱아웃",
  lopunny: "메가이어롭",
  lucario: "메가루카리오",
  marnie: "마리 오롱털",
  okidogi: "조타구 솔록",
  raging_bolt: "날뛰는우레",
  rocket_mill: "로켓단 밀",
  starmie: "아쿠스타",
  unknown: "미분류",
};

export const TIER_META = {
  S: { label: "S", name: "관측 선두", color: "#5b8cff" },
  A: { label: "A", name: "강한 관측치", color: "#29c7a9" },
  B: { label: "B", name: "상황형", color: "#f2bd57" },
  C: { label: "C", name: "도전적", color: "#f07078" },
};

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function shortDeckName(row) {
  if (!row) return "알 수 없는 덱";
  return String(row.display || row.unit)
    .replace(/ 덱 \(기본형\)$/u, " (기본)")
    .replace(/ 덱$/u, "")
    .replaceAll("데미지 방벽", "벽")
    .replaceAll("자원 재활용", "회수")
    .replaceAll("벤치 저격", "거스트")
    .replaceAll("에너지 견제", "에너지컷")
    .replaceAll("에너지 가속", "가속")
    .replaceAll("손패 교란", "손패")
    .replaceAll("맷집 강화", "맷집");
}

export function viewLabel(key, filters = {}) {
  if (key === "elite") return `Top ${filters.elite_top_rank || 50}`;
  if (key === "high") return `현재 ${filters.high_min_score || 1000}+ 코호트`;
  return `현재 ${filters.min_score || 800}+ 코호트`;
}

export function rowMap(rows) {
  return new Map((rows || []).map((row) => [row.unit, row]));
}

export function filterAndSortRows(rows, { query = "", tier = "all", sort = "bt" } = {}) {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = (rows || []).filter((row) => {
    if (tier !== "all" && row.tier !== tier) return false;
    if (!needle) return true;
    const haystack = [
      row.display,
      row.unit,
      ARCHETYPE_KO[row.l1],
      row.strategy,
      ...(row.strategy_tags || []),
      ...(row.strategy_tags_ko || []),
      ...(row.main_cards || []).map((card) => card.name),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
    return haystack.includes(needle);
  });

  const field = {
    bt: "bt_wr_shrunk",
    pick: "pick_rate",
    games: "seats",
    raw: "raw_wr",
  }[sort] || "bt_wr_shrunk";

  return filtered.sort((a, b) => {
    const delta = Number(b[field] || 0) - Number(a[field] || 0);
    return delta || Number(b.seats || 0) - Number(a.seats || 0) ||
      shortDeckName(a).localeCompare(shortDeckName(b), "ko");
  });
}

export function matchupResult(matrix, unitA, unitB) {
  if (!matrix || !unitA || !unitB) return null;
  if (unitA === unitB) {
    return { rate: 0.5, n: 0, wins: 0, mirror: true, source: "mirror" };
  }
  const direct = matrix.cells?.[`${unitA}|${unitB}`];
  if (direct && direct.n > 0) {
    return {
      rate: direct.w / direct.n,
      n: direct.n,
      wins: direct.w,
      mirror: false,
      source: "direct",
    };
  }
  const reverse = matrix.cells?.[`${unitB}|${unitA}`];
  if (reverse && reverse.n > 0) {
    return {
      rate: 1 - reverse.w / reverse.n,
      n: reverse.n,
      wins: reverse.n - reverse.w,
      mirror: false,
      source: "reverse",
    };
  }
  return null;
}

export function confidenceFor(n, minReliable = 30) {
  if (!Number.isFinite(n) || n <= 0) {
    return { key: "none", label: "직접 표본 없음", description: "직접 맞붙은 경기가 없습니다." };
  }
  if (n < minReliable) {
    return { key: "low", label: "저신뢰", description: `${n}판 표본이라 방향만 참고하세요.` };
  }
  if (n < minReliable * 3) {
    return { key: "medium", label: "보통 신뢰", description: `${n}판의 직접 대진 표본입니다.` };
  }
  return { key: "high", label: "높은 신뢰", description: `${n}판의 충분한 직접 대진 표본입니다.` };
}

export function tierCounts(rows) {
  const counts = { S: 0, A: 0, B: 0, C: 0 };
  for (const row of rows || []) {
    if (Object.hasOwn(counts, row.tier)) counts[row.tier] += 1;
  }
  return counts;
}

export function archetypeDistribution(view) {
  const source = view?.l1_distribution || {};
  const total = Object.entries(source)
    .filter(([key]) => key !== "unknown")
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);

  return Object.entries(source)
    .filter(([key]) => key !== "unknown")
    .map(([key, count]) => ({
      key,
      name: ARCHETYPE_KO[key] || key.replaceAll("_", " "),
      count,
      rate: total ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function deriveInsights(aggregates) {
  const mainRows = aggregates?.views?.main?.rows || [];
  const eliteRows = aggregates?.views?.elite?.rows || [];
  const strongest = [...mainRows].sort((a, b) => b.bt_wr_shrunk - a.bt_wr_shrunk)[0];
  const mostPlayed = [...mainRows].sort((a, b) => b.pick_rate - a.pick_rate)[0];
  const eliteLeader = [...eliteRows].sort((a, b) => b.bt_wr_shrunk - a.bt_wr_shrunk)[0];
  return { strongest, mostPlayed, eliteLeader };
}

export function validateDatasetShape(aggregates, matchups) {
  const errors = [];
  if (!aggregates || typeof aggregates !== "object") errors.push("aggregates missing");
  if (!matchups || typeof matchups !== "object") errors.push("matchups missing");
  for (const key of ["main", "high", "elite"]) {
    const view = aggregates?.views?.[key];
    const matrix = matchups?.[key];
    if (!view || !Array.isArray(view.rows)) errors.push(`${key} rows missing`);
    if (!matrix || !Array.isArray(matrix.units) || typeof matrix.cells !== "object") {
      errors.push(`${key} matrix missing`);
      continue;
    }
    const units = new Set((view?.rows || []).map((row) => row.unit));
    for (const unit of matrix.units) {
      if (!units.has(unit)) errors.push(`${key} matrix unit absent from rows: ${unit}`);
    }
  }
  return errors;
}
