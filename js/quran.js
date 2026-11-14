// Quran text, tafsir/translations and recitations. Nothing here is written or changed by AI:
// the Uthmani text (Tanzil) and translations come from api.alquran.cloud, Al-Mukhtasar from the
// quran.com tafsir data on jsDelivr, and each recited ayah from everyayah.com.
import { SURAHS, RECITERS } from "./data.js";

const TEXT_API = (surah, edition) => `https://api.alquran.cloud/v1/surah/${surah}/${edition}`;
const TAFSIR_API = (slug, surah) => `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${slug}/${surah}.json`;
const AUDIO_URL = (reciter, surah, ayah) =>
  `https://everyayah.com/data/${reciter}/${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}.mp3`;
const TEXT_EDITION = "quran-uthmani";
const TAFSIR_SLUGS = { "ar.mukhtasar": "ar-tafsir-al-mukhtasar" };

// shown under the ayah: [label in the menu, source line written in the video, text direction]
export const UNDER_AYAH = {
  "ar.mukhtasar": ["المختصر في التفسير (مركز تفسير)", "التفسير: المختصر في التفسير", "rtl"],
  "ar.muyassar": ["التفسير الميسّر (مجمع الملك فهد)", "التفسير: التفسير الميسّر", "rtl"],
  "en.sahih": ["English — Saheeh International", "Translation: Saheeh International", "ltr"],
  "de.bubenheim": ["Deutsch — Bubenheim & Elyas", "Übersetzung: Bubenheim & Elyas", "ltr"],
  "fr.hamidullah": ["Français — Muhammad Hamidullah", "Traduction : Muhammad Hamidullah", "ltr"],
  none: ["بدون", "", "rtl"],
};

export { SURAHS, RECITERS };
export const surahName = (s) => SURAHS[s - 1][0];
export const ayahCount = (s) => SURAHS[s - 1][1];

// harakat, Quranic annotation marks and tatweel: ignored when comparing or measuring text
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
export const plain = (t) => t.replace(MARKS, "").replace(/ٱ/g, "ا");
export const letters = (t) => plain(t).replace(/\s/g, "").length;
export const arabicNumber = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const BASMALA = "بسم الله الرحمن الرحيم";

/** The Tanzil text puts the basmala in front of the first ayah of every surah but Al-Fatiha
 *  (where it is ayah 1) and At-Tawbah (none). The recitation of that ayah does not include it,
 *  so it is taken off here and shown as its own scene instead. */
export function stripBasmala(text) {
  const w = text.split(/\s+/);
  return w.length > 4 && plain(w.slice(0, 4).join(" ")) === BASMALA ? w.slice(4).join(" ") : text;
}

export const wantsBasmala = (surah, start) => start === 1 && surah !== 1 && surah !== 9;

const memo = new Map();

async function fetchJson(url) {
  let err;
  for (let i = 0; i < 3; i++) {   // the CDN now and then answers with an error page: try again
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  throw err;
}

/** All the ayahs of one surah in one edition (Quran text, tafsir or translation). */
async function surahEdition(surah, edition) {
  const key = `${edition}:${surah}`;
  if (memo.has(key)) return memo.get(key);
  let data;
  try {
    if (TAFSIR_SLUGS[edition]) {
      const rows = (await fetchJson(TAFSIR_API(TAFSIR_SLUGS[edition], surah))).sort((a, b) => a.ayah - b.ayah);
      if (rows.some((r, i) => r.ayah !== i + 1)) throw new Error("ayah numbers do not match");
      data = rows.map((r) => r.text);
    } else {
      data = (await fetchJson(TEXT_API(surah, edition))).data.ayahs.map((a) => a.text);
    }
  } catch (e) {
    throw new Error(`تعذّر تنزيل نص سورة ${surahName(surah)}. تأكد من الاتصال بالإنترنت. (${e.message})`);
  }
  data = data.map((t) => t.replace(/﻿/g, "").trim());
  if (data.length !== ayahCount(surah))
    throw new Error(`النص الذي وصل لسورة ${surahName(surah)} ناقص (${data.length} من ${ayahCount(surah)} آية)`);
  memo.set(key, data);
  return data;
}

/** [{surah, ayah, text, under}] for ayahs start..end; ayah is null for the basmala scene. */
export async function getAyahs(surah, start, end, under = "none", withBasmala = true) {
  const [text, extra] = await Promise.all([
    surahEdition(surah, TEXT_EDITION),
    under && under !== "none" ? surahEdition(surah, under) : null,
  ]);
  const out = [];
  if (withBasmala && wantsBasmala(surah, start)) {
    const fatiha = await surahEdition(1, TEXT_EDITION);
    out.push({ surah: 1, ayah: null, audioAyah: 1, text: fatiha[0], under: "" });
  }
  for (let n = start; n <= end; n++) {
    let t = text[n - 1];
    if (n === 1 && surah !== 1) t = stripBasmala(t);
    out.push({ surah, ayah: n, audioAyah: n, text: t, under: extra ? extra[n - 1] : "" });
  }
  return out;
}

/** One recited ayah as raw MP3 bytes. */
export async function recitation(reciter, surah, ayah) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(AUDIO_URL(reciter, surah, ayah));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength < 1000) throw new Error("ملف قصير");
      return buf;
    } catch (e) {
      err = e;
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  throw new Error(`تعذّر تنزيل تلاوة الآية ${surah}:${ayah} للقارئ ${RECITERS[reciter] || reciter}. (${err.message})`);
}
