import {
  ARCHETYPE_KO,
  TIER_META,
  archetypeDistribution,
  confidenceFor,
  deriveInsights,
  filterAndSortRows,
  formatNumber,
  formatPercent,
  matchupResult,
  rowMap,
  shortDeckName,
  tierCounts,
  validateDatasetShape,
  viewLabel,
} from "./assets/site-data.js";

const DATA_URLS = {
  aggregates: "./data/aggregates.json",
  matchups: "./data/matchups.json",
};

const state = {
  aggregates: null,
  matchups: null,
  matchupsPromise: null,
  view: "main",
  tier: "all",
  sort: "bt",
  query: "",
  matchupA: null,
  matchupB: null,
  activeDeck: null,
};

const els = {};

function cacheElements() {
  for (const id of [
    "theme-toggle", "freshness-line", "hero-feature-card", "metric-games",
    "metric-variants", "metric-window", "metric-filter", "metric-quality",
    "insight-grid", "distribution-list", "tier-shape", "deck-search",
    "view-select", "sort-select", "result-count", "deck-grid", "matchup-a",
    "matchup-b", "swap-matchup", "matchup-result", "deck-dialog", "dialog-close",
    "dialog-content", "method-diagnostics",
  ]) els[id] = document.getElementById(id);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

function tierBadge(tier, compact = false) {
  const meta = TIER_META[tier] || TIER_META.C;
  return `<span class="tier-badge tier-${escapeHtml(tier.toLowerCase())}${compact ? " is-compact" : ""}"><strong>${escapeHtml(meta.label)}</strong>${compact ? "" : `<small>${escapeHtml(meta.name)}</small>`}</span>`;
}

function cardArt(card, { eager = false, large = false } = {}) {
  if (!card?.img) return `<span class="card-placeholder" aria-hidden="true">?</span>`;
  const size = large ? 180 : 92;
  return `<span class="card-art-wrap${large ? " is-large" : ""}" data-fallback="${escapeHtml((card.name || "?").slice(0, 1))}">
    <img class="card-art" src="${escapeHtml(card.img)}" alt="" width="${size}" height="${Math.round(size * 1.39)}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">
  </span>`;
}

function confidenceBadge(confidence) {
  return `<span class="confidence-badge confidence-${confidence.key}"><span aria-hidden="true"></span>${escapeHtml(confidence.label)}</span>`;
}

function rowEvidence(row) {
  const share = Number(row?.top_team_share || 0);
  const teams = Number(row?.team_count || 0);
  if (teams < 3 || share >= 0.8) {
    return { key: "low", label: "파일럿 편중", description: `최대 단일 팀 비중 ${formatPercent(share)} · ${formatNumber(teams)}팀` };
  }
  if (share >= 0.5) {
    return { key: "medium", label: "파일럿 주의", description: `최대 단일 팀 비중 ${formatPercent(share)} · ${formatNumber(teams)}팀` };
  }
  return { key: "high", label: "팀 분산", description: `최대 단일 팀 비중 ${formatPercent(share)} · ${formatNumber(teams)}팀` };
}

function currentView() {
  return state.aggregates.views[state.view];
}

function currentRows() {
  return currentView()?.rows || [];
}

function currentRowMap() {
  return rowMap(currentRows());
}

function getRow(unit, preferredView = state.view) {
  const preferred = state.aggregates?.views?.[preferredView]?.rows?.find((row) => row.unit === unit);
  if (preferred) return preferred;
  return state.aggregates?.views?.main?.rows?.find((row) => row.unit === unit) || null;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function ensureMatchups() {
  if (state.matchups) return state.matchups;
  if (!state.matchupsPromise) {
    state.matchupsPromise = fetchJson(DATA_URLS.matchups)
      .then((data) => {
        state.matchups = data;
        const errors = validateDatasetShape(state.aggregates, state.matchups);
        if (errors.length) throw new Error(errors.join("; "));
        return data;
      })
      .catch((error) => {
        state.matchupsPromise = null;
        throw error;
      });
  }
  return state.matchupsPromise;
}

function setupTheme() {
  const stored = localStorage.getItem("ptcg-theme");
  const preferred = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const theme = stored || preferred;
  document.documentElement.dataset.theme = theme;
  updateThemeButton(theme);

  els["theme-toggle"].addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ptcg-theme", next);
    updateThemeButton(next);
  });
}

