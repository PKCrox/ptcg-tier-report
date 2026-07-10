import {
  ARCHETYPE_KO,
  TIER_META,
  archetypeDistribution,
  confidenceFor,
  filterAndSortRows,
  formatNumber,
  formatPercent,
  matchupResult,
  rowMap,
  shortDeckName,
  validateDatasetShape,
  viewLabel,
} from "./assets/site-data.js";

const DATA_URLS = {
  aggregates: "./data/aggregates.json",
  matchups: "./data/matchups.json",
};

const TIER_ORDER = ["S", "A", "B", "C"];

const state = {
  aggregates: null,
  matchups: null,
  matchupsPromise: null,
  view: "main",
  tier: "all",
  sort: "bt",
  query: "",
  band: "all",
  matchupA: null,
  matchupB: null,
  activeDeck: null,
};

const els = {};

function cacheElements() {
  for (const id of [
    "theme-toggle", "freshness-line", "distribution-list",
    "band-row", "deck-search", "view-select", "sort-select", "result-count",
    "deck-grid", "matchup-a", "matchup-b", "swap-matchup", "matchup-result",
    "deck-dialog", "dialog-close", "dialog-content", "method-diagnostics",
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

function tierBadge(tier) {
  const meta = TIER_META[tier] || TIER_META.C;
  return `<span class="tier-badge tier-${escapeHtml(tier.toLowerCase())}"><strong>${escapeHtml(meta.label)}</strong></span>`;
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
  const detail = `판의 ${formatPercent(share)}가 최다 사용 한 팀 몫 · 쓴 팀 ${formatNumber(teams)}개`;
  if (teams < 3 || share >= 0.8) {
    return { key: "low", label: "한 팀 위주", description: detail };
  }
  if (share >= 0.5) {
    return { key: "medium", label: "소수 팀 위주", description: detail };
  }
  return { key: "high", label: "여러 팀 사용", description: detail };
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

function freshnessLabel(generatedAtKst) {
  const generated = String(generatedAtKst || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(generated)) return "갱신 시점 미상";
  const todayKst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const days = Math.round((new Date(todayKst) - new Date(generated)) / 86400000);
  if (days <= 0) return "오늘 갱신";
  if (days === 1) return "어제 갱신";
  return `${days}일 전 갱신`;
}

function renderMeta() {
  els["freshness-line"].innerHTML =
    `<span aria-hidden="true"></span>${escapeHtml(freshnessLabel(state.aggregates.generated_at_kst))}`;
}

function selectedBandSource() {
  if (state.band === "all") return state.aggregates.views.main;
  const band = (state.aggregates.score_bands || []).find((item) => item.band === state.band);
  return band || state.aggregates.views.main;
}

function renderBandChips() {
  const bands = state.aggregates.score_bands || [];
  els["band-row"].innerHTML = [
    `<button class="filter-chip${state.band === "all" ? " is-active" : ""}" type="button" data-band="all" aria-pressed="${state.band === "all"}">전체 (800+)</button>`,
    ...bands.map((band) => `<button class="filter-chip${state.band === band.band ? " is-active" : ""}" type="button" data-band="${escapeHtml(band.band)}" aria-pressed="${state.band === band.band}">${escapeHtml(band.band)}</button>`),
    `<span class="result-count">덱 등장 ${formatNumber(selectedBandSource().seats ?? selectedBandSource().games * 2)}회</span>`,
  ].join("");
}

function renderStats() {
  const distribution = archetypeDistribution(selectedBandSource());
  const visible = distribution.slice(0, 10);
  const restRate = distribution.slice(10).reduce((sum, item) => sum + item.rate, 0);
  if (restRate > 0) visible.push({ key: "other", name: "기타", rate: restRate });

  els["distribution-list"].innerHTML = visible.map((item, index) => `
    <div class="distribution-row">
      <div class="distribution-label"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.name)}</strong></div>
      <div class="distribution-track" aria-label="${escapeHtml(item.name)} ${formatPercent(item.rate)}">
        <span style="--bar: ${Math.max(item.rate * 100, 1)}%"></span>
      </div>
      <strong class="distribution-value">${formatPercent(item.rate)}</strong>
    </div>`).join("");
}

function bindBandChips() {
  els["band-row"].addEventListener("click", (event) => {
    const button = event.target.closest("[data-band]");
    if (!button) return;
    state.band = button.dataset.band;
    renderBandChips();
    renderStats();
  });
}

function renderMethodDiagnostics() {
  const main = state.aggregates.views.main;
  const pilotBound = main.rows.filter((row) => row.team_count < 3 || row.top_team_share >= 0.8).length;
  els["method-diagnostics"].innerHTML = `
    <span>1번 자리 승률 <strong>${formatPercent(main.seat0_win_rate)}</strong></span>
    <span>한 팀 위주 덱 <strong>${pilotBound}/${main.rows.length}</strong></span>
    <span>덱 미분류 비율 <strong>${formatPercent(main.unknown_seat_share)}</strong></span>`;
}

function deckRow(row) {
  const arts = (row.main_cards || []).slice(0, 3).map((card) => cardArt(card)).join("");
  const evidence = rowEvidence(row);
  const warn = evidence.key !== "high"
    ? `<span class="row-flag" title="${escapeHtml(`${evidence.label} — ${evidence.description}`)}" aria-label="${escapeHtml(evidence.label)}">⚠</span>`
    : "";
  return `<article class="deck-card">
    <button class="deck-card-button" type="button" data-open-unit="${escapeHtml(row.unit)}" aria-label="${escapeHtml(shortDeckName(row))} 상세 보기">
      <span class="deck-arts">${arts || `<span class="card-placeholder" aria-hidden="true">?</span>`}</span>
      <span class="deck-name">
        <strong>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)}</strong>
        <span class="deck-tags">${(row.strategy_tags_ko || []).map((tag) => `<em>${escapeHtml(tag)}</em>`).join("") || "<em>기본형</em>"}</span>
      </span>
      <span class="deck-stats">
        <span class="deck-stat stat-bt tier-text-${escapeHtml(row.tier.toLowerCase())}"><strong>${formatPercent(row.bt_wr_shrunk)}</strong><small>PKC</small></span>
        <span class="deck-stat"><strong>${formatPercent(row.raw_wr)}</strong><small>승률</small></span>
        <span class="deck-stat"><strong>${formatPercent(row.pick_rate)}</strong><small>픽률</small></span>
        <span class="deck-stat"><strong>${formatNumber(row.seats)}</strong><small>판수</small></span>
      </span>
      <span class="deck-flag">${warn}</span>
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
    els["deck-grid"].innerHTML = `<div class="empty-state"><span aria-hidden="true">⌕</span><h3>조건에 맞는 덱 없음</h3><button type="button" data-reset-filters>필터 초기화</button></div>`;
    return;
  }

  const groups = TIER_ORDER
    .map((tier) => ({ tier, rows: rows.filter((row) => row.tier === tier) }))
    .filter((group) => group.rows.length);

  els["deck-grid"].innerHTML = groups.map((group) => `
    <section class="tier-group tier-group-${group.tier.toLowerCase()}">
      <div class="tier-rail">${tierBadge(group.tier)}<small>${group.rows.length}</small></div>
      <div class="tier-rows">${group.rows.map(deckRow).join("")}</div>
    </section>`).join("");
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
    renderMeta();
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
    <div>${tierBadge(row.tier)}<p>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)}</p><h3>${escapeHtml(shortDeckName(row))}</h3></div>
    <button type="button" data-open-unit="${escapeHtml(row.unit)}">상세</button>
  </div>`;
}

function renderMatchupLoading() {
  els["matchup-result"].innerHTML = `<div class="matchup-loading"><span class="spinner" aria-hidden="true"></span><p>대진 표본 로딩 중…</p></div>`;
}

async function renderMatchup() {
  renderMatchupLoading();
  try {
    await ensureMatchups();
  } catch (error) {
    els["matchup-result"].innerHTML = `<div class="inline-error"><strong>상성 데이터 로드 실패</strong><span>${escapeHtml(error.message)}</span><button type="button" data-retry-matchups>다시 시도</button></div>`;
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
    ? "미러전"
    : rateA >= 0.55 ? `${shortDeckName(rowA)} 우세`
      : rateA <= 0.45 ? `${shortDeckName(rowA)} 열세` : "팽팽";

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
        <p>${result?.mirror ? "동일 변형 셀은 집계에서 제외" : result ? `${formatNumber(result.n)}판 · ${formatNumber(result.wins)}승 ${formatNumber(result.n - result.wins)}패` : "직접 대진 표본 없음"}</p>
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
  if (!items?.length) return `<div class="detail-empty">직접 표본 충분한 상대 없음</div>`;
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
        <p class="detail-strategy">${escapeHtml(row.strategy || "")}</p>
      </div>
    </header>

    <div class="detail-stat-grid">
      <div><small>PKC 스코어</small><strong>${formatPercent(row.bt_wr_shrunk)}</strong></div>
      <div><small>승률</small><strong>${formatPercent(row.raw_wr)}</strong></div>
      <div><small>픽률</small><strong>${formatPercent(row.pick_rate)}</strong></div>
      <div><small>판수</small><strong>${formatNumber(row.seats)}</strong></div>
    </div>

    <div class="detail-evidence-strip">
      <div><small>쓴 팀 수</small><strong>${formatNumber(row.team_count)}</strong></div>
      <div><small>최다 한 팀 비중</small><strong>${formatPercent(row.top_team_share)}</strong></div>
      <div><small>1번 자리 비중</small><strong>${formatPercent(row.seat0_share)}</strong></div>
    </div>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>상성</h3><span>클릭 시 상성 비교로 이동</span></div>
      <div class="detail-matchups">
        <div><h4><span class="down-arrow" aria-hidden="true">↓</span> 카운터</h4>${matchupList(row.counters, "불리", rows)}</div>
        <div><h4><span class="up-arrow" aria-hidden="true">↑</span> 유리 상대</h4>${matchupList(row.preys, "유리", rows)}</div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>대표 카드</h3><span>변형 내 채용률순</span></div>
      <div class="core-card-grid">${cardGallery.map((card) => `<article>${cardArt(card, { large: true })}<strong>${escapeHtml(card.name)}</strong><span>${formatPercent(card.presence)} 채용</span></article>`).join("")}</div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>대표 리스트</h3><span>${formatPercent(row.modal_deck_share)} 일치 · ${modalCount}장</span></div>
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
  document.querySelector("main").innerHTML = `<section class="fatal-error section-shell"><span aria-hidden="true">!</span><h1>데이터 로드 실패</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" type="button" onclick="window.location.reload()">새로고침</button><a href="./README.md">README 원본</a></section>`;
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function setupNetworkStatus() {
  window.addEventListener("offline", () => {
    els["freshness-line"].classList.add("is-offline");
    els["freshness-line"].innerHTML = `<span aria-hidden="true"></span>오프라인 · 저장 데이터 표시 중`;
  });
  window.addEventListener("online", () => {
    els["freshness-line"].classList.remove("is-offline");
    renderMeta();
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
    const preliminaryErrors = validateDatasetShape(state.aggregates, { main: { units: [], cells: {} }, high: { units: [], cells: {} }, elite: { units: [], cells: {} } })
      .filter((error) => !error.includes("matrix unit"));
    if (preliminaryErrors.some((error) => error.includes("rows missing"))) throw new Error(preliminaryErrors.join("; "));
    renderMeta();
    renderBandChips();
    renderStats();
    renderMethodDiagnostics();
    renderDecks();
    populateMatchupSelectors();
    bindExplorer();
    bindBandChips();
    bindMatchup();
    openDeepLink();
    setupServiceWorker();
    setupNetworkStatus();
  } catch (error) {
    renderError(error);
  }
}

init();
