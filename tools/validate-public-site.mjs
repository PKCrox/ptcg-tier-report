import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredFiles = [
  "index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js",
  "robots.txt", "sitemap.xml", ".nojekyll", "assets/app-icon.svg",
  "assets/site-data.js", "assets/og-card.png", "data/aggregates.json",
  "data/matchups.json", "data/manifest.json", "data/prices.json",
];

const allowedTrackedFiles = new Set([
  ".github/workflows/pages.yml", ".github/workflows/quality.yml", ".gitignore",
  ".nojekyll", "README.md", "app.js", "assets/app-icon.svg",
  "assets/matchup_matrix.svg", "assets/matchup_matrix_elite.svg",
  "assets/og-card.png", "assets/og-card.svg", "assets/site-data.js",
  "data/aggregates.json", "data/manifest.json", "data/matchups.json", "data/prices.json",
  "index.html", "manifest.webmanifest", "package-lock.json", "package.json",
  "robots.txt", "sitemap.xml", "styles.css", "sw.js", "tools/browser-smoke.mjs",
  "tools/build-site.mjs", "tools/validate-public-site.mjs", "vercel.json",
]);

const allowedTopLevel = new Set([
  "schema_version", "generated_at_kst", "date_range", "unit_schema", "filters",
  "score_bands", "signatures", "views",
]);

const allowedBandKeys = new Set(["band", "min", "max", "seats", "l1_distribution"]);

const allowedFilterKeys = new Set([
  "min_score", "high_min_score", "elite_top_rank", "bt_shrink_k",
  "min_games_entry", "min_cell_listing", "min_n_cell", "tier_thresholds",
]);

const viewKeys = ["main", "high", "elite"];

const allowedViewKeys = new Set([
  "games", "rows", "unknown_seat_share", "l1_distribution", "date_distribution",
  "seat0_win_rate", "min_score", "top_rank", "filter_stats",
]);

const allowedRowKeys = new Set([
  "unit", "l1", "display", "tier", "bt_wr", "bt_wr_shrunk", "raw_wr",
  "seats", "pick_rate", "strategy_tags", "strategy_tags_ko", "strategy",
  "main_cards", "counters", "preys", "modal_deck", "modal_deck_share",
  "team_count", "top_team_share", "seat0_share",
]);

const allowedModalCardKeys = new Set(["cid", "name", "qty"]);

const allowedPriceTopLevelKeys = new Set([
  "schema_version", "currency", "generated_at", "source_modified_at",
  "provider", "method", "coverage", "cards",
]);

const allowedPriceCardKeys = new Set([
  "name", "set", "number", "usd", "currency", "source", "basis",
  "printing", "groupId", "productId", "variant", "market", "low",
  "selection", "rarity", "collector_number", "image", "base_usd",
  "base_productId", "equivalent_products",
]);

// Generic leak patterns only. Identifier-specific tokens live in the internal
// pre-push checker (not in this public repo).
const forbiddenArtifactTerms = [
  "/Users/", "/home/", "submission_ref", "deck_hash", "pilot_name",
];

function fail(message) {
  failures.push(message);
}