function updateThemeButton(theme) {
  const isLight = theme === "light";
  els["theme-toggle"].setAttribute("aria-pressed", String(isLight));
  els["theme-toggle"].setAttribute("aria-label", isLight ? "어두운 테마로 전환" : "밝은 테마로 전환");
}

function renderHero() {
  const aggregates = state.aggregates;
  const main = aggregates.views.main;
  const strongest = deriveInsights(aggregates).strongest;
  const dateRange = aggregates.date_range || [];
  const classified = 1 - Number(main.unknown_seat_share || 0);

  els["metric-games"].textContent = formatNumber(main.games);
  els["metric-variants"].textContent = formatNumber(main.rows.length);
  els["metric-window"].textContent = dateRange.length === 2
    ? `${dateRange[0].slice(5).replace("-", ".")} — ${dateRange[1].slice(5).replace("-", ".")}`
    : "—";
  els["metric-filter"].textContent = `양측 ${aggregates.filters.min_score}+`;
  els["metric-quality"].textContent = formatPercent(classified);
  els["freshness-line"].innerHTML = `<span aria-hidden="true"></span><strong>${escapeHtml(aggregates.generated_at_kst)}</strong> 갱신 · ${formatNumber(main.games)} games`;

  if (!strongest) return;
  const card = strongest.main_cards?.[0];
  els["hero-feature-card"].innerHTML = `
    <div class="feature-card-top">
      <span class="feature-label">TOP OBSERVED / CURRENT 800+</span>
      ${tierBadge(strongest.tier, true)}
    </div>
    <div class="feature-card-body">
      ${cardArt(card, { eager: true, large: true })}
      <div class="feature-copy">
        <small>${escapeHtml(ARCHETYPE_KO[strongest.l1] || strongest.l1)}</small>
        <h2>${escapeHtml(shortDeckName(strongest))}</h2>
        <div class="feature-score"><strong>${formatPercent(strongest.bt_wr_shrunk)}</strong><span>BT 보정</span></div>
        <button type="button" class="text-button" data-open-unit="${escapeHtml(strongest.unit)}">상세 보기 <span aria-hidden="true">→</span></button>
      </div>
    </div>
    <div class="feature-card-foot"><span>픽률 ${formatPercent(strongest.pick_rate)}</span><span>${formatNumber(strongest.seats)} seats</span></div>`;
}

function renderInsights() {
  const { strongest, mostPlayed, eliteLeader } = deriveInsights(state.aggregates);
  const items = [
    { eyebrow: "관측 최고 보정값", row: strongest, value: strongest ? formatPercent(strongest.bt_wr_shrunk) : "—", note: "현재 800+ 코호트" },
    { eyebrow: "메타 중심", row: mostPlayed, value: mostPlayed ? formatPercent(mostPlayed.pick_rate) : "—", note: "전체 픽률" },
    { eyebrow: "상위권 선두", row: eliteLeader, value: eliteLeader ? formatPercent(eliteLeader.bt_wr_shrunk) : "—", note: `Top ${state.aggregates.filters.elite_top_rank}` },
  ];

  els["insight-grid"].innerHTML = items.map((item, index) => {
    if (!item.row) return "";
    return `<article class="insight-card insight-${index + 1}">
      <div class="insight-number">0${index + 1}</div>
      <div class="insight-art">${cardArt(item.row.main_cards?.[0])}</div>
      <div class="insight-copy">
        <p>${escapeHtml(item.eyebrow)}</p>
        <h3>${escapeHtml(shortDeckName(item.row))}</h3>
        <div><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.note)}</span></div>
      </div>
      <button class="card-hit-area" type="button" data-open-unit="${escapeHtml(item.row.unit)}" aria-label="${escapeHtml(shortDeckName(item.row))} 상세 보기"></button>
    </article>`;
  }).join("");
}

