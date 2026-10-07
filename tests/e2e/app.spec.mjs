import { test as base, expect } from "@playwright/test";
import { fakeNotifications, mockGuerrilla, mockMailGw } from "./mocks.mjs";

const test = base.extend({
  gw: async ({ page }, use) => {
    await use(await mockMailGw(page));
  },
});

const VERIFY_HTML = `<html><body>
  <p>Hi! Confirm your email address.</p>
  <table><tr><td>Your verification code</td></tr><tr><td>482913</td></tr></table>
  <p><a href="https://acme.example/verify?token=8f2c9a1b7e6d5c4b3a2f1e0d">Confirm email</a></p>
  <p><a href="https://acme.example/unsubscribe">Unsubscribe</a> - 2026 Acme</p>
  <img src="https://tracker.example/pixel.gif">
</body></html>`;

async function currentAddress(page) {
  await expect(page.locator("#address")).toContainText("@");
  return (await page.locator("#address").textContent()).trim();
}

test.beforeEach(async ({ page }) => {
  // English UI regardless of the machine's locale
  await page.addInitScript(() => {
    if (!localStorage.getItem("tempmail:lang")) localStorage.setItem("tempmail:lang", "en");
  });
});

test("creates an address, keeps it across reloads, no CSP violations", async ({ page, gw }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  const addr = await currentAddress(page);
  expect(addr).toMatch(/@mock\.gw$/);
  await expect(page.locator("#status")).toHaveText("Live - no mail yet");

  await page.reload();
  expect(await currentAddress(page)).toBe(addr);
  expect(gw.count("POST /accounts")).toBe(1);
  expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
});

test("first mail in a new inbox raises an alert and shows in the title", async ({ page, gw }) => {
  await fakeNotifications(page, "granted");
  await page.goto("/");
  await currentAddress(page);
  await expect(page.locator("#notify")).toHaveText("Alerts on");

  gw.deliver({ id: "m1", subject: "Welcome aboard", text: "hello" });
  await expect(page.locator(".row")).toHaveCount(1, { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1);
  expect(await page.evaluate(() => window.__notes[0].title)).toBe("Welcome aboard");
  await expect(page).toHaveTitle(/^\(1\) /);
});

test("alerts can be switched off again", async ({ page, gw }) => {
  await fakeNotifications(page, "default");
  await page.goto("/");
  await currentAddress(page);
  const btn = page.locator("#notify");
  await expect(btn).toHaveText("Alerts off");
  await btn.click();
  await expect(btn).toHaveText("Alerts on");
  await btn.click();
  await expect(btn).toHaveText("Alerts off");

  gw.deliver({ id: "m1", subject: "Quiet please" });
  await expect(page.locator(".row")).toHaveCount(1, { timeout: 10000 });
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);
});

test("opening a mail shows the code and the confirmation link; read state survives reload", async ({
  page,
  gw,
}) => {
  gw.deliver({ id: "m1", subject: "Verify your email", html: VERIFY_HTML });
  gw.deliver({ id: "m2", subject: "Second", text: "no code here" });
  await page.goto("/");

  const rows = page.locator(".row");
  await expect(rows).toHaveCount(2);
  // keyboard: rows are buttons, arrows move between them
  await rows.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(".code-box .code")).toHaveText("482913");
  const link = page.locator(".link-box a");
  await expect(link).toHaveAttribute("href", "https://acme.example/verify?token=8f2c9a1b7e6d5c4b3a2f1e0d");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator(".link-host")).toHaveText("acme.example");
  await expect(page.locator(".reader-body iframe")).toHaveAttribute("title", "Message body");
  await expect(rows.nth(1)).toBeFocused(); // focus kept after the list re-render
  await expect(rows.nth(1)).not.toHaveClass(/unread/);
  await expect(rows.nth(0)).toHaveClass(/unread/);

  await page.reload();
  await expect(page.locator(".row")).toHaveCount(2);
  await expect(page.locator(".row").nth(1)).not.toHaveClass(/unread/);
  await expect(page.locator("#status")).toHaveText("Live - 1 unread");
});

test("editing to a taken name keeps the current address", async ({ page, gw }) => {
  gw.taken.add("taken@mock.gw");
  await page.goto("/");
  const addr = await currentAddress(page);

  await page.click("#edit");
  await page.fill("#addr-local", "taken");
  await page.click("#edit-set");

  await expect(page.locator("#status")).toContainText("already taken");
  await expect(page.locator("#addr-edit")).toBeVisible(); // reopened to try again
  await expect(page.locator("#addr-local")).toHaveValue("taken");
  await page.click("#edit-cancel");
  expect(await currentAddress(page)).toBe(addr);
  await expect(page.locator(".app")).not.toHaveClass(/expired/);

  await page.click("#edit");
  await page.fill("#addr-local", "free.name");
  await page.press("#addr-local", "Enter");
  await expect(page.locator("#address")).toHaveText("free.name@mock.gw");
});

test("resume keeps the address while the provider rate-limits", async ({ page, gw }) => {
  await page.goto("/");
  const addr = await currentAddress(page);
  gw.listStatus = 429;
  await page.reload();
  expect(await currentAddress(page)).toBe(addr);
  await expect(page.locator("#status")).toHaveText("Provider rate limit - slowing down");
  expect(gw.count("POST /accounts")).toBe(1);

  gw.listStatus = null;
  gw.deliver({ id: "m1", subject: "Made it" });
  await expect(page.locator(".row")).toHaveCount(1, { timeout: 30000 });
});

