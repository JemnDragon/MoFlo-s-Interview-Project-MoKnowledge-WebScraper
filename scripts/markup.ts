/**
 * Markup-level checks: the extractors that need a real DOM.
 *
 *   npm run markup
 *
 * `smoke.ts` and `flows.ts` are deliberately dependency-free so they run in any
 * environment. That makes them unable to test the cheerio extractors at all,
 * which is precisely where two of the worst bugs so far have lived — the
 * struck-through price and the country-picker offering are both invisible until
 * you parse actual HTML.
 *
 * So this file is the third harness, and the only one that needs
 * `npm install`. Fixtures below are hand-reduced from the real markup Shopify's
 * Dawn theme emits on slimestory.com, kept small enough to read.
 */

import * as cheerio from "cheerio";
import { extractOfferings, priceFromElement, priceIn } from "../src/lib/parse/offerings";
import { extractCtas } from "../src/lib/parse/ctas";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
function section(name: string) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ *
 * Discounted pricing
 * ------------------------------------------------------------------ */

section("Sale pricing — the struck-through price is not the price");

// Dawn's card markup. `card.text()` on this yields "…$40.00$28.00…", and the
// first regex match is the wrong number.
const DAWN_SALE_CARD = `
<div class="card-wrapper product-card-wrapper">
  <h3 class="card__heading">Sweet Snail Slime Plush</h3>
  <div class="price price--on-sale">
    <div class="price__sale">
      <span class="visually-hidden">Regular price</span>
      <s class="price-item price-item--regular">$40.00</s>
      <span class="visually-hidden">Sale price</span>
      <span class="price-item price-item--sale">$28.00</span>
    </div>
  </div>
</div>`;

const $sale = cheerio.load(DAWN_SALE_CARD);
const saleReading = priceFromElement($sale(".product-card-wrapper"));
check("the sale price is read, not the struck one", saleReading.price === "$28.00", saleReading);
check("the original is captured separately", saleReading.original === "$40.00", saleReading);
check(
  "…and the flat-text reading would have been wrong",
  priceIn($sale(".product-card-wrapper").text()) === "$40.00",
);

const saleOfferings = extractOfferings($sale, []);
check("the offering carries the sale price", saleOfferings[0]?.priceText === "$28.00", saleOfferings[0]);
check("…and the original, for Current Promotions", saleOfferings[0]?.originalPriceText === "$40.00");

// Semantic markup with no theme class names at all.
const PLAIN_SALE = `<div class="product-card"><h3>Sticker Pack</h3><p><del>$10.00</del> <ins>$7.00</ins></p></div>`;
const $plain = cheerio.load(PLAIN_SALE);
check("<del>/<ins> works with no class names", priceFromElement($plain(".product-card")).price === "$7.00");

// No discount: nothing must be invented.
const FULL_PRICE = `<div class="product-card"><h3>Deer Slime Plush</h3><span class="price-item">$34.00</span></div>`;
const $full = cheerio.load(FULL_PRICE);
const fullReading = priceFromElement($full(".product-card"));
check("an undiscounted product reads its one price", fullReading.price === "$34.00");
check("…and claims no discount", fullReading.original === null, fullReading);

// Only a struck price, no replacement — "was $40" alone is not a sale.
const STRUCK_ONLY = `<div class="product-card"><h3>Old Thing</h3><s>$40.00</s></div>`;
const $struck = cheerio.load(STRUCK_ONLY);
const struckReading = priceFromElement($struck(".product-card"));
check("a lone struck price is still reported as the price", struckReading.price === "$40.00");
check("…but not as a discount", struckReading.original === null, struckReading);

// The clone must not mutate the shared document.
check(
  "reading a price leaves the document intact for other extractors",
  $sale("s.price-item--regular").length === 1,
);

/* ------------------------------------------------------------------ *
 * Country / currency picker
 * ------------------------------------------------------------------ */

section("Dropdown content is never an offering");

