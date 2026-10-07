import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextLinks, findCode, pickActionLink } from "../../docs/js/lib/detect.js";

test("findCode: 6-digit code after a keyword, year in the footer ignored", () => {
  assert.equal(
    findCode("Your verification code", "Your code is 482913.\n\n© 2026 Acme Inc."),
    "482913"
  );
});

test("findCode: a year or date before the code does not win", () => {
  assert.equal(findCode("Verify your email", "Sent Oct 7, 2026\nUse code 4821 to sign in."), "4821");
  assert.equal(findCode("Login code", "Date: 2026-10-07\nYour code: 771204"), "771204");
});

test("findCode: phone numbers in mail without a keyword are not codes", () => {
  assert.equal(findCode("Welcome to Acme", "Call us at 555 123 4567 any time."), null);
  assert.equal(findCode("Your order", "Questions? +1 800 555 1234"), null);
});

test("findCode: standalone 6-digit line counts even without a keyword", () => {
  assert.equal(findCode("Hello", "Hi,\n\n839201\n\nThanks"), "839201");
});

test("findCode: order numbers (#), prices and URLs are skipped", () => {
  assert.equal(
    findCode("Confirm your order", "Order #12345678 totals 1234.56 EUR. Your code: 553311"),
    "553311"
  );
  assert.equal(
    findCode("Verify", "Open https://x.example/v?id=123456789&n=4242 or enter 654321"),
    "654321"
  );
  assert.equal(findCode("Confirm payment", "Confirm the payment of 1234.56 EUR"), null);
});

test("findCode: code next to a keyword beats one further away", () => {
  assert.equal(
    findCode("", "Your verification code is 739104. Questions? Call +1 800 555 1234"),
    "739104"
  );
});

test("findCode: grouped and alphanumeric codes", () => {
  assert.equal(findCode("Security code", "Your code: 123 456"), "123 456");
  assert.equal(findCode("", "Your login code is K7Q2ZP"), "K7Q2ZP");
  // upper-case words without digits are not codes
  assert.equal(findCode("Your PIN", "ACCOUNT VERIFIED"), null);
});

test("findCode: code in the subject", () => {
  assert.equal(findCode("123456 is your Instagram code", "Someone tried to log in."), "123456");
});

test("findCode: other languages", () => {
  assert.equal(findCode("Apstiprinājums", "Jūsu kods: 4821"), "4821");
  assert.equal(findCode("", "Ihr Bestätigungscode lautet 918273."), "918273");
  assert.equal(findCode("", "Tu código de verificación es 564738"), "564738");
});

test("findCode: plain newsletter has no code", () => {
  assert.equal(findCode("Weekly digest", "We shipped 3 features this week. See you in 2027!"), null);
});

test("extractTextLinks: trailing punctuation trimmed, line text kept", () => {
  const links = extractTextLinks(
    "Confirm your account: https://ex.example/confirm?t=abc.\nSee (https://ex.example/help)."
  );
  assert.deepEqual(links, [
    { href: "https://ex.example/confirm?t=abc", text: "Confirm your account:" },
    { href: "https://ex.example/help", text: "See (" },
  ]);
});

test("pickActionLink: picks the confirm link, skips unsubscribe and socials", () => {
  const link = pickActionLink([
    { href: "https://twitter.com/acme", text: "Twitter" },
    { href: "https://acme.example/u/unsubscribe?id=1", text: "Unsubscribe" },
    { href: "https://acme.example/account/verify?token=8f2c9a1b7e6d5c4b3a2f1e0d", text: "Verify email" },
    { href: "https://acme.example/", text: "Acme" },
  ]);
  assert.deepEqual(link, {
    href: "https://acme.example/account/verify?token=8f2c9a1b7e6d5c4b3a2f1e0d",
    host: "acme.example",
  });
});

test("pickActionLink: keyword in the label alone is enough", () => {
  assert.equal(
    pickActionLink([{ href: "https://l.example/x/9c8b7a", text: "Confirm my address" }])?.host,
    "l.example"
  );
});

test("pickActionLink: rejects non-http schemes, relative and unrelated links", () => {
  assert.equal(
    pickActionLink([
      { href: "javascript:alert(1)", text: "Verify" },
      { href: "mailto:x@y.z", text: "Confirm" },
      { href: "/verify", text: "Verify" },
      { href: "https://shop.example/sale", text: "Big sale" },
      { href: "https://x.example/%E0%A4%A", text: "broken escape" },
    ]),
    null
  );
});
