/**
 * Text preprocessing for the complaint classifier.
 *
 * The pipeline is deliberately conservative — complaint narratives
 * carry names, places, times and dates that must survive, so we only
 * do what helps the model match related phrasing:
 *
 *   1. lowercase + punctuation to whitespace (word boundaries only)
 *   2. domain lexicon mapping — English / Filipino / Cebuano surface
 *      forms of the same idea collapse to one canonical token, so
 *      "ingay", "saba" and "noise" become the same feature
 *   3. stopword removal (function words in English, Tagalog and
 *      Cebuano). Negation words are kept on purpose: "cannot sleep"
 *      and "can sleep" are different complaints.
 *   4. light English suffix stripping (plurals, -ing, -ed, -ly) with
 *      conservative minimum lengths so roots stay readable
 *   5. unigram + adjacent-content-bigram features ("street_light",
 *      "barangay_clearance") which carry a lot of the meaning here
 *
 * This module is pure and deterministic: training and inference run
 * the exact same code, which is what makes the learned weights
 * meaningful at prediction time.
 */

// Surface form -> canonical token. Applied before stopword removal so
// e.g. "nag-aaway" (hyphens become spaces) can still be mapped.
const LEXICON = {
  // noise / sound
  noisy: "noise",
  ingay: "noise",
  maingay: "noise",
  saba: "noise",
  masaba: "noise",
  tunog: "sound",
  tugtog: "music",
  magkaraoke: "karaoke",
  nagkaraoke: "karaoke",
  nagkakaraoke: "karaoke",
  videoke: "karaoke",

  // animals
  aso: "dog",
  iro: "dog",
  iring: "cat",
  ita: "cat",
  pusa: "cat",
  hayop: "animal",
  manok: "chicken",
  kambing: "goat",
  baka: "cow",
  daga: "rat",

  // theft / robbery
  kawat: "steal",
  nakaw: "steal",
  pangawat: "steal",
  magnanakaw: "steal",
  ninanakaw: "steal",
  ninakaw: "steal",
  robbery: "steal",
  burglar: "steal",
  snatch: "steal",
  snatched: "steal",
  gipangawat: "steal",
  stole: "steal",
  stolen: "steal",
  thief: "steal",

  // physical harm
  saksak: "stab",
  nasaksak: "stab",
  sinaksak: "stab",
  sinaksakan: "stab",
  pusil: "gun",
  armas: "weapon",
  suntok: "punch",
  sinuntok: "punch",
  pananakit: "hurt",
  nananakit: "hurt",
  sugat: "wound",
  bugbog: "beat",
  gipangbugbog: "beat",
  hampas: "hit",
  tumbok: "hit",
  nagtatapon: "throw",
  magtatapon: "throw",
  tatapon: "throw",

  // threats
  banta: "threat",
  binantaan: "threat",
  gipabantaan: "threat",
  pinagbantaan: "threat",
  pagbantaan: "threat",
  babantaan: "threat",
  bantaan: "threat",
  gitabiana: "threat",
  tabiana: "threat",
  threatened: "threat",
  menaced: "threat",

  // property damage
  guba: "damage",
  giguba: "damage",
  wasak: "destroy",
  sinira: "damage",
  nasira: "damage",
  sira: "damage",
  sisirain: "damage",
  sinisira: "damage",
  sirain: "damage",
  damaged: "damage",
  damaging: "damage",
  binasag: "break",
  vandalism: "vandal",
  keyed: "key",

  // suspicion / blame (death and false-accusation narratives)
  blamed: "blame",
  blames: "blame",
  blaming: "blame",
  accused: "blame",
  accusing: "blame",

  // gambling
  sugal: "gamble",
  nagsusugal: "gamble",
  pustahan: "gamble",
  pustuhan: "gamble",
  betting: "gamble",
  sabong: "gamble",

  // misc
  masked: "mask",
  told: "tell",
  merkado: "market",
  tindahan: "store",
  electricity: "power",
  uncollected: "collect",
  kotse: "car",

  // domestic / quarrel
  aaway: "quarrel",
  away: "quarrel",
  pamilya: "family",
  asawa: "spouse",

  // fence / boundary
  bakod: "fence",
  lote: "lot",
  hangganan: "boundary",
  pader: "wall",

  // parking / vehicles
  parada: "park",
  nakaparada: "park",
  sasakyan: "vehicle",
  sakyanan: "vehicle",

  // street light / dark
  ilaw: "light",
  dilim: "dark",
  madilim: "dark",

  // garbage / sanitation
  basura: "garbage",
  hugaw: "dirty",

  // construction
  konstruksyon: "construction",
  materyales: "material",

  // administrative documents
  sulat: "letter",

  // misc filipino/cebuano found in complaint text
  kapitbahay: "neighbor",
  silingan: "neighbor",
};

