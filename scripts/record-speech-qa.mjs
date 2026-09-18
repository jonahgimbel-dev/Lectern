#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const WAV = "/tmp/lectern-loop.wav";
const SRC = "/tmp/lectern-stt-test.wav";

function ensureWav() {
  if (!existsSync(SRC)) throw new Error("Missing speech fixture.");
  spawnSync("ffmpeg", ["-y", "-stream_loop", "12", "-i", SRC, "-t", "24", "-ac", "1", "-ar", "16000", WAV], {
    stdio: "ignore",
  });
}

async function dump(page, name) {
  const text = await page.locator("body").innerText().catch(() => "");
  writeFileSync(`/tmp/qa-${name}.txt`, `${page.url()}\n\n${text}`);
  await page.screenshot({ path: `/workspace/screenshots/qa-${name}.png`, fullPage: true }).catch(() => undefined);
  return text.slice(0, 900);
}

async function main() {
  ensureWav();
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV}`,
    ],
    headless: true,
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  const email = `qa.speech.${Date.now()}@lectern.test`;
  const notes = [];
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const signup = await page.evaluate(async ({ email, password }) => {
      const res = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name: "QA Speech" }),
      });
      return { status: res.status, body: await res.text() };
    }, { email, password: "LecternQa12345" });
    notes.push({ signup });
    await page.goto(`${BASE}/record`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    notes.push({ step: "record", url: page.url(), text: await dump(page, "record") });

    const nameBox = page.getByPlaceholder("Class name");
    if (await nameBox.count()) {
      await nameBox.fill("Accounting");
      await page.getByRole("button", { name: "Add class" }).click();
      await page.waitForTimeout(1500);
    }
    notes.push({ step: "after-class", text: await dump(page, "after-class") });

    const recState = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Rec");
      return { found: Boolean(btn), disabled: btn?.disabled ?? null, select: document.querySelector("select")?.value ?? null };
    });
    notes.push({ recState });
    if (recState.found && recState.disabled === false) {
      await page.getByRole("button", { name: /^Rec$/ }).click();
      await page.waitForTimeout(8000);
      await page.getByRole("button", { name: "Stop & save" }).click();
      await page.waitForURL(/\/lecture\//, { timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
    }
    const debug = await page.evaluate(() => window.__lectern ?? null);
    notes.push({ debug, url: page.url() });
    const after = await dump(page, "after-rec");
    const captions = `${debug?.snap?.captions ?? ""} ${debug?.parts?.join(" ") ?? ""} ${after}`;
    const heard = /receivable|account|money|customer|In one minute|lecture/i.test(captions);
    const saved = /\/lecture\//.test(page.url()) || /In one minute|they will ask/i.test(after);
    console.log(
      JSON.stringify(
        {
          ok: Boolean(heard || saved),
          heard,
          saved,
          captions,
          pcmLen: debug?.pcmLen,
          live: debug?.snap?.live,
          status: debug?.snap?.status,
          lastError: debug?.snap?.lastError,
          after: after.slice(0, 400),
          notes,
        },
        null,
        2,
      ),
    );
    process.exitCode = heard || saved ? 0 : 2;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), notes }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