test("an expired token is renewed with the stored password", async ({ page, gw }) => {
  await page.goto("/");
  const addr = await currentAddress(page);
  gw.tokens.clear(); // every token the page holds is now rejected
  await page.reload();
  expect(await currentAddress(page)).toBe(addr);
  await expect(page.locator("#status")).toHaveText("Live - no mail yet");
  expect(gw.count("POST /token")).toBe(2);
});

test("resume replaces an address whose account is gone", async ({ page, gw }) => {
  await page.goto("/");
  const addr = await currentAddress(page);
  gw.accounts.delete(addr);
  await page.reload();
  await expect(page.locator("#address")).not.toHaveText(addr);
  expect(await currentAddress(page)).toMatch(/@mock\.gw$/);
});

test("background polls don't re-announce the status line", async ({ page, gw }) => {
  await page.goto("/");
  await currentAddress(page);
  await expect(page.locator("#status")).toHaveText("Live - no mail yet");
  await page.evaluate(() => {
    window.__statusChanges = 0;
    new MutationObserver(() => window.__statusChanges++).observe(document.querySelector("#status"), {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const before = gw.count("GET /messages");
  await expect.poll(() => gw.count("GET /messages"), { timeout: 15000 }).toBeGreaterThan(before + 1);
  expect(await page.evaluate(() => window.__statusChanges)).toBe(0);
});

test("an expired address stays expired when the lifetime is raised", async ({ page, gw }) => {
  await page.clock.install();
  await page.goto("/");
  const addr = await currentAddress(page);
  await page.selectOption("#lifetime", "600");
  await page.clock.fastForward("10:30");
  await expect(page.locator("#expiry-clock")).toHaveText("00:00");
  await expect(page.locator(".app")).toHaveClass(/expired/);
  await expect.poll(() => gw.count("DELETE /accounts")).toBe(1);

  await page.selectOption("#lifetime", "max");
  await page.clock.fastForward("00:02");
  await expect(page.locator("#expiry-clock")).toHaveText("00:00");
  await expect(page.locator(".app")).toHaveClass(/expired/);
  await expect(page.locator("#status")).toHaveText("Address expired - get a fresh one");

  // reload after expiry: a fresh address, not the dead one
  await page.reload();
  await expect(page.locator("#address")).not.toHaveText(addr);
  await currentAddress(page);
});

test("burn asks first when the inbox holds mail", async ({ page, gw }) => {
  gw.deliver({ id: "m1", subject: "Keep me" });
  await page.goto("/");
  const addr = await currentAddress(page);
  await expect(page.locator(".row")).toHaveCount(1);

  page.once("dialog", (d) => d.dismiss());
  await page.click("#burn");
  expect(await currentAddress(page)).toBe(addr);

  page.once("dialog", (d) => d.accept());
  await page.click("#burn");
  await expect(page.locator("#address")).not.toHaveText(addr);
  await expect.poll(() => gw.count("DELETE /accounts")).toBe(1);
});

test("new address moves the old one to Recent and switching back works", async ({ page, gw }) => {
  await page.goto("/");
  const first = await currentAddress(page);
  await expect(page.locator("#history-wrap")).toBeHidden();

  await page.click("#new");
  await expect(page.locator("#address")).not.toHaveText(first);
  const second = await currentAddress(page);
  await expect(page.locator("#history-wrap")).toBeVisible();

  await page.selectOption("#history", first);
  await expect(page.locator("#address")).toHaveText(first);
  await expect(page.locator("#history option")).toHaveText(["-", second]);
});

test("Guerrilla: custom names come with a public-inbox warning", async ({ page, gw }) => {
  await mockGuerrilla(page);
  await page.goto("/");
  await currentAddress(page);
  await page.selectOption("#provider", "guerrilla");
  await expect(page.locator("#address")).toHaveText(/@guerrillamailblock\.com$/);
  await page.click("#edit");
  await expect(page.locator("#addr-warn")).toBeVisible();
  await page.click("#edit-cancel");

  await page.selectOption("#provider", "mailgw");
  await expect(page.locator("#address")).toHaveText(/@mock\.gw$/);
  await page.click("#edit");
  await expect(page.locator("#addr-warn")).toBeHidden();
});

test("tabs follow the ARIA tab pattern", async ({ page, gw }) => {
  await page.goto("/");
  await currentAddress(page);
  const inbox = page.locator("#tab-inbox");
  await inbox.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-about")).toBeFocused();
  await expect(page.locator("#tab-about")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-about")).toBeVisible();
  await expect(page.locator("#panel-inbox")).toBeHidden();
});

test("web app manifest and icons are served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  for (const icon of manifest.icons) {
    expect((await request.get(`/${icon.src}`)).ok(), icon.src).toBe(true);
  }
});

test("Mail.gw down: the page falls back to Guerrilla and says so", async ({ page, gw }) => {
  gw.down = true;
  await mockGuerrilla(page);
  await page.goto("/");
  await expect(page.locator("#address")).toHaveText(/@guerrillamailblock\.com$/);
  await expect(page.locator("#status")).toHaveText("Mail.gw is not responding - switched to Guerrilla Mail");
  await expect(page.locator("#provider")).toHaveValue("guerrilla");
});

test("explicitly picking a source that is down keeps the current address", async ({ page, gw }) => {
  await mockGuerrilla(page);
  await page.addInitScript(() => localStorage.setItem("tempmail:lang", "en"));
  gw.down = true;
  await page.goto("/");
  const addr = await currentAddress(page); // fell back to Guerrilla
  await page.selectOption("#provider", "mailgw");
  await expect(page.locator("#status")).toHaveText(
    "Mail.gw is not responding (server error) - try another source"
  );
  expect(await currentAddress(page)).toBe(addr);
  await expect(page.locator("#provider")).toHaveValue("guerrilla");
});