// Negations are intentionally absent: not / no / never / nothing /
// nobody / cannot / dont / hindi / wala / walay / dili all stay.
const STOPWORDS = new Set([
  // English function words
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at",
  "for", "with", "is", "are", "was", "were", "be", "been", "being",
  "am", "it", "its", "this", "that", "these", "those", "he", "she",
  "they", "him", "her", "them", "his", "their", "my", "your", "our",
  "mine", "yours", "ours", "i", "you", "we", "me", "us", "as", "from",
  "by", "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "may", "might", "must", "there", "here",
  "than", "then", "too", "very", "just", "about", "into", "over",
  "under", "again", "still", "also", "what", "when", "where", "who",
  "which", "why", "how", "all", "any", "each", "many", "much", "some",
  "more", "most", "other", "own", "same", "so", "if", "because",
  "while", "during", "after", "before", "up", "down", "out", "off",
  "once", "only", "such", "them", "been", "get", "got", "let", "said",
  "say", "says", "one", "two", "like", "even", "back", "going", "go",
  "well", "please", "kindly", "really", "quite", "rather",

  // Tagalog / Cebuano function words
  "ang", "ng", "mga", "sa", "na", "si", "ni", "niya", "ko", "mo",
  "ako", "ikaw", "kami", "kayo", "sila", "namin", "ninyo", "nila",
  "nyo", "ito", "iyan", "yan", "para", "kung", "dahil", "kasi",
  "pero", "ngunit", "at", "o", "ay", "lang", "lamang", "ra", "ba",
  "naman", "yung", "pag", "pagkat", "habang", "mula", "dito", "diyan",
  "doon", "ganon", "ganito", "bakit", "paano", "kailan", "sino",
  "ano", "alin", "mag", "nag", "nang", "ug", "og", "pa", "kay",
  "apan", "busa", "aron", "human", "samting", "samantalang", "kini",
  "kana", "kanang", "niini", "niana", "asa", "ngano", "unsa", "kinsa",
  "kanus", "dinhi", "didto", "adto", "pod", "jud", "gani", "od",
  "po", "opo", "halos", "tungod", "od", "im", "ive", "youre",
  "theyre", "weve", "thats", "theres", "whats", "lets",
  // note: contractions such as dont / didnt / isnt are deliberately
  // NOT stopwords — they are negation evidence, like not and hindi.
]);

/**
 * Light, conservative English suffix stripping. The lexicon already
 * handles Filipino/Cebuano variants, so this only needs to unify the
 * common English plural/gerund/past-tense forms.
 */
function stem(token) {
  if (token.length < 5) return token;

  // flies -> fly, but not "days" handled by generic s rule below
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  // -ly only on adverbs: loudly -> loud. "family" must not become
  // "fami", so -ily endings (family, quietly...) are excluded.
  if (token.length >= 6 && token.endsWith("ly") && !token.endsWith("ily")) {
    return token.slice(0, -2);
  }

  if (token.endsWith("ing") && token.length - 3 >= 4) {
    let out = token.slice(0, -3);
    if (/([bdfglmnprt])\1$/.test(out) && !/(ll|ss|zz|ff|rr)$/.test(out)) {
      out = out.slice(0, -1);
    }
    return out;
  }

  if (token.endsWith("ed") && token.length - 2 >= 4) {
    let out = token.slice(0, -2);
    if (/([bdfglmnprt])\1$/.test(out) && !/(ll|ss|zz|ff|rr)$/.test(out)) {
      out = out.slice(0, -1);
    }
    return out;
  }

  // simple plural: dogs -> dog, houses -> hous (both forms appear in
  // training data, so the mismatch is acceptable and never invented)
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is") &&
    token.length >= 4
  ) {
    return token.slice(0, -1);
  }

  return token;
}

/** Lowercase, punctuation to spaces, collapse whitespace. */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['\u2019\u2018]/g, "")
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalize -> split -> lexicon -> stopwords -> stem. */
export function tokenize(text) {
  const raw = normalize(text);
  if (!raw) return [];
  const out = [];
  for (const word of raw.split(" ")) {
    if (word.length < 2) continue;
    const mapped = LEXICON[word] ?? word;
    if (STOPWORDS.has(mapped) || STOPWORDS.has(word)) continue;
    const stemmed = stem(mapped);
    if (stemmed.length < 2) continue;
    if (STOPWORDS.has(stemmed)) continue;
    out.push(stemmed);
  }
  return out;
}

/**
 * Unigrams + adjacent-content-bigrams. Bigrams are formed from
 * neighbouring surviving tokens: "street light" -> street_light,
 * "barangay clearance" -> barangay_clearance.
 */
export function featurize(text) {
  const tokens = tokenize(text);
  const feats = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    feats.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return feats;
}