function renderOverviewCharts() {
  const main = state.aggregates.views.main;
  const distribution = archetypeDistribution(main);
  const visible = distribution.slice(0, 7);
  const restRate = distribution.slice(7).reduce((sum, item) => sum + item.rate, 0);
  if (restRate > 0) visible.push({ key: "other", name: "기타", rate: restRate });

  els["distribution-list"].innerHTML = visible.map((item, index) => `
    <div class="distribution-row">
      <div class="distribution-label"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.name)}</strong></div>
      <div class="distribution-track" aria-label="${escapeHtml(item.name)} ${formatPercent(item.rate)}">
        <span style="--bar: ${Math.max(item.rate * 100, 1)}%"></span>
      </div>
      <strong class="distribution-value">${formatPercent(item.rate)}</strong>
    </div>`).join("");

  const counts = tierCounts(main.rows);
  const total = Math.max(main.rows.length, 1);
  els["tier-shape"].innerHTML = Object.entries(counts).map(([tier, count]) => `
    <div class="tier-shape-row">
      ${tierBadge(tier, true)}
      <div class="tier-shape-track"><span class="tier-${tier.toLowerCase()}" style="--bar: ${(count / total) * 100}%"></span></div>
      <div><strong>${count}</strong><small>변형</small></div>
    </div>`).join("");
}

function renderMethodDiagnostics() {
  const main = state.aggregates.views.main;
  const pilotBound = main.rows.filter((row) => row.team_count < 3 || row.top_team_share >= 0.8).length;
  const dates = Object.values(main.date_distribution || {});
  const minDay = dates.length ? Math.min(...dates) : 0;
  const maxDay = dates.length ? Math.max(...dates) : 0;
  els["method-diagnostics"].innerHTML = `
    <div><small>좌석 0 승률</small><strong>${formatPercent(main.seat0_win_rate)}</strong><span>순서 편향 미보정</span></div>
    <div><small>파일럿 편중</small><strong>${pilotBound}/${main.rows.length}</strong><span>단일팀 80%+ 또는 3팀 미만</span></div>
    <div><small>일별 표본 범위</small><strong>${formatNumber(minDay)}–${formatNumber(maxDay)}</strong><span>최근 날짜는 부분 수집 가능</span></div>
    <p>이 리포트는 <strong>덱+파일럿의 관측 래더 성과</strong>를 설명합니다. 인과적인 덱 단독 성능 예측으로 읽지 마세요.</p>`;
}

function deckCard(row, index) {
  const card = row.main_cards?.[0];
  const confidence = rowEvidence(row);
  return `<article class="deck-card" style="--delay: ${Math.min(index, 12) * 32}ms">
    <button class="deck-card-button" type="button" data-open-unit="${escapeHtml(row.unit)}" aria-label="${escapeHtml(shortDeckName(row))} 상세 보기">
      <div class="deck-card-head">
        ${tierBadge(row.tier, true)}
        <span class="deck-rank">#${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="deck-card-main">
        <div class="deck-card-art">${cardArt(card)}</div>
        <div class="deck-card-copy">
          <p>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)}</p>
          <h3>${escapeHtml(shortDeckName(row))}</h3>
          <div class="tag-list">${(row.strategy_tags_ko || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>기본형</span>"}</div>
        </div>
      </div>
      <div class="deck-card-stats">
        <div><small>BT</small><strong>${formatPercent(row.bt_wr_shrunk)}</strong></div>
        <div><small>픽률</small><strong>${formatPercent(row.pick_rate)}</strong></div>
        <div><small>표본</small><strong>${formatNumber(row.seats)}</strong></div>
      </div>
      <div class="deck-card-foot">
        ${confidenceBadge(confidence)}
        <span>분석 열기 <span aria-hidden="true">↗</span></span>
      </div>
    </button>
  </article>`;
}

