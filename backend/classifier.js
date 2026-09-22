// classifier.js
// Takes LLM-extracted candidate facts and independently decides
// type + confidence. The LLM never sees or influences these numbers.
// Parses the witness's own words (claim1/claim2), not the LLM's
// normalized value1/value2 — keeps the math independent of LLM output.

const STRONG_HEDGES = [
  "i think",
  "might",
  "probably",
  "i believe",
  "i guess",
  "not sure",
  "i don't remember",
];
const NUMERIC_QUALIFIERS = [
  "maybe",
  "around",
  "roughly",
  "about",
  "or so",
  "sort of",
  "kind of",
];
const HEDGE_WORDS = [...STRONG_HEDGES, ...NUMERIC_QUALIFIERS];

function countHedges(text = "") {
  const lower = text.toLowerCase();
  return HEDGE_WORDS.filter((h) => lower.includes(h)).length;
}

// Only hedges that cast doubt on the whole claim (not just a number)
// count here — "around 7" shouldn't weaken a home-vs-out contradiction.
function countStrongHedges(text = "") {
  const lower = text.toLowerCase();
  return STRONG_HEDGES.filter((h) => lower.includes(h)).length;
}

// Parses loose time expressions into minutes-since-midnight.
// Handles "10", "10:30", "midnight", "noon", "7pm", etc.
function parseTimeToMinutes(text = "") {
  const lower = text.toLowerCase();
  if (lower.includes("midnight")) return 24 * 60;
  if (lower.includes("noon")) return 12 * 60;

  const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const min = match[2] ? parseInt(match[2], 10) : 0;
  const meridian = match[3];

  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  // Only apply the "assume evening" heuristic to bare hours like "10" —
  // never to something already in 24h form (hour > 12) or explicit am/pm.
  if (!meridian && hour >= 1 && hour <= 11) hour += 12;

  return hour * 60 + min;
}

function classifyTemporal(candidate) {
  // Parse the witness's own words, not the LLM's normalized guess —
  // keeps classification independent of LLM output, per the hard rule.
  const t1 = parseTimeToMinutes(candidate.claim1);
  const t2 = parseTimeToMinutes(candidate.claim2);
  if (t1 == null || t2 == null) return classifyOther(candidate);

  const deltaMin = Math.abs(t1 - t2);
  const hedges = countHedges(candidate.claim1) + countHedges(candidate.claim2);

  if (deltaMin <= 20) {
    return {
      type: "FALSE_POSITIVE",
      confidence: clamp(0.9 - deltaMin / 40, 0.5, 0.95),
      reasoning: `Times differ by only ${deltaMin} min — within normal recall imprecision.`,
    };
  }
  if (deltaMin <= 150 && hedges > 0) {
    return {
      type: "INFERENTIAL",
      confidence: clamp(0.5 + deltaMin / 300, 0.5, 0.85),
      reasoning: `${deltaMin} min gap, both statements hedged ("${candidate.claim1}" / "${candidate.claim2}") — individually plausible, conflict only emerges when combined.`,
    };
  }
  return {
    type: "DIRECT",
    confidence: clamp(0.6 + deltaMin / 180, 0.6, 0.97),
    reasoning:
      hedges > 0
        ? `Times differ by ${deltaMin} min — gap too large to be explained by hedging alone.`
        : `Times differ by ${deltaMin} min with no hedging — direct factual conflict.`,
  };
}

function classifyBoolean(candidate) {
  const v1 = candidate.value1?.toLowerCase();
  const v2 = candidate.value2?.toLowerCase();
  const hedges1 = countHedges(candidate.claim1);
  const hedges2 = countHedges(candidate.claim2);
  const sameValue = v1 === v2;

  if (sameValue) {
    return {
      type: "FALSE_POSITIVE",
      confidence: 0.7,
      reasoning: "Both statements resolve to the same underlying fact.",
    };
  }
  if (hedges1 + hedges2 === 0) {
    return {
      type: "DIRECT",
      confidence: 0.9,
      reasoning: `Flat, unhedged opposite answers ("${candidate.value1}" vs "${candidate.value2}").`,
    };
  }
  return {
    type: "INFERENTIAL",
    confidence: clamp(0.55 + (hedges1 + hedges2) * 0.05, 0.55, 0.8),
    reasoning: `Answers point opposite ways but are qualified/hedged — requires inference, not a flat denial.`,
  };
}

function classifyNumeric(candidate) {
  const n1 = parseFloat(String(candidate.value1).replace(/[^\d.]/g, ""));
  const n2 = parseFloat(String(candidate.value2).replace(/[^\d.]/g, ""));
  if (isNaN(n1) || isNaN(n2)) return classifyOther(candidate);

  const delta = Math.abs(n1 - n2);
  const relDelta = delta / Math.max(n1, n2, 1);

  if (relDelta <= 0.1) {
    return {
      type: "FALSE_POSITIVE",
      confidence: clamp(0.9 - relDelta, 0.6, 0.95),
      reasoning: `Values differ by only ${delta} — imprecision, not contradiction.`,
    };
  }
  return {
    type: "DIRECT",
    confidence: clamp(0.6 + relDelta, 0.6, 0.95),
    reasoning: `Values differ materially (${candidate.value1} vs ${candidate.value2}).`,
  };
}

function classifyOther(candidate) {
  // Only STRONG hedges (doubt on the whole claim) weaken classification here.
  // Weak numeric qualifiers like "around 7" shouldn't soften a clean
  // home-vs-went-out contradiction.
  const hedges =
    countStrongHedges(candidate.claim1) + countStrongHedges(candidate.claim2);
  if (hedges >= 2) {
    return {
      type: "INFERENTIAL",
      confidence: 0.55,
      reasoning:
        "Both statements hedged — conflict only emerges when combined.",
    };
  }
  if (hedges === 0) {
    return {
      type: "DIRECT",
      confidence: 0.65,
      reasoning: "Unhedged statements pointing in different directions.",
    };
  }
  return {
    type: "FALSE_POSITIVE",
    confidence: 0.5,
    reasoning: "Insufficient signal to treat as a real contradiction.",
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function classify(candidate) {
  switch (candidate.category_hint) {
    case "temporal":
      return classifyTemporal(candidate);
    case "boolean":
      return classifyBoolean(candidate);
    case "numeric":
      return classifyNumeric(candidate);
    default:
      return classifyOther(candidate);
  }
}

module.exports = { classify };