// Dawn's localisation form: an h2 followed by a disclosure list. Structurally
// identical to "service heading followed by feature list".
const COUNTRY_PICKER = `
<footer>
  <localization-form>
    <h2 class="visually-hidden">Country/region</h2>
    <div class="disclosure">
      <button class="disclosure__button">United States | USD $</button>
      <ul class="disclosure__list">
        <li><a>Afghanistan (AFN ؋)</a></li>
        <li><a>Åland Islands (EUR €)</a></li>
        <li><a>Albania (ALL L)</a></li>
        <li><a>Algeria (DZD د.ج)</a></li>
        <li><a>Andorra (EUR €)</a></li>
        <li><a>Angola (USD $)</a></li>
      </ul>
    </div>
  </localization-form>
</footer>`;

const $picker = cheerio.load(COUNTRY_PICKER);
const pickerOfferings = extractOfferings($picker, []);
check("no offering is extracted from the picker at all", pickerOfferings.length === 0, pickerOfferings);
check(
  "…and specifically not one named Country/region",
  !pickerOfferings.some((o) => /country/i.test(o.name ?? "")),
);

// A native <select>, the other form the same control takes.
const NATIVE_SELECT = `
<div>
  <h2>Currency</h2>
  <select name="currency">
    <option>USD $</option><option>EUR €</option><option>GBP £</option>
  </select>
</div>`;
check("a native select yields nothing either", extractOfferings(cheerio.load(NATIVE_SELECT), []).length === 0);

// The content guard, with the ancestry guard deliberately unavailable: a picker
// rendered in the page body with no localisation class and no nav wrapper.
const NAKED_PICKER = `
<section>
  <h2>Choose your region</h2>
  <ul>
    ${Array.from({ length: 40 }, (_, i) => `<li>Country ${i} (EUR €)</li>`).join("")}
  </ul>
</section>`;
const nakedOfferings = extractOfferings(cheerio.load(NAKED_PICKER), []);
check(
  "the content guard catches a picker the ancestry guard cannot see",
  nakedOfferings.length === 0,
  nakedOfferings.map((o) => ({ name: o.name, features: o.features.length })),
);

// And the guard must not eat a real services page.
const REAL_SERVICES = `
<section>
  <h2>Roof Repair</h2>
  <p>We patch, reseal and replace.</p>
  <ul><li>Free inspection</li><li>Two-year warranty</li><li>Emergency callout</li></ul>
</section>`;
const realOfferings = extractOfferings(cheerio.load(REAL_SERVICES), []);
check("a real service survives", realOfferings[0]?.name === "Roof Repair", realOfferings);
check("…with its features intact", realOfferings[0]?.features.length === 3);

/* ------------------------------------------------------------------ *
 * CTA chrome, at the markup level
 * ------------------------------------------------------------------ */

section("CTA extraction on real chrome");

const SLIMESTORY_HEADER = `
<div>
  <a class="skip-to-content-link button" href="#MainContent">Skip to content</a>
  <button class="modal__toggle" aria-label="Search">Search</button>
  <button class="modal__close-button" type="button">Close</button>
  <a class="header__icon" href="/cart">Cart 0</a>
  <button type="button">Toggle</button>
  <a class="button" href="/collections/all">Shop All</a>
  <form action="/contact#newsletter" method="post" id="ContactFooter">
    <h2>Newsletter</h2>
    <input type="email" name="contact[email]">
    <button type="submit" name="commit">Notify Me!</button>
  </form>
</div>`;

const ctas = extractCtas(cheerio.load(SLIMESTORY_HEADER), "https://slimestory.test", "https://slimestory.test");
const labels = ctas.map((cta) => cta.label);

for (const gone of ["Skip to content", "Search", "Close", "Cart 0", "Toggle"]) {
  check(`  "${gone}" is not a CTA`, !labels.includes(gone), labels);
}
check('  "Shop All" is', labels.includes("Shop All"), labels);
check('  "Notify Me!" is — a hrefless submit is still a conversion path', labels.includes("Notify Me!"), labels);
check("  the newsletter form itself is kept as a funnel", ctas.some((cta) => cta.kind === "form"), ctas);

console.log(`\n${failures === 0 ? "All markup checks passed." : `${failures} markup check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
