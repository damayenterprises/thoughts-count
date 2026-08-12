// TC-106 — unit tests for the voice-memo add-a-person door's PURE pieces: the audio mime/size guard
// and the mime→extension mapping. No network, no DB, no key (the Whisper call itself is exercised
// live by the Validator with a real recording). These lock the guard that stops a bad/oversize/
// wrong-type file from EVER reaching a paid transcription call, mirroring the image door's guard.
// Run:  node test/spec-tc106-audio-guard.test.mjs
import assert from "node:assert";
import { guardAudio, audioExtFromMime, ALLOWED_AUDIO_MIMES, MAX_AUDIO_BYTES } from "../netlify/functions/_audio.mjs";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# guardAudio — accepts real voice-memo containers");
for (const m of ALLOWED_AUDIO_MIMES) {
  t(`accepts ${m}`, () => { assert.equal(guardAudio(m, 1024).ok, true); });
}

t("accepts a mime with a charset/codec suffix (audio/webm;codecs=opus)", () => {
  assert.equal(guardAudio("audio/webm;codecs=opus", 2048).ok, true);
});

t("tolerates empty mime (some pickers report '' for a .m4a)", () => {
  assert.equal(guardAudio("", 2048).ok, true);
});

t("tolerates application/octet-stream (generic picker type)", () => {
  assert.equal(guardAudio("application/octet-stream", 2048).ok, true);
});

t("lets an unlisted audio/* codec through (OpenAI judges it)", () => {
  assert.equal(guardAudio("audio/aac", 2048).ok, true);
});

console.log("# guardAudio — refuses junk BEFORE a paid call");
t("rejects an empty payload (0 bytes)", () => {
  const g = guardAudio("audio/webm", 0);
  assert.equal(g.ok, false); assert.equal(g.status, 400);
});

t("rejects an oversize payload (> MAX_AUDIO_BYTES)", () => {
  const g = guardAudio("audio/mp3", MAX_AUDIO_BYTES + 1);
  assert.equal(g.ok, false); assert.equal(g.status, 413);
});

t("rejects a clearly-wrong type (an image)", () => {
  const g = guardAudio("image/jpeg", 4096);
  assert.equal(g.ok, false); assert.equal(g.status, 415);
});

t("rejects a video upload", () => {
  const g = guardAudio("video/mp4", 4096);
  assert.equal(g.ok, false); assert.equal(g.status, 415);
});

t("guard messages carry no AI-tell punctuation (no em/en dash, ellipsis, smart quotes)", () => {
  const msgs = [
    guardAudio("audio/webm", 0).error,
    guardAudio("audio/webm", MAX_AUDIO_BYTES + 1).error,
    guardAudio("image/png", 10).error,
  ];
  for (const s of msgs) {
    assert.ok(s, "message present");
    assert.ok(!/[–—…‘’“”]/.test(s), `no chrome punctuation in: ${s}`);
  }
});

console.log("# audioExtFromMime — maps to an ext OpenAI accepts");
t("mp4/m4a → m4a", () => {
  assert.equal(audioExtFromMime("audio/mp4"), "m4a");
  assert.equal(audioExtFromMime("audio/x-m4a"), "m4a");
  assert.equal(audioExtFromMime("audio/m4a"), "m4a");
});
t("ogg → ogg", () => { assert.equal(audioExtFromMime("audio/ogg"), "ogg"); });
t("wav/wave → wav", () => {
  assert.equal(audioExtFromMime("audio/wav"), "wav");
  assert.equal(audioExtFromMime("audio/wave"), "wav");
  assert.equal(audioExtFromMime("audio/x-wav"), "wav");
});
t("mpeg/mp3 → mp3", () => {
  assert.equal(audioExtFromMime("audio/mpeg"), "mp3");
  assert.equal(audioExtFromMime("audio/mp3"), "mp3");
});
t("webm → webm", () => { assert.equal(audioExtFromMime("audio/webm"), "webm"); });
t("unknown/empty → safe webm default (never throws)", () => {
  assert.equal(audioExtFromMime(""), "webm");
  assert.equal(audioExtFromMime("application/octet-stream"), "webm");
  assert.equal(audioExtFromMime(null), "webm");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
