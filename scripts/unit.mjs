// Unit tests for the security-critical pure logic. Run: npm test (Node 22.6+ strips the TypeScript types).
import { isPrivateIp, publicJson } from "../src/lib/safe.ts";
import { createNonce, fmtUsd, itemRefOf, taskBudget, taskIdOf, fundingTypedData, TUSD8 } from "../src/lib/aevum.ts";
import { fold, similarity } from "../src/lib/text.ts";
import { encrypt, decrypt } from "../src/lib/crypto.ts";
import { BANK, PASS_MARK } from "../src/lib/qualify.ts";
import { isEnabled, allowedLang, LANGUAGES, TEST_LANGS, cleanLang, dirFor, hasTest, guessCurrency, curByCode, CURRENCIES } from "../src/lib/languages.ts";

let fails = 0;
const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond ? "" : "  " + detail}`); };
const rejects = async (p) => { try { await p; return null; } catch (e) { return String(e.message); } };

console.log("safe.ts: private address guard");
for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"])
  ok(`blocks ${ip}`, isPrivateIp(ip));
for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "104.18.0.1", "2606:4700:4700::1111"]) ok(`allows ${ip}`, !isPrivateIp(ip));

console.log("safe.ts: publicJson refuses unsafe targets (no network needed)");
for (const [url, why] of [["http://example.com/x", "plain http"], ["https://example.com:8443/x", "custom port"], ["https://user:pw@example.com/x", "credentials"],
  ["https://127.0.0.1/", "loopback IP literal"], ["https://169.254.169.254/latest/meta-data/", "cloud metadata IP"], ["https://[::1]/", "IPv6 loopback literal"], ["https://localhost/", "localhost by name"]])
  ok(`rejects ${why}`, !!(await rejects(publicJson(url, 3000))), url);

console.log("aevum.ts: amounts, ids and the funding signature");
ok("budget = every slot at the reward", taskBudget(10, 200_000, null) === 2_000_000);
ok("voice budget adds one peer check per slot", taskBudget(10, 200_000, 60_000) === 2_600_000);
ok("formats dollars", fmtUsd(200_000) === "$0.20" && fmtUsd(2_600_000) === "$2.60" && fmtUsd(50_000) === "$0.05" && fmtUsd(0) === "$0", [fmtUsd(200_000), fmtUsd(2_600_000), fmtUsd(50_000)].join());
ok("task and item ids never collide", taskIdOf("x") !== itemRefOf("x"));
ok("task ids are stable", taskIdOf("6f1c") === taskIdOf("6f1c"));
{
  const esc = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", who = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const terms = { operator: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", reward: 200_000n, reviewReward: 0n, maxPerWorker: 1_000_000n, holdSecs: 60n };
  const n = createNonce(esc, "t1", who, terms);
  ok("the nonce covers the operator", n !== createNonce(esc, "t1", who, { ...terms, operator: who }));
  ok("the nonce covers the reward", n !== createNonce(esc, "t1", who, { ...terms, reward: 200_001n }));
  ok("the nonce covers the hold", n !== createNonce(esc, "t1", who, { ...terms, holdSecs: 0n }));
  ok("the nonce covers the task", n !== createNonce(esc, "t2", who, terms));
  const td = fundingTypedData({ escrow: esc, requester: who, budget: 5n, validAfter: 0n, validBefore: 9n, nonce: n });
  ok("signs for tUSD8 on Aevum, to the escrow", td.domain.verifyingContract === TUSD8 && td.domain.chainId === 44005 && td.message.to === esc && td.domain.name === "tUSD8" && td.domain.version === "2");
}

console.log("text.ts: tone marks and spelling variants");
ok("folds Yoruba tone marks", fold("Ẹ káàárọ̀") === "e kaaaro", fold("Ẹ káàárọ̀"));
ok("tone-mark variants match", similarity("Ẹ káàárọ̀", "E kaaaro") === 1);
ok("punctuation and case ignored", similarity("Wetin you dey do for there?", "wetin you dey do for there") === 1);
ok("different sentences score low", similarity("How you dey today", "Abeg make we go market") < 0.5);

console.log("crypto.ts: encryption at rest");
process.env.NODE_ENV = "test"; process.env.APP_SECRET = "unit-test-secret-0123456789";
const blob = encrypt("secret-value-xyz");
ok("round trip", decrypt(blob) === "secret-value-xyz");
ok("ciphertext hides the secret", !blob.includes("secret") && !blob.includes("xyz"));
ok("random IV: same input encrypts differently", encrypt("a") !== encrypt("a"));
ok("tampering is detected", !!(await rejects((async () => { const [iv, tag, enc] = blob.split("."); decrypt([iv, tag, Buffer.from("tampered").toString("base64")].join(".")); })())));
process.env.NODE_ENV = "production"; delete process.env.APP_SECRET;
ok("production refuses to run without APP_SECRET", !!(await rejects((async () => encrypt("x"))())));
process.env.APP_SECRET = "change-me-to-a-long-random-string";
ok("production refuses the placeholder secret", !!(await rejects((async () => encrypt("x"))())));

console.log("qualify.ts: question bank");
for (const [lang, qs] of Object.entries(BANK)) ok(`${lang}: ${qs.length} questions, valid answers, passable`, qs.length >= PASS_MARK && qs.every((q) => q.options.length >= 3 && q.answer >= 0 && q.answer < q.options.length));

console.log("languages.ts: any language, text direction, currencies");
ok("test list matches the qualification bank", [...TEST_LANGS].sort().join() === Object.keys(BANK).sort().join(), `${TEST_LANGS} vs ${Object.keys(BANK)}`);
ok("language names and codes are unique", new Set(LANGUAGES.map((l) => l.name)).size === LANGUAGES.length && new Set(LANGUAGES.map((l) => l.code)).size === LANGUAGES.length);
ok("canonicalises a known name", cleanLang("  swahili ") === "Swahili" && cleanLang("isiZulu") === "Zulu" && cleanLang("yo") === "Yoruba");
ok("accepts a language not in the list", cleanLang("Tumbuka") === "Tumbuka" && cleanLang("Ndebele (Zimbabwe)") === "Ndebele (Zimbabwe)");
for (const bad of ["", "x", "<script>", "a".repeat(41), "Hausa; DROP TABLE tasks", "123"]) ok(`rejects ${JSON.stringify(bad.slice(0, 20))}`, cleanLang(bad) === null);
ok("Arabic and unknown RTL scripts display right-to-left", dirFor("Arabic") === "rtl" && dirFor("Unknown", "ߒߞߏ") === "rtl" && dirFor("Hausa") === "ltr");
ok("only English and tested languages can gate a task", hasTest("English") && hasTest("Swahili") && !hasTest("Tumbuka"));
ok("every currency code is unique", new Set(CURRENCIES.map((c) => c.code)).size === CURRENCIES.length);
ok("guesses currency from the browser locale", guessCurrency("sw-KE") === "KES" && guessCurrency("en-NG") === "NGN" && guessCurrency("fr-SN") === "XOF" && guessCurrency("en") === "USD" && !!curByCode("GHS"));

ok("launch set is Nigerian only", ["English", "Nigerian Pidgin", "Yoruba", "Hausa"].every(isEnabled) && !isEnabled("Swahili") && !isEnabled("Tumbuka"));
ok("tasks may only use enabled languages", allowedLang("yoruba") === "Yoruba" && allowedLang("Swahili") === null && allowedLang("Tumbuka") === null);

ok("Latin and tone-marked text is never right-to-left", ["Good evening, how was your day?", "Ẹ káàárọ̀", "Ina kwana", "xudunsdndsinsds", "Wetin dey happen?", "ɛte sɛn"].every((t) => dirFor("English", t) === "ltr" && dirFor("Yoruba", t) === "ltr"));
ok("Ethiopic stays left-to-right, Adlam goes right-to-left", dirFor("Amharic", "አመሰግናለሁ") === "ltr" && dirFor("Fula", "\u{1E922}\u{1E923}") === "rtl");

console.log("text.ts: other African orthographies");
ok("folds Twi/Ewe/Hausa special letters", similarity("Akwaaba, ɛte sɛn?", "akwaaba ete sen") === 1 && fold("ƙasa ɗaya ɓoye") === "kasa daya boye", fold("ƙasa ɗaya ɓoye"));
ok("folds Arabic vowel marks and alef forms", fold("أَهْلاً") === fold("اهلا"), fold("أَهْلاً"));
ok("Ethiopic script is left intact", fold("አመሰግናለሁ") === "አመሰግናለሁ");

console.log(fails ? `\n${fails} unit test(s) FAILED` : "\nAll unit tests passed");
process.exit(fails ? 1 : 0);
