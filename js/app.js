// UI: choose ayahs, reciter and look; preview; record the canvas + recitation into a video file.
import {
  SURAHS, RECITERS, UNDER_AYAH, surahName, ayahCount, wantsBasmala, getAyahs, recitation, arabicNumber,
} from "./quran.js";
import { Renderer, QURAN_FONT, TEXT_FONT_AR, TEXT_FONT_LATIN } from "./render.js";

const $ = (id) => document.getElementById(id);
const el = {
  surah: $("surah"), from: $("from"), to: $("to"), basmala: $("basmala"), basmalaRow: $("basmalaRow"),
  reciter: $("reciter"), listen: $("listen"), listenAudio: $("listenAudio"), under: $("under"),
  showReciter: $("showReciter"), aspect: $("aspect"), bgType: $("bgType"), bgImage: $("bgImage"),
  bgImageRow: $("bgImageRow"), dim: $("dim"), dimRow: $("dimRow"), scale: $("scale"), logo: $("logo"),
  preview: $("preview"), make: $("make"), status: $("status"), progress: $("progress"), canvas: $("canvas"),
  result: $("result"), video: $("video"), download: $("download"), share: $("share"), formatNote: $("formatNote"),
  textBox: $("textBox"), ayahText: $("ayahText"), install: $("install"), installHelp: $("installHelp"),
  installSteps: $("installSteps"), visits: $("visits"), visitsRow: $("visitsRow"),
};
const MAX_AYAHS = 50;
const SETTINGS_KEY = "ayah-video-settings";
const images = { bg: null, logo: null };
let busy = false;
let lastVideoUrl = null;

/** A new video replaces the old one: its file is released from memory and its player cleared. */
function clearResult() {
  if (lastVideoUrl) URL.revokeObjectURL(lastVideoUrl);
  lastVideoUrl = null;
  el.video.pause();
  el.video.removeAttribute("src");
  el.video.load();
  el.download.removeAttribute("href");
  el.share.hidden = true;
  el.share.onclick = null;
  el.formatNote.textContent = "";
  el.result.hidden = true;
}

// ---------- form ----------
SURAHS.forEach(([name, n], i) => el.surah.add(new Option(`${i + 1}. ${name} (${n} آية)`, i + 1)));
Object.entries(RECITERS).forEach(([k, v]) => el.reciter.add(new Option(v, k)));
Object.entries(UNDER_AYAH).forEach(([k, v]) => el.under.add(new Option(v[0], k)));

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { /* private mode */ }
  for (const k of ["surah", "reciter", "under", "aspect", "scale"]) if (s[k] != null) el[k].value = s[k];
  if (s.showReciter != null) el.showReciter.checked = s.showReciter;
  if (s.from) el.from.value = s.from;
  if (s.to) el.to.value = s.to;
  if (!s.under) el.under.value = "ar.mukhtasar";
}
function saveSettings() {
  const s = { surah: el.surah.value, from: el.from.value, to: el.to.value, reciter: el.reciter.value,
    under: el.under.value, aspect: el.aspect.value, scale: el.scale.value, showReciter: el.showReciter.checked };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

function range() {
  const surah = +el.surah.value;
  const n = ayahCount(surah);
  const from = Math.min(Math.max(1, Math.floor(+el.from.value || 1)), n);
  const to = Math.min(Math.max(from, Math.floor(+el.to.value || from)), n);
  return { surah, from, to };
}

function syncForm() {
  const n = ayahCount(+el.surah.value);
  el.from.max = n;
  el.to.max = n;
  if (+el.from.value > n) el.from.value = n;
  if (+el.to.value > n) el.to.value = n;
  el.basmalaRow.hidden = !wantsBasmala(+el.surah.value, +el.from.value);
  el.bgImageRow.hidden = el.bgType.value !== "image";
  el.dimRow.hidden = el.bgType.value !== "image";
}

function status(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("error", isError);
}

function readImage(input, key) {
  const f = input.files && input.files[0];
  if (!f) { images[key] = null; return; }
  const img = new Image();
  img.onload = () => { images[key] = img; drawIdle(); };
  img.src = URL.createObjectURL(f);
}

// ---------- fonts ----------
async function fontsReady() {
  await Promise.all([
    document.fonts.load(`64px "${QURAN_FONT}"`, "بِسْمِ"),
    document.fonts.load(`40px "${TEXT_FONT_AR}"`, "تفسير"),
    document.fonts.load(`40px "${TEXT_FONT_LATIN}"`, "Allah"),
  ]).catch(() => {});
}

function renderer(scenes = null, surah = 1) {
  const under = el.under.value;
  const r = new Renderer(el.canvas, {
    aspect: el.aspect.value,
    scale: +el.scale.value,
    showReciter: el.showReciter.checked,
    reciterName: RECITERS[el.reciter.value],
    sourceLine: el.showReciter.checked ? UNDER_AYAH[under][1] : "",
    underDir: UNDER_AYAH[under][2],
    background: { type: el.bgType.value, image: images.bg, dim: +el.dim.value },
    logo: images.logo,
  });
  if (scenes) r.prepare(scenes, surah);
  return r;
}

async function drawIdle() {
  if (busy) return;
  await fontsReady();
  const { surah, from } = range();
  const r = renderer([{ surah, ayah: from, text: "", under: "", start: 0, duration: 1 }], surah);
  r.scenes[0].pages = [{ lines: [`سورة ${surahName(surah)}`], size: r.layout.base, start: 0, end: 99 }];
  r.total = 0;   // a still picture: no fade-out
  r.draw(1);
}

// ---------- the ayahs, with their recitation ----------
async function loadScenes(audioCtx) {
  const { surah, from, to } = range();
  if (to - from + 1 > MAX_AYAHS) throw new Error(`اختر ${MAX_AYAHS} آية على الأكثر في الفيديو الواحد.`);
  status("📖 جاري تنزيل نص الآيات…");
  const scenes = await getAyahs(surah, from, to, el.under.value, el.basmala.checked);
  showText(scenes);
  let done = 0;
  status(`🎙️ جاري تنزيل التلاوة… 0/${scenes.length}`);
  const buffers = await Promise.all(scenes.map(async (sc) => {
    const bytes = await recitation(el.reciter.value, sc.surah, sc.audioAyah);
    const buf = await audioCtx.decodeAudioData(bytes);
    status(`🎙️ جاري تنزيل التلاوة… ${++done}/${scenes.length}`);
    return buf;
  }));
  // one continuous track: each ayah stays on screen exactly while it is recited
  let t = 0;
  scenes.forEach((sc, i) => { sc.start = t; sc.duration = buffers[i].duration; t += sc.duration; });
  const tail = 1.0;
  scenes[scenes.length - 1].duration += tail;
  const total = t + tail;
  const rate = audioCtx.sampleRate;
  const track = audioCtx.createBuffer(2, Math.ceil(total * rate), rate);
  let offset = 0;
  for (const b of buffers) {
    for (let ch = 0; ch < 2; ch++) track.getChannelData(ch).set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), offset);
    offset += b.length;
  }
  return { scenes, track, total, surah };
}

