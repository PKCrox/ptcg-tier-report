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
  strategyNames,
  validateDatasetShape,
  viewLabel,
} from "./assets/site-data.js";

const DATA_URLS = {
  aggregates: "./data/aggregates.json",
  matchups: "./data/matchups.json",
  prices: "./data/prices.json",
};

const TIER_ORDER = ["S", "A", "B", "C"];

const state = {
  aggregates: null,
  matchups: null,
  matchupsPromise: null,
  prices: null,
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
    "theme-toggle", "signal-board", "distribution-list",
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
  const detail = `The most active team supplied ${formatPercent(share)} of games · ${formatNumber(teams)} teams played this variant`;
  if (teams < 3 || share >= 0.8) {
    return { key: "low", label: "Pilot concentrated", description: detail };
  }
  if (share >= 0.5) {
    return { key: "medium", label: "Few pilots", description: detail };
  }
  return { key: "high", label: "Broad pilot base", description: detail };
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
  const stored = localStorage.getItem("metatcg-theme") || localStorage.getItem("ptcg-theme");
  const preferred = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const theme = stored || preferred;
  document.documentElement.dataset.theme = theme;
  updateThemeButton(theme);

  els["theme-toggle"].addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("metatcg-theme", next);
    updateThemeButton(next);
  });
}

function updateThemeButton(theme) {
  const isLight = theme === "light";
  els["theme-toggle"].setAttribute("aria-pressed", String(isLight));
  els["theme-toggle"].setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
}


function renderOverview() {
  const insights = deriveInsights(state.aggregates);
  const signals = [
    { label: "META LEADER", row: insights.strongest, value: insights.strongest ? formatPercent(insights.strongest.bt_wr_shrunk) : "—", note: "Meta Score" },
    { label: "MOST PLAYED", row: insights.mostPlayed, value: insights.mostPlayed ? formatPercent(insights.mostPlayed.pick_rate) : "—", note: "Overall meta share" },
    { label: "TOP 50 LEADER", row: insights.eliteLeader, value: insights.eliteLeader ? formatPercent(insights.eliteLeader.bt_wr_shrunk) : "—", note: "Top 50 Meta Score" },
  ];
  els["signal-board"].innerHTML = `
    <div class="signal-board-head"><div><p class="section-kicker">MARKET SIGNALS</p><h2>Key Meta Signals</h2></div><a href="#tiers">View all decks <span aria-hidden="true">→</span></a></div>
    <div class="signal-grid">${signals.map((signal, index) => signal.row ? `
      <button type="button" data-open-unit="${escapeHtml(signal.row.unit)}">
        <span class="signal-index">0${index + 1}</span>
        <span class="signal-art">${cardArt(signal.row.main_cards?.[0], { eager: index === 0 })}</span>
        <span class="signal-copy"><small>${escapeHtml(signal.label)}</small><strong>${escapeHtml(shortDeckName(signal.row))}</strong><em>${escapeHtml(ARCHETYPE_KO[signal.row.l1] || signal.row.l1)}</em></span>
        <span class="signal-value"><strong>${escapeHtml(signal.value)}</strong><small>${escapeHtml(signal.note)}</small></span>
      </button>` : "").join("")}</div>`;
}

function selectedBandSource() {
  if (state.band === "all") return state.aggregates.views.main;
  const band = (state.aggregates.score_bands || []).find((item) => item.band === state.band);
  return band || state.aggregates.views.main;
}

function renderBandChips() {
  const bands = state.aggregates.score_bands || [];
  els["band-row"].innerHTML = [
    `<button class="filter-chip${state.band === "all" ? " is-active" : ""}" type="button" data-band="all" aria-pressed="${state.band === "all"}">All (800+)</button>`,
    ...bands.map((band) => `<button class="filter-chip${state.band === band.band ? " is-active" : ""}" type="button" data-band="${escapeHtml(band.band)}" aria-pressed="${state.band === band.band}">${escapeHtml(band.band)}</button>`),
    `<span class="result-count">${formatNumber(selectedBandSource().seats ?? selectedBandSource().games * 2)} deck appearances</span>`,
  ].join("");
}