function renderDecks() {
  const rows = filterAndSortRows(currentRows(), {
    query: state.query,
    tier: state.tier,
    sort: state.sort,
  });
  els["result-count"].textContent = `${rows.length}개 변형`;
  els["deck-grid"].setAttribute("aria-busy", "false");
  if (!rows.length) {
    els["deck-grid"].innerHTML = `<div class="empty-state"><span aria-hidden="true">⌕</span><h3>조건에 맞는 덱이 없습니다</h3><p>검색어를 줄이거나 티어 필터를 바꿔보세요.</p><button type="button" data-reset-filters>필터 초기화</button></div>`;
    return;
  }
  els["deck-grid"].innerHTML = rows.map(deckCard).join("");
}

function resetFilters() {
  state.query = "";
  state.tier = "all";
  els["deck-search"].value = "";
  updateTierButtons();
  renderDecks();
}

function updateTierButtons() {
  document.querySelectorAll("[data-tier]").forEach((button) => {
    const active = button.dataset.tier === state.tier;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function bindExplorer() {
  let searchFrame;
  els["deck-search"].addEventListener("input", (event) => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => {
      state.query = event.target.value;
      renderDecks();
    });
  });
  els["view-select"].addEventListener("change", async (event) => {
    state.view = event.target.value;
    renderDecks();
    populateMatchupSelectors();
    if (state.matchups) renderMatchup();
  });
  els["sort-select"].addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderDecks();
  });
  document.querySelector(".filter-row").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tier]");
    if (!button) return;
    state.tier = button.dataset.tier;
    updateTierButtons();
    renderDecks();
  });
}

function selectorOptions(rows) {
  return rows.map((row) => `<option value="${escapeHtml(row.unit)}">${escapeHtml(`[${row.tier}] ${shortDeckName(row)}`)}</option>`).join("");
}

function populateMatchupSelectors() {
  const rows = currentRows();
  if (!rows.length) return;
  const units = new Set(rows.map((row) => row.unit));
  if (!units.has(state.matchupA)) state.matchupA = rows[0].unit;
  if (!units.has(state.matchupB) || state.matchupB === state.matchupA) {
    state.matchupB = rows.find((row) => row.unit !== state.matchupA)?.unit || rows[0].unit;
  }
  const options = selectorOptions(rows);
  els["matchup-a"].innerHTML = options;
  els["matchup-b"].innerHTML = options;
  els["matchup-a"].value = state.matchupA;
  els["matchup-b"].value = state.matchupB;
}

function matchupDeckMini(row, side) {
  return `<div class="matchup-deck matchup-deck-${side}">
    <div class="matchup-deck-art">${cardArt(row.main_cards?.[0])}</div>
    <div>${tierBadge(row.tier, true)}<p>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)}</p><h3>${escapeHtml(shortDeckName(row))}</h3></div>
    <button type="button" data-open-unit="${escapeHtml(row.unit)}">상세</button>
  </div>`;
}

function renderMatchupLoading() {
  els["matchup-result"].innerHTML = `<div class="matchup-loading"><span class="spinner" aria-hidden="true"></span><p>직접 대진 표본을 불러오는 중…</p></div>`;
}