function showText(scenes) {
  el.ayahText.textContent = scenes.map((s) => s.ayah ? `${s.text} ﴿${arabicNumber(s.ayah)}﴾` : s.text).join("  ");
  el.textBox.hidden = false;
}

function pickMime() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

/** Plays the recitation and draws the frames in step with it; records both when asked. */
async function play(record) {
  if (busy) return;
  busy = true;
  el.preview.disabled = el.make.disabled = true;
  if (record) clearResult();
  saveSettings();
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  try {
    await fontsReady();
    const { scenes, track, total, surah } = await loadScenes(audioCtx);
    const r = renderer(scenes, surah);
    r.draw(0);

    const src = audioCtx.createBufferSource();
    src.buffer = track;
    src.connect(audioCtx.destination);
    let recorder = null;
    const chunks = [];
    const mime = record ? pickMime() : "";
    if (record) {
      if (!window.MediaRecorder || !el.canvas.captureStream) throw new Error("هذا المتصفح لا يدعم تسجيل الفيديو. جرّب Chrome أو Edge أو Safari حديثاً.");
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest);
      const stream = new MediaStream([...el.canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start(1000);
    }
    status(record ? "🔴 جاري التسجيل… أبقِ هذه الصفحة ظاهرة حتى ينتهي" : "▶️ معاينة…");
    el.progress.hidden = false;
    const t0 = audioCtx.currentTime + 0.25;
    src.start(t0);
    await new Promise((done) => {
      const frame = () => {
        const t = audioCtx.currentTime - t0;
        r.draw(Math.max(0, t));
        el.progress.value = Math.min(1, Math.max(0, t / total));
        if (t >= total) return done();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    src.stop();
    if (recorder) {
      await new Promise((ok) => { recorder.onstop = ok; recorder.stop(); });
      const type = recorder.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      showResult(blob, type, surah);
    } else status("✅ انتهت المعاينة");
  } catch (e) {
    console.error(e);
    status(e.message || String(e), true);
  } finally {
    audioCtx.close();
    busy = false;
    el.progress.hidden = true;
    el.preview.disabled = el.make.disabled = false;
    drawIdle();   // don't leave the faded-out last frame on screen
  }
}

function showResult(blob, type, surah) {
  const { from, to } = range();
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(blob);
  lastVideoUrl = url;
  el.video.src = url;
  el.download.href = url;
  const name = `ayah-${surah}-${from}${to > from ? "-" + to : ""}.${ext}`;
  el.download.download = name;
  el.result.hidden = false;
  const h264 = /avc1|h264/i.test(type);
  const size = `الحجم ${(blob.size / 1048576).toFixed(1)} ميغابايت.`;
  el.formatNote.textContent = h264 ? size : `${size} سُجّل الفيديو بصيغة ${ext.toUpperCase()} غير H.264 لأن هذا المتصفح لا يدعمها؛ `
    + "يعمل على YouTube وواتساب، ولأفضل توافق مع Instagram وTikTok استخدم Chrome أو Edge أو Safari بإصدار حديث.";
  const file = new File([blob], name, { type });
  el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  el.share.onclick = () => navigator.share({ files: [file], title: `سورة ${surahName(surah)}` }).catch(() => {});
  status("✅ الفيديو جاهز");
  el.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- events ----------
el.surah.addEventListener("change", () => { el.from.value = 1; el.to.value = Math.min(3, ayahCount(+el.surah.value)); syncForm(); drawIdle(); });
for (const k of ["from", "to"]) el[k].addEventListener("change", () => { syncForm(); drawIdle(); });
for (const k of ["aspect", "scale", "under", "showReciter", "reciter", "dim"]) el[k].addEventListener("change", drawIdle);
el.bgType.addEventListener("change", () => { syncForm(); drawIdle(); });
el.bgImage.addEventListener("change", () => readImage(el.bgImage, "bg"));
el.logo.addEventListener("change", () => readImage(el.logo, "logo"));
el.listen.addEventListener("click", () => {
  const { surah, from } = range();
  el.listenAudio.src = `https://everyayah.com/data/${el.reciter.value}/${String(surah).padStart(3, "0")}${String(from).padStart(3, "0")}.mp3`;
  el.listenAudio.play().catch((e) => status(e.message, true));
});
el.preview.addEventListener("click", () => play(false));
el.make.addEventListener("click", () => play(true));

// ---------- install as an app (PWA) ----------
let installPrompt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener("appinstalled", () => { installPrompt = null; el.install.hidden = true; });
if (standalone()) el.install.hidden = true;

function installSteps() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return ["افتح الموقع في متصفح Safari.", "اضغط زر المشاركة ⬆️ أسفل الشاشة.", "اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة»."];
  if (/Android/i.test(ua))
    return ["افتح الموقع في متصفح Chrome.", "اضغط قائمة النقاط الثلاث ⋮ أعلى الشاشة.", "اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»."];
  if (/Firefox/i.test(ua))
    return ["متصفح Firefox على الحاسوب لا يثبّت التطبيقات.", "افتح الموقع في Chrome أو Edge، ثم اضغط زر «📲 تثبيت التطبيق» مرة أخرى."];
  return ["في Chrome أو Edge: اضغط أيقونة التثبيت ⊕ في نهاية شريط العنوان.", "أو من القائمة ⋮ اختر «تثبيت فيديو آية» (في Edge: التطبيقات ← تثبيت هذا الموقع كتطبيق)."];
}

el.install.addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    return;
  }
  el.installSteps.replaceChildren(Object.assign(document.createElement("ol"), {
    innerHTML: installSteps().map((t) => `<li>${t}</li>`).join(""),
  }));
  el.installHelp.showModal();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- visitor counter (abacus.jasoncameron.dev, a free counting service) ----------
async function countVisit() {
  const base = "https://abacus.jasoncameron.dev";
  let counted = false;
  try { counted = sessionStorage.getItem("ayah-video-counted") === "1"; } catch { /* private mode */ }
  try {
    const r = await fetch(`${base}/${counted ? "get" : "hit"}/alialsaffar-parades/visits`);
    if (!r.ok) return;
    const { value } = await r.json();
    if (typeof value !== "number") return;
    try { sessionStorage.setItem("ayah-video-counted", "1"); } catch { /* private mode */ }
    el.visits.textContent = value.toLocaleString("ar");
    el.visitsRow.hidden = false;
  } catch { /* the counter is optional: stay hidden when it can't be reached */ }
}

loadSettings();
syncForm();
drawIdle();
if (location.hostname.endsWith("github.io")) countVisit();   // count real visits only

// for automated checks: draw any moment of a prepared video without playing it
window.__ayahVideo = {
  async frameAt(t) {
    const ctx = new AudioContext();
    const data = await loadScenes(ctx);
    ctx.close();
    await fontsReady();
    const r = renderer(data.scenes, data.surah);
    r.draw(t);
    return data.total;
  },
  play,
};
