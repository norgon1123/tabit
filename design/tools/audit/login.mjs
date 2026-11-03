/**
 * Produce a Playwright storageState for the audit to reuse.
 *
 * The audit captures; it does not authenticate. Driving a login during a
 * sweep would make capture an INTERACTION with the app rather than a read of
 * it, and the failure modes are ugly: a login form that changes breaks every
 * route rather than one, and a sweep that half-authenticates produces
 * artifacts that are partly the app and partly its login page.
 *
 * So the session is obtained ONCE, by a human, here — and the sweep restores
 * it. That is what Playwright's storageState is for, and it is why `auth:` in
 * the env contract takes a path rather than credentials: this file never sees
 * a password, and nothing secret is written into the contract.
 *
 *   node design/tools/audit/login.mjs [--url http://localhost:3000] [--out design/survey/.auth.json]
 *
 * A browser opens. Log in however the app expects — OAuth, a dev form, a
 * magic link. When you are done, return here and press Enter; the cookies and
 * localStorage are written to --out.
 *
 * The output holds a live session. It belongs in .gitignore, and the default
 * path is dotted so a careless `git add design/survey` does not take it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

import { loadPlaywright } from "./stages/capture.mjs";

const DEFAULT_OUT = "design/survey/.auth.json";

export function parseArgs(argv = []) {
  const out = { url: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") out.url = argv[++i] ?? null;
    else if (argv[i] === "--out") out.out = argv[++i] ?? DEFAULT_OUT;
  }
  return out;
}

/** Read baseUrl out of the env contract so --url is usually unnecessary. */
export function urlFromContract(src) {
  const m = String(src ?? "").match(/^baseUrl:\s*(\S+)/m);
  return m ? m[1] : null;
}

const ask = (question) =>
  new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => {
      rl.close();
      done();
    });
  });

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const contract = existsSync("design/survey/env-contract.yaml")
    ? readFileSync("design/survey/env-contract.yaml", "utf8")
    : "";
  const url = args.url ?? urlFromContract(contract) ?? "http://localhost:3000";

  const pw = await loadPlaywright(process.cwd());
  if (!pw) {
    console.error(
      "playwright is not resolvable from this repo — the audit needs it for T1 too",
    );
    return 2;
  }

  // headless:false is the whole point: a human has to be able to log in.
  const browser = await pw.chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  console.log(`\nA browser is open at ${url}.`);
  console.log("Log in however the app expects, then come back here.");
  await ask("\nPress Enter once you are logged in… ");

  const state = await context.storageState();
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2));
  await browser.close();

  const cookies = state.cookies?.length ?? 0;
  console.log(`\nwrote ${args.out} — ${cookies} cookie(s)`);
  if (cookies === 0) {
    // Said plainly: an empty state is indistinguishable from no state, and
    // the sweep that uses it will look authenticated and not be.
    console.log(
      "\nWARNING: no cookies were captured. The session may live somewhere this\n" +
        "does not reach, or the login did not complete. A sweep using this file\n" +
        "will capture login pages while reporting success.",
    );
  }
  console.log(`\nNow set it in design/survey/env-contract.yaml:\n\n  auth: ${args.out}\n`);
  console.log("This file holds a live session — keep it out of git.");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