async function renderMatchup() {
  renderMatchupLoading();
  try {
    await ensureMatchups();
  } catch (error) {
    els["matchup-result"].innerHTML = `<div class="inline-error"><strong>상성 데이터를 불러오지 못했습니다.</strong><span>${escapeHtml(error.message)}</span><button type="button" data-retry-matchups>다시 시도</button></div>`;
    return;
  }

  const rows = currentRowMap();
  const rowA = rows.get(state.matchupA);
  const rowB = rows.get(state.matchupB);
  if (!rowA || !rowB) return;
  const result = matchupResult(state.matchups[state.view], rowA.unit, rowB.unit);
  const minN = state.aggregates.filters.min_n_cell;
  const confidence = confidenceFor(result?.n || 0, minN);
  const rateA = result?.rate ?? 0.5;
  const rateB = 1 - rateA;
  const verdict = !result || result.mirror
    ? "미러전 기준값"
    : rateA >= 0.55 ? `${shortDeckName(rowA)} 우세`
      : rateA <= 0.45 ? `${shortDeckName(rowA)} 열세` : "팽팽한 대진";

  els["matchup-result"].innerHTML = `
    <div class="matchup-stage">
      ${matchupDeckMini(rowA, "a")}
      <div class="versus-mark" aria-hidden="true">VS</div>
      ${matchupDeckMini(rowB, "b")}
    </div>
    <div class="matchup-scoreboard">
      <div class="matchup-score-head">
        <div><span>내 덱 승률</span><strong>${result ? formatPercent(rateA) : "—"}</strong></div>
        <div class="matchup-verdict"><span>${escapeHtml(viewLabel(state.view, state.aggregates.filters))}</span><strong>${escapeHtml(verdict)}</strong></div>
        <div><span>상대 덱 승률</span><strong>${result ? formatPercent(rateB) : "—"}</strong></div>
      </div>
      <div class="matchup-bar${result ? "" : " is-empty"}" role="img" aria-label="${result ? `${shortDeckName(rowA)} ${formatPercent(rateA)}, ${shortDeckName(rowB)} ${formatPercent(rateB)}` : "직접 대진 표본 없음"}">
        <span class="matchup-bar-a" style="--share: ${rateA * 100}%"></span>
        <span class="matchup-bar-b" style="--share: ${rateB * 100}%"></span>
      </div>
      <div class="matchup-evidence">
        ${confidenceBadge(confidence)}
        <p>${result?.mirror ? "같은 변형끼리의 셀은 집계표에서 제외됩니다." : result ? `${formatNumber(result.n)}판 · ${formatNumber(result.wins)}승 ${formatNumber(result.n - result.wins)}패 · ${escapeHtml(confidence.description)}` : "두 변형이 직접 맞붙은 공개 경기 표본이 없습니다."}</p>
      </div>
    </div>`;
}

function bindMatchup() {
  els["matchup-a"].addEventListener("change", (event) => {
    state.matchupA = event.target.value;
    renderMatchup();
  });
  els["matchup-b"].addEventListener("change", (event) => {
    state.matchupB = event.target.value;
    renderMatchup();
  });
  els["swap-matchup"].addEventListener("click", () => {
    [state.matchupA, state.matchupB] = [state.matchupB, state.matchupA];
    els["matchup-a"].value = state.matchupA;
    els["matchup-b"].value = state.matchupB;
    renderMatchup();
  });

  const section = document.getElementById("matchup");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      renderMatchup();
    }, { rootMargin: "300px" });
    observer.observe(section);
  } else {
    renderMatchup();
  }
}

function matchupList(items, label, rows) {
  if (!items?.length) return `<div class="detail-empty">직접 표본이 충분한 상대가 없습니다.</div>`;
  return `<div class="detail-matchup-list">${items.map((item) => {
    const opponent = rows.get(item.vs) || getRow(item.vs, "main");
    const confidence = confidenceFor(item.n, state.aggregates.filters.min_n_cell);
    return `<button type="button" data-compare-opponent="${escapeHtml(item.vs)}">
      <span class="matchup-list-copy"><small>${escapeHtml(label)}</small><strong>${escapeHtml(opponent ? shortDeckName(opponent) : item.vs)}</strong></span>
      <span class="matchup-list-score"><strong>${formatPercent(item.wr)}</strong><small>${formatNumber(item.n)}판 · ${escapeHtml(confidence.label)}</small></span>
    </button>`;
  }).join("")}</div>`;
}

function deckListText(row) {
  return (row.modal_deck || []).map((card) => `${card.qty} ${card.name}`).join("\n");
}