function renderStats() {
  const distribution = archetypeDistribution(selectedBandSource());
  const visible = distribution.slice(0, 10);
  const restRate = distribution.slice(10).reduce((sum, item) => sum + item.rate, 0);
  if (restRate > 0) visible.push({ key: "other", name: "Other", rate: restRate });

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
    <span>Seat 0 win rate <strong>${formatPercent(main.seat0_win_rate)}</strong></span>
    <span>Pilot-concentrated variants <strong>${pilotBound}/${main.rows.length}</strong></span>
    <span>Unclassified seats <strong>${formatPercent(main.unknown_seat_share)}</strong></span>`;
}

function deckRow(row) {
  const arts = (row.main_cards || []).slice(0, 3).map((card) => cardArt(card)).join("");
  const evidence = rowEvidence(row);
  const price = deckPrice(row);
  const warn = evidence.key !== "high"
    ? `<span class="row-flag" title="${escapeHtml(`${evidence.label} — ${evidence.description}`)}" aria-label="${escapeHtml(evidence.label)}">⚠</span>`
    : "";
  return `<article class="deck-card">
    <button class="deck-card-button" type="button" data-open-unit="${escapeHtml(row.unit)}" aria-label="View details for ${escapeHtml(shortDeckName(row))}">
      <span class="deck-arts">${arts || `<span class="card-placeholder" aria-hidden="true">?</span>`}</span>
      <span class="deck-name">
        <strong>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)}</strong>
        <span class="deck-tags">${strategyNames(row).map((tag) => `<em>${escapeHtml(tag)}</em>`).join("") || "<em>Standard</em>"}</span>
      </span>
      <span class="deck-stats">
        <span class="deck-stat stat-bt tier-text-${escapeHtml(row.tier.toLowerCase())}"><strong>${formatPercent(row.bt_wr_shrunk)}</strong><small>Meta</small></span>
        <span class="deck-stat"><strong>${formatPercent(row.raw_wr)}</strong><small>Win</small></span>
        <span class="deck-stat"><strong>${formatPercent(row.pick_rate)}</strong><small>Share</small></span>
        <span class="deck-stat"><strong>${formatNumber(row.seats)}</strong><small>Games</small></span>
        <span class="deck-stat stat-price"><strong>${price.count ? `~$${price.total.toFixed(0)}` : "—"}</strong><small>Price</small></span>
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
  els["result-count"].textContent = `${rows.length} variants`;
  els["deck-grid"].setAttribute("aria-busy", "false");
  if (!rows.length) {
    els["deck-grid"].innerHTML = `<div class="empty-state"><span aria-hidden="true">⌕</span><h3>No matching decks</h3><button type="button" data-reset-filters>Reset filters</button></div>`;
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
    <button type="button" data-open-unit="${escapeHtml(row.unit)}">Details</button>
  </div>`;
}

function renderMatchupLoading() {
  els["matchup-result"].innerHTML = `<div class="matchup-loading"><span class="spinner" aria-hidden="true"></span><p>Loading direct games…</p></div>`;
}

async function renderMatchup() {
  renderMatchupLoading();
  try {
    await ensureMatchups();
  } catch (error) {
    els["matchup-result"].innerHTML = `<div class="inline-error"><strong>Could not load matchup data</strong><span>${escapeHtml(error.message)}</span><button type="button" data-retry-matchups>Retry</button></div>`;
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
    ? "Mirror match"
    : rateA >= 0.55 ? `${shortDeckName(rowA)} favored`
      : rateA <= 0.45 ? `${shortDeckName(rowA)} unfavored` : "Even matchup";

  els["matchup-result"].innerHTML = `
    <div class="matchup-stage">
      ${matchupDeckMini(rowA, "a")}
      <div class="versus-mark" aria-hidden="true">VS</div>
      ${matchupDeckMini(rowB, "b")}
    </div>
    <div class="matchup-scoreboard">
      <div class="matchup-score-head">
        <div><span>Your win rate</span><strong>${result ? formatPercent(rateA) : "—"}</strong></div>
        <div class="matchup-verdict"><span>${escapeHtml(viewLabel(state.view, state.aggregates.filters))}</span><strong>${escapeHtml(verdict)}</strong></div>
        <div><span>Opponent win rate</span><strong>${result ? formatPercent(rateB) : "—"}</strong></div>
      </div>
      <div class="matchup-bar${result ? "" : " is-empty"}" role="img" aria-label="${result ? `${shortDeckName(rowA)} ${formatPercent(rateA)}, ${shortDeckName(rowB)} ${formatPercent(rateB)}` : "No direct games"}">
        <span class="matchup-bar-a" style="--share: ${rateA * 100}%"></span>
        <span class="matchup-bar-b" style="--share: ${rateB * 100}%"></span>
      </div>
      <div class="matchup-evidence">
        ${confidenceBadge(confidence)}
        <p>${result?.mirror ? "Same-variant games are excluded" : result ? `${formatNumber(result.n)} games · ${formatNumber(result.wins)} wins / ${formatNumber(result.n - result.wins)} losses` : "No direct games"}</p>
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
  if (!items?.length) return `<div class="detail-empty">No sufficiently sampled opponents</div>`;
  return `<div class="detail-matchup-list">${items.map((item) => {
    const opponent = rows.get(item.vs) || getRow(item.vs, "main");
    const confidence = confidenceFor(item.n, state.aggregates.filters.min_n_cell);
    return `<button type="button" data-compare-opponent="${escapeHtml(item.vs)}">
      <span class="matchup-list-copy"><small>${escapeHtml(label)}</small><strong>${escapeHtml(opponent ? shortDeckName(opponent) : item.vs)}</strong></span>
      <span class="matchup-list-score"><strong>${formatPercent(item.wr)}</strong><small>${formatNumber(item.n)} games · ${escapeHtml(confidence.label)}</small></span>
    </button>`;
  }).join("")}</div>`;
}

