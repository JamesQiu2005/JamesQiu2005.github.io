/* Daily SpektraLab download count, run by .github/workflows/sync-downloads.yml.

   Downloads on the platforms SpektraLab is listed on:
   - App Store: first-time downloads (not updates or re-downloads) from the
     App Store Connect daily SALES SUMMARY reports. Apple has no cumulative
     endpoint, so every day's units are kept in data/downloads.json and
     summed. Daily reports are kept by Apple for 365 days and can arrive
     late, so each run fetches every day it does not have yet plus the
     last RECHECK_DAYS days again.
   - GitHub: every Release asset's download_count.

   Writes data/downloads.json and puts the total and today's date into the
   shipped numbers in index.html and work/spektralab.html, so the page is
   right without JavaScript too. No dependencies: Node 20+. */

import { createSign } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const APP_ID = "6820950508"; // SpektraLab's Apple ID on App Store Connect
const FIRST_DAY = "2026-10-01"; // before the App Store listing; earlier days are all zero
const RECHECK_DAYS = 7;
const GITHUB_REPO = "JamesQiu2005/SpektraLab";
/* Product Type Identifiers that count as a first-time download: iPhone,
   universal, iPad, Mac, and custom apps. 3* are re-downloads, 7* updates. */
const DOWNLOAD_TYPES = new Set(["1", "1F", "1T", "F1", "1E", "1EP", "1EU"]);

const DATA = "data/downloads.json";
const PAGES = ["index.html", "work/spektralab.html"];

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
};

const b64url = (buf) => Buffer.from(buf).toString("base64url");

const token = () => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: env("ASC_KEY_ID"), typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ iss: env("ASC_ISSUER_ID"), iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" })
  );
  const sign = createSign("sha256");
  sign.update(`${head}.${body}`);
  const sig = sign.sign({ key: env("ASC_PRIVATE_KEY"), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
};

/* Units for one day, or null when Apple has no report for it (yet). */
const appStoreDay = async (jwt, date) => {
  const q = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportDate]": date,
    "filter[reportSubType]": "SUMMARY",
    "filter[reportType]": "SALES",
    "filter[vendorNumber]": env("ASC_VENDOR_NUMBER"),
    "filter[version]": "1_0",
  });
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${q}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`App Store Connect ${date}: ${r.status} ${await r.text()}`);
  const rows = gunzipSync(Buffer.from(await r.arrayBuffer()))
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  const col = (name) => rows[0].indexOf(name);
  const [id, type, units] = [col("Apple Identifier"), col("Product Type Identifier"), col("Units")];
  if (id < 0 || type < 0 || units < 0) throw new Error(`unexpected report columns: ${rows[0].join(", ")}`);
  return rows
    .slice(1)
    .filter((row) => row[id] === APP_ID && DOWNLOAD_TYPES.has(row[type]))
    .reduce((n, row) => n + (Number(row[units]) || 0), 0);
};

const gitHubDownloads = async () => {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let n = 0;
  for (let page = 1; ; page++) {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`GitHub releases: ${r.status}`);
    const list = await r.json();
    for (const rel of list) for (const a of rel.assets || []) n += Number(a.download_count) || 0;
    if (list.length < 100) return n;
  }
};

const isoDay = (d) => d.toISOString().slice(0, 10);

const days = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); isoDay(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoDay(d));
  return out;
};

const main = async () => {
  const old = JSON.parse(await readFile(DATA, "utf8").catch(() => "{}"));
  const daily = old.appStoreDaily || {};

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const recheckFrom = new Date();
  recheckFrom.setUTCDate(recheckFrom.getUTCDate() - RECHECK_DAYS);
  const jwt = token();
  for (const day of days(FIRST_DAY, isoDay(yesterday))) {
    if (day in daily && day < isoDay(recheckFrom)) continue;
    const units = await appStoreDay(jwt, day);
    if (units !== null) daily[day] = units;
  }

  const appStore = Object.values(daily).reduce((a, b) => a + b, 0);
  const gitHub = await gitHubDownloads();
  const total = appStore + gitHub;
  const now = new Date(Date.now() + 8 * 3600 * 1000); // Beijing date, like the rest of the site
  const stamp = isoDay(now).replaceAll("-", ".");

  const sorted = Object.fromEntries(Object.entries(daily).sort());
  await mkdir("data", { recursive: true });
  await writeFile(
    DATA,
    JSON.stringify({ date: stamp, total, appStore, gitHub, appStoreDaily: sorted }, null, 2) + "\n"
  );

  for (const page of PAGES) {
    const html = await readFile(page, "utf8");
    const next = html
      .replace(/data-downloads="\d+">[\d,]+</g, `data-downloads="${total}">${total.toLocaleString("en-US")}<`)
      .replace(/(data-downloads-date>)[\d.]+</g, `$1${stamp}<`);
    if (next !== html) await writeFile(page, next);
  }
  console.log(`App Store ${appStore} + GitHub ${gitHub} = ${total} (${stamp})`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