function renderDialog(row) {
  const rows = currentRowMap();
  const confidence = rowEvidence(row);
  const cardGallery = (row.main_cards || []).slice(0, 5);
  const modalCount = (row.modal_deck || []).reduce((sum, card) => sum + card.qty, 0);
  els["dialog-content"].innerHTML = `
    <header class="detail-hero">
      <div class="detail-hero-art">${cardGallery.slice(0, 3).map((card, index) => cardArt(card, { eager: index === 0, large: true })).join("")}</div>
      <div class="detail-hero-copy">
        <div class="detail-labels">${tierBadge(row.tier)}${confidenceBadge(confidence)}</div>
        <p>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)} · ${escapeHtml(viewLabel(state.view, state.aggregates.filters))}</p>
        <h2 id="dialog-title">${escapeHtml(shortDeckName(row))}</h2>
        <div class="tag-list is-large">${(row.strategy_tags_ko || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>기본형</span>"}</div>
        <p class="detail-strategy">${escapeHtml(row.strategy || "메인 어태커 중심의 정공법 비트다운.")}</p>
      </div>
    </header>

    <div class="detail-stat-grid">
      <div><small>BT 보정</small><strong>${formatPercent(row.bt_wr_shrunk)}</strong><span>티어 판정값</span></div>
      <div><small>원승률</small><strong>${formatPercent(row.raw_wr)}</strong><span>실제 W/L</span></div>
      <div><small>픽률</small><strong>${formatPercent(row.pick_rate)}</strong><span>전체 좌석</span></div>
      <div><small>표본</small><strong>${formatNumber(row.seats)}</strong><span>seats</span></div>
    </div>

    <div class="detail-evidence-strip">
      <div><small>관측 팀</small><strong>${formatNumber(row.team_count)}</strong></div>
      <div><small>최대 단일 팀 비중</small><strong>${formatPercent(row.top_team_share)}</strong></div>
      <div><small>좌석 0 비중</small><strong>${formatPercent(row.seat0_share)}</strong></div>
      <p>${escapeHtml(confidence.description)}. 표본 수가 커도 한 팀에 편중되면 일반화 신뢰도는 낮습니다.</p>
    </div>

    <section class="detail-section">
      <div class="detail-section-heading"><div><p>HEAD TO HEAD</p><h3>어디서 막히고, 어디를 뚫는가</h3></div><span>버튼을 누르면 상성 연구소로 이동</span></div>
      <div class="detail-matchups">
        <div><h4><span class="down-arrow" aria-hidden="true">↓</span> 카운터</h4>${matchupList(row.counters, "불리", rows)}</div>
        <div><h4><span class="up-arrow" aria-hidden="true">↑</span> 유리 상대</h4>${matchupList(row.preys, "유리", rows)}</div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><div><p>CORE CARDS</p><h3>대표 카드</h3></div><span>변형 내 50%+ 채용 우선</span></div>
      <div class="core-card-grid">${cardGallery.map((card) => `<article>${cardArt(card, { large: true })}<strong>${escapeHtml(card.name)}</strong><span>${formatPercent(card.presence)} 채용</span></article>`).join("")}</div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><div><p>MODAL LIST</p><h3>가장 자주 관측된 리스트</h3></div><span>${formatPercent(row.modal_deck_share)} 일치 · ${modalCount}장</span></div>
      <div class="decklist-shell">
        <div class="decklist-grid">${(row.modal_deck || []).map((card) => `<div><strong>${card.qty}</strong><span>${escapeHtml(card.name)}</span></div>`).join("")}</div>
        <button class="copy-button" type="button" data-copy-deck>덱 리스트 복사</button>
      </div>
    </section>`;
}