function deckListText(row) {
  return (row.modal_deck || []).map((card) => `${card.qty} ${card.name}`).join("\n");
}

function deckPrice(row) {
  const cards = state.prices?.cards || {};
  let total = 0;
  let count = 0;
  let estimated = 0;
  for (const card of row.modal_deck || []) {
    const price = cards[card.name];
    if (!price) continue;
    total += Number(price.usd || 0) * Number(card.qty || 0);
    count += Number(card.qty || 0);
    if (String(price.source).startsWith("fallback")) estimated += Number(card.qty || 0);
  }
  return { total, count, estimated };
}

function renderDialog(row) {
  const rows = currentRowMap();
  const confidence = rowEvidence(row);
  const cardGallery = (row.main_cards || []).slice(0, 5);
  const modalCount = (row.modal_deck || []).reduce((sum, card) => sum + card.qty, 0);
  const price = deckPrice(row);
  const priceLabel = price.count ? `~$${price.total.toFixed(2)}` : "Unavailable";
  els["dialog-content"].innerHTML = `
    <header class="detail-hero">
      <div class="detail-hero-art">${cardGallery.slice(0, 3).map((card, index) => cardArt(card, { eager: index === 0, large: true })).join("")}</div>
      <div class="detail-hero-copy">
        <div class="detail-labels">${tierBadge(row.tier)}${confidenceBadge(confidence)}</div>
        <p>${escapeHtml(ARCHETYPE_KO[row.l1] || row.l1)} · ${escapeHtml(viewLabel(state.view, state.aggregates.filters))}</p>
        <h2 id="dialog-title">${escapeHtml(shortDeckName(row))}</h2>
        <div class="tag-list is-large">${strategyNames(row).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>Standard</span>"}</div>
        
      </div>
    </header>

    <div class="detail-stat-grid">
      <div><small>Meta Score</small><strong>${formatPercent(row.bt_wr_shrunk)}</strong></div>
      <div><small>Win</small><strong>${formatPercent(row.raw_wr)}</strong></div>
      <div><small>Share</small><strong>${formatPercent(row.pick_rate)}</strong></div>
      <div><small>Games</small><strong>${formatNumber(row.seats)}</strong></div>
      <div><small>Est. Deck Price</small><strong>${priceLabel}</strong></div>
    </div>

    <div class="detail-evidence-strip">
      <div><small>Teams</small><strong>${formatNumber(row.team_count)}</strong></div>
      <div><small>Top team share</small><strong>${formatPercent(row.top_team_share)}</strong></div>
      <div><small>Seat 0 share</small><strong>${formatPercent(row.seat0_share)}</strong></div>
    </div>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>Matchups</h3><span>Select an opponent to compare</span></div>
      <div class="detail-matchups">
        <div><h4><span class="down-arrow" aria-hidden="true">↓</span> Counters</h4>${matchupList(row.counters, "Unfavored", rows)}</div>
        <div><h4><span class="up-arrow" aria-hidden="true">↑</span> Favored</h4>${matchupList(row.preys, "Favored", rows)}</div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>Core Cards</h3><span>Sorted by inclusion rate</span></div>
      <div class="core-card-grid">${cardGallery.map((card) => `<article>${cardArt(card, { large: true })}<strong>${escapeHtml(card.name)}</strong><span>${formatPercent(card.presence)} inclusion</span></article>`).join("")}</div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><h3>Representative List</h3><span>${formatPercent(row.modal_deck_share)} of variant · ${modalCount} cards</span></div>
      <p class="price-note">Estimated cheapest-printing market total: <strong>${priceLabel}</strong>. ${price.estimated ? `${price.estimated} cards use fallback estimates. ` : ""}Shipping, tax, condition, and exact printing are excluded.</p>
      <div class="decklist-shell">
        <div class="decklist-grid">${(row.modal_deck || []).map((card) => `<div><strong>${card.qty}</strong><span>${escapeHtml(card.name)}</span></div>`).join("")}</div>
        <button class="copy-button" type="button" data-copy-deck>Copy decklist</button>
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
    button.textContent = "Copied ✓";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => { button.textContent = "Copy decklist"; }, 1800);
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
  document.querySelector("main").innerHTML = `<section class="fatal-error section-shell"><span aria-hidden="true">!</span><h1>Could not load data</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" type="button" onclick="window.location.reload()">Reload</button><a href="./README.md">README</a></section>`;
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
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
    [state.aggregates, state.prices] = await Promise.all([fetchJson(DATA_URLS.aggregates), fetchJson(DATA_URLS.prices)]);
    const preliminaryErrors = validateDatasetShape(state.aggregates, { main: { units: [], cells: {} }, high: { units: [], cells: {} }, elite: { units: [], cells: {} } })
      .filter((error) => !error.includes("matrix unit"));
    if (preliminaryErrors.some((error) => error.includes("rows missing"))) throw new Error(preliminaryErrors.join("; "));
    renderOverview();
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

  } catch (error) {
    renderError(error);
  }
}

init();