async function exists(relative) {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

function assertAllowedKeys(object, allowed, label) {
  for (const key of Object.keys(object || {})) {
    if (!allowed.has(key)) fail(`${label}: forbidden or unknown public key '${key}'`);
  }
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${label}: expected probability, got ${value}`);
}

function tierFor(value, thresholds) {
  if (value >= thresholds.S) return "S";
  if (value >= thresholds.A) return "A";
  if (value >= thresholds.B) return "B";
  return "C";
}

function validateRows(viewKey, view, filters) {
  if (!Array.isArray(view.rows) || !view.rows.length) {
    fail(`${viewKey}: rows missing`);
    return new Set();
  }
  const units = new Set();
  for (const [index, row] of view.rows.entries()) {
    const label = `${viewKey}.rows[${index}]`;
    assertAllowedKeys(row, allowedRowKeys, label);
    if (!row.unit || units.has(row.unit)) fail(`${label}: duplicate or missing unit '${row.unit}'`);
    units.add(row.unit);
    if (!["S", "A", "B", "C"].includes(row.tier)) fail(`${label}: invalid tier ${row.tier}`);
    for (const field of ["bt_wr", "bt_wr_shrunk", "raw_wr", "pick_rate", "modal_deck_share", "top_team_share", "seat0_share"]) {
      assertProbability(row[field], `${label}.${field}`);
    }
    if (!Number.isInteger(row.seats) || row.seats < 1) fail(`${label}.seats must be a positive integer`);
    if (!Number.isInteger(row.team_count) || row.team_count < 1) fail(`${label}.team_count must be a positive integer`);
    const expectedTier = tierFor(row.bt_wr_shrunk, filters.tier_thresholds);
    if (row.tier !== expectedTier) fail(`${label}: tier ${row.tier} disagrees with exported BT ${row.bt_wr_shrunk} (${expectedTier})`);
    if (!Array.isArray(row.main_cards) || !Array.isArray(row.modal_deck)) fail(`${label}: card arrays missing`);
    const deckSize = row.modal_deck.reduce((sum, card) => sum + Number(card.qty || 0), 0);
    if (row.modal_deck.length && deckSize !== 60) fail(`${label}: representative deck has ${deckSize}, expected 60`);
    for (const [cardIndex, card] of row.modal_deck.entries()) {
      const cardLabel = `${label}.modal_deck[${cardIndex}]`;
      assertAllowedKeys(card, allowedModalCardKeys, cardLabel);
      if (!Number.isInteger(card.cid) || card.cid < 1) fail(`${cardLabel}.cid must be a positive integer`);
      if (typeof card.name !== "string" || !card.name) fail(`${cardLabel}.name missing`);
      if (!Number.isInteger(card.qty) || card.qty < 1) fail(`${cardLabel}.qty must be a positive integer`);
    }
    for (const side of ["counters", "preys"]) {
      if (!Array.isArray(row[side])) fail(`${label}.${side}: expected array`);
      for (const cell of row[side] || []) {
        assertProbability(cell.wr, `${label}.${side}.wr`);
        if (!Number.isInteger(cell.n) || cell.n < 1) fail(`${label}.${side}.n must be positive integer`);
      }
    }
  }
  return units;
}

function validateMatrix(viewKey, matrix, rowUnits) {
  if (!matrix || !Array.isArray(matrix.units) || typeof matrix.cells !== "object") {
    fail(`${viewKey}: matrix missing`);
    return;
  }
  const units = new Set(matrix.units);
  if (units.size !== matrix.units.length) fail(`${viewKey}: duplicate matrix units`);
  if (units.size !== rowUnits.size || [...units].some((unit) => !rowUnits.has(unit))) {
    fail(`${viewKey}: aggregate and matchup unit sets differ`);
  }
  for (const [key, cell] of Object.entries(matrix.cells)) {
    const separator = key.indexOf("|");
    const a = key.slice(0, separator);
    const b = key.slice(separator + 1);
    if (separator < 1 || !units.has(a) || !units.has(b) || a === b) fail(`${viewKey}: invalid matrix key ${key}`);
    if (!Number.isInteger(cell.n) || !Number.isInteger(cell.w) || cell.n < 1 || cell.w < 0 || cell.w > cell.n) {
      fail(`${viewKey}.${key}: invalid n/w`);
      continue;
    }
    const reverse = matrix.cells[`${b}|${a}`];
    if (!reverse || reverse.n !== cell.n || reverse.w + cell.w !== cell.n) {
      fail(`${viewKey}.${key}: reverse-cell complement invariant failed`);
    }
  }
}

for (const file of requiredFiles) {
  if (!(await exists(file))) fail(`missing required public file: ${file}`);
}

let aggregates;
let matchups;
let manifest;
let prices;
try { aggregates = JSON.parse(await read("data/aggregates.json")); } catch (error) { fail(`aggregates JSON invalid: ${error.message}`); }
try { matchups = JSON.parse(await read("data/matchups.json")); } catch (error) { fail(`matchups JSON invalid: ${error.message}`); }
try { manifest = JSON.parse(await read("data/manifest.json")); } catch (error) { fail(`manifest JSON invalid: ${error.message}`); }
try { prices = JSON.parse(await read("data/prices.json")); } catch (error) { fail(`prices JSON invalid: ${error.message}`); }

if (aggregates) {
  assertAllowedKeys(aggregates, allowedTopLevel, "aggregates");
  if (aggregates.schema_version !== 2) fail(`schema_version must be 2, got ${aggregates.schema_version}`);
  assertAllowedKeys(aggregates.filters, allowedFilterKeys, "filters");
  if (!aggregates.filters?.tier_thresholds) fail("tier thresholds missing from public contract");
  if (!Array.isArray(aggregates.score_bands) || !aggregates.score_bands.length) {
    fail("score_bands missing");
  } else {
    for (const [index, band] of aggregates.score_bands.entries()) {
      const label = `score_bands[${index}]`;
      assertAllowedKeys(band, allowedBandKeys, label);
      if (typeof band.band !== "string" || !band.band) fail(`${label}: band label missing`);
      if (!Number.isInteger(band.seats) || band.seats < 1) fail(`${label}: seats must be positive integer`);
      const total = Object.values(band.l1_distribution || {}).reduce((sum, count) => sum + count, 0);
      if (total !== band.seats) fail(`${label}: l1_distribution sums ${total}, expected ${band.seats}`);
    }
  }
  for (const viewKey of viewKeys) {
    const view = aggregates.views?.[viewKey];
    if (!view) {
      fail(`${viewKey}: aggregate view missing`);
      continue;
    }
    assertAllowedKeys(view, allowedViewKeys, `views.${viewKey}`);
    assertProbability(view.unknown_seat_share, `${viewKey}.unknown_seat_share`);
    assertProbability(view.seat0_win_rate, `${viewKey}.seat0_win_rate`);
    const units = validateRows(viewKey, view, aggregates.filters);
    if (matchups) validateMatrix(viewKey, matchups[viewKey], units);
  }
}

if (prices) {
  assertAllowedKeys(prices, allowedPriceTopLevelKeys, "prices");
  if (prices.schema_version !== 5) fail(`price schema_version must be 5, got ${prices.schema_version}`);
  if (prices.currency !== "USD") fail(`price currency must be USD, got ${prices.currency}`);
  if (!Number.isFinite(Date.parse(prices.generated_at))) fail(`price generated_at is invalid: ${prices.generated_at}`);
  if (prices.provider?.name !== "TCGCSV" || prices.provider?.underlying_market !== "TCGplayer") {
    fail("price provider contract must identify TCGCSV and TCGplayer");
  }
  if (!prices.cards || typeof prices.cards !== "object" || Array.isArray(prices.cards)) {
    fail("price cards map missing");
  } else {
    for (const [cid, price] of Object.entries(prices.cards)) {
      assertAllowedKeys(price, allowedPriceCardKeys, `prices.cards.${cid}`);
      if (!/^[1-9]\d*$/.test(cid)) fail(`prices.cards.${cid}: key must be a positive card id`);
      if (typeof price.name !== "string" || !price.name) fail(`prices.cards.${cid}.name missing`);
      if (!Number.isFinite(price.usd) || price.usd <= 0) fail(`prices.cards.${cid}.usd must be positive`);
      if (price.currency !== "USD") fail(`prices.cards.${cid}.currency must be USD`);
      if (price.source !== "tcgcsv/tcgplayer") {
        fail(`prices.cards.${cid}.source must be tcgcsv/tcgplayer`);
      }
      if (!["market", "low"].includes(price.basis)) {
        fail(`prices.cards.${cid}.basis is unsupported: ${price.basis}`);
      }
      if (!Number.isInteger(price.groupId) || !Number.isInteger(price.productId)) {
        fail(`prices.cards.${cid}: selected TCGCSV identifiers missing`);
      }
      if (!price.printing) fail(`prices.cards.${cid}: selected printing label missing`);
      if (/^(Jumbo Cards|World Championship Decks) ·/.test(price.printing)) {
        fail(`prices.cards.${cid}: non-playable collector product selected`);
      }
      if (price.selection !== "collector-max") fail(`prices.cards.${cid}: selection must be collector-max`);
      if (typeof price.rarity !== "string" || !price.rarity) fail(`prices.cards.${cid}: rarity missing`);
      if (price.collector_number !== null && !/^\d+$/.test(price.collector_number)) {
        fail(`prices.cards.${cid}: collector_number must be numeric or null`);
      }
      if (typeof price.image !== "string" || !price.image.startsWith("https://")) {
        fail(`prices.cards.${cid}: selected printing image missing`);
      }
      if (!Number.isFinite(price.base_usd) || price.base_usd <= 0) fail(`prices.cards.${cid}: base_usd must be positive`);
      if (!Number.isInteger(price.base_productId)) fail(`prices.cards.${cid}: base_productId missing`);
      if (!Number.isInteger(price.equivalent_products) || price.equivalent_products < 1) {
        fail(`prices.cards.${cid}: equivalent_products must be positive`);
      }
      if (price.usd + 0.001 < price.base_usd) fail(`prices.cards.${cid}: collector max is below base price`);
    }
  }

  if (aggregates && prices.cards) {
    const requiredCardIds = new Set();
    for (const viewKey of viewKeys) {
      const rows = aggregates.views?.[viewKey]?.rows || [];
      let pricedCopies = 0;
      let cardCopies = 0;
      let completeDecks = 0;
      for (const row of rows) {
        for (const card of row.main_cards || []) {
          requiredCardIds.add(String(card.cid));
          const price = prices.cards[String(card.cid)];
          if (!price) {
            fail(`${viewKey}/${row.unit}: missing collector price for core card ${card.cid} ${card.name}`);
          } else if (price.name !== card.name) {
            fail(`${viewKey}/${row.unit}: core card ${card.cid} price name mismatch (${price.name} != ${card.name})`);
          }
        }
        let deckPricedCopies = 0;
        let deckCopies = 0;
        for (const card of row.modal_deck || []) {
          requiredCardIds.add(String(card.cid));
          deckCopies += card.qty;
          cardCopies += card.qty;
          const price = prices.cards[String(card.cid)];
          if (!price) {
            fail(`${viewKey}/${row.unit}: missing price for card ${card.cid} ${card.name}`);
            continue;
          }
          if (price.name !== card.name) {
            fail(`${viewKey}/${row.unit}: card ${card.cid} price name mismatch (${price.name} != ${card.name})`);
          }
          deckPricedCopies += card.qty;
          pricedCopies += card.qty;
        }
        if (deckCopies === 60 && deckPricedCopies === 60) completeDecks += 1;
      }
      const declared = prices.coverage?.views?.[viewKey];
      const actual = { decks: rows.length, complete_decks: completeDecks, card_copies: cardCopies, priced_copies: pricedCopies };
      for (const [field, value] of Object.entries(actual)) {
        if (declared?.[field] !== value) {
          fail(`price coverage ${viewKey}.${field} is ${declared?.[field]}, expected ${value}`);
        }
      }
      if (completeDecks !== rows.length) fail(`${viewKey}: only ${completeDecks}/${rows.length} representative decks have 60-card price coverage`);
    }
    const priceIds = Object.keys(prices.cards);
    if (prices.coverage?.card_ids !== requiredCardIds.size) {
      fail(`price coverage card_ids is ${prices.coverage?.card_ids}, expected ${requiredCardIds.size}`);
    }
    if (prices.coverage?.priced_card_ids !== priceIds.length) {
      fail(`price coverage priced_card_ids is ${prices.coverage?.priced_card_ids}, expected ${priceIds.length}`);
    }
    const upgradedCardIds = Object.values(prices.cards).filter((price) =>
      price.productId !== price.base_productId || price.usd > price.base_usd + 0.001
    ).length;
    if (prices.coverage?.upgraded_card_ids !== upgradedCardIds) {
      fail(`price coverage upgraded_card_ids is ${prices.coverage?.upgraded_card_ids}, expected ${upgradedCardIds}`);
    }
    const extraIds = priceIds.filter((cid) => !requiredCardIds.has(cid));
    if (extraIds.length) fail(`price map contains ${extraIds.length} unused card ids`);
  }
}

if (manifest) {
  if (manifest.schema_version !== 2) fail("manifest schema_version must be 2");
  for (const file of ["aggregates.json", "matchups.json", "prices.json"]) {
    const contents = await read(`data/${file}`);
    const bytes = Buffer.byteLength(contents);
    const digest = createHash("sha256").update(contents).digest("hex");
    if (manifest.files?.[file]?.bytes !== bytes) fail(`manifest byte count mismatch: ${file}`);
    if (manifest.files?.[file]?.sha256 !== digest) fail(`manifest checksum mismatch: ${file}`);
  }
}

try {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of tracked) {
    if (!allowedTrackedFiles.has(file)) fail(`tracked path is outside exact public allowlist: ${file}`);
    if (/(^|\/)(goal_|agents?|decks?|grok_|fidelity|submissions?)/i.test(file)) fail(`tracked path looks internal: ${file}`);
  }
} catch (error) {
  if (process.env.VERCEL !== "1") fail(`could not audit tracked files: ${error.message}`);
}

for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js", "assets/site-data.js", "data/aggregates.json", "data/matchups.json", "data/prices.json"]) {
  const contents = (await read(file)).toLocaleLowerCase();
  for (const term of forbiddenArtifactTerms) {
    if (contents.includes(term.toLocaleLowerCase())) fail(`${file}: forbidden public term '${term}'`);
  }
}

if (await exists("index.html")) {
  const html = await read("index.html");
  if (!/<html\s+lang="en"/i.test(html)) fail("index.html must declare lang=en");
  if ((html.match(/<h1\b/gi) || []).length !== 1) fail("index.html must contain exactly one h1");
  if (!/class="skip-link"/.test(html)) fail("index.html must include a skip link");
  if (!/<meta\s+name="description"/i.test(html)) fail("index.html meta description missing");
  if (!/<link\s+rel="canonical"/i.test(html)) fail("index.html canonical missing");
  if (!/assets\/og-card\.png/.test(html)) fail("index.html OG image missing");
}

if (failures.length) {
  console.error(`public-site validation failed (${failures.length})`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`public-site validation passed: ${viewKeys.map((key) => `${aggregates.views[key].rows.length} ${key}`).join(", ")} variants, ${prices.coverage.card_ids} collector-max card prices`);