function setDeckUrl(unit = null) {
  const url = new URL(window.location.href);
  if (unit) url.searchParams.set("deck", unit);
  else url.searchParams.delete("deck");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function openDeck(unit, { updateUrl = true } = {}) {
  const row = getRow(unit);
  if (!row) return;
  state.activeDeck = row.unit;
  renderDialog(row);
  if (updateUrl) setDeckUrl(row.unit);
  if (!els["deck-dialog"].open) els["deck-dialog"].showModal();
}

function closeDialog() {
  if (els["deck-dialog"].open) els["deck-dialog"].close();
}

async function copyDeckList() {
  const row = getRow(state.activeDeck);
  const button = els["dialog-content"].querySelector("[data-copy-deck]");
  if (!row || !button) return;
  try {
    await navigator.clipboard.writeText(deckListText(row));
    button.textContent = "복사 완료 ✓";
  } catch {
    button.textContent = "복사 실패";
  }
  window.setTimeout(() => { button.textContent = "덱 리스트 복사"; }, 1800);
}

function compareFromDialog(opponentUnit) {
  const rows = currentRowMap();
  if (!rows.has(state.activeDeck) || !rows.has(opponentUnit)) {
    state.view = "main";
    els["view-select"].value = "main";
  }
  state.matchupA = state.activeDeck;
  state.matchupB = opponentUnit;
  populateMatchupSelectors();
  closeDialog();
  document.getElementById("matchup").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  renderMatchup();
}

function bindDialog() {
  els["dialog-close"].addEventListener("click", closeDialog);
  els["deck-dialog"].addEventListener("click", (event) => {
    if (event.target === els["deck-dialog"]) closeDialog();
  });
  els["deck-dialog"].addEventListener("close", () => {
    state.activeDeck = null;
    setDeckUrl();
  });
  els["dialog-content"].addEventListener("click", (event) => {
    const comparison = event.target.closest("[data-compare-opponent]");
    if (comparison) compareFromDialog(comparison.dataset.compareOpponent);
    if (event.target.closest("[data-copy-deck]")) copyDeckList();
  });
}

function bindDelegatedActions() {
  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-unit]");
    if (openButton) openDeck(openButton.dataset.openUnit);
    if (event.target.closest("[data-reset-filters]")) resetFilters();
    if (event.target.closest("[data-retry-matchups]")) renderMatchup();
  });
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("card-art")) return;
    image.closest(".card-art-wrap")?.classList.add("is-broken");
    image.remove();
  }, true);
}

function renderError(error) {
  document.querySelector("main").innerHTML = `<section class="fatal-error section-shell"><span aria-hidden="true">!</span><p class="eyebrow">DATA LOAD ERROR</p><h1>리포트를 불러오지 못했습니다.</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" type="button" onclick="window.location.reload()">새로고침</button><a href="./README.md">README 원본 보기</a></section>`;
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function setupNetworkStatus() {
  window.addEventListener("offline", () => {
    els["freshness-line"].classList.add("is-offline");
    els["freshness-line"].innerHTML = `<span aria-hidden="true"></span><strong>오프라인</strong> · 마지막 저장 데이터를 표시할 수 있습니다.`;
  });
  window.addEventListener("online", () => {
    els["freshness-line"].classList.remove("is-offline");
    renderHero();
  });
}

function openDeepLink() {
  const unit = new URL(window.location.href).searchParams.get("deck");
  if (unit) openDeck(unit, { updateUrl: false });
}

async function init() {
  cacheElements();
  setupTheme();
  bindDelegatedActions();
  bindDialog();

  try {
    state.aggregates = await fetchJson(DATA_URLS.aggregates);
    const preliminaryErrors = validateDatasetShape(state.aggregates, { main: { units: [], cells: {} }, elite: { units: [], cells: {} } })
      .filter((error) => !error.includes("matrix unit"));
    if (preliminaryErrors.some((error) => error.includes("rows missing"))) throw new Error(preliminaryErrors.join("; "));
    renderHero();
    renderInsights();
    renderOverviewCharts();
    renderMethodDiagnostics();
    renderDecks();
    populateMatchupSelectors();
    bindExplorer();
    bindMatchup();
    openDeepLink();
    setupServiceWorker();
    setupNetworkStatus();
  } catch (error) {
    renderError(error);
  }
}

init();
