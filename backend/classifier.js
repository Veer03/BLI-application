// classifier.js
// Takes LLM-extracted candidate facts and independently decides
// type + confidence. The LLM never sees or influences these numbers.

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

function countStrongHedges(text = "") {
  const lower = text.toLowerCase();
  return STRONG_HEDGES.filter((h) => lower.includes(h)).length;
}

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
  if (!meridian && hour >= 1 && hour <= 11) hour += 12;

  return hour * 60 + min;
}

function classifyTemporal(candidate) {
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

function detectBooleanSignal(text = "") {
  const lower = " " + text.toLowerCase().trim() + " ";

  if (
    /didn't say (i'd|i had|i) never|not saying (i'd|i had|i) never/.test(lower)
  ) {
    return "yes";
  }

  const firstWord = lower.trim().split(/\s+/)[0]?.replace(/[.,]/g, "");
  if (firstWord === "no") return "no";
  if (firstWord === "yes") return "yes";

  if (/\bmight\b|\bcould\b|\bpossibly\b|\bperhaps\b/.test(lower))
    return "hedged";

  if (
    /\bi (knew|did|had|owned|have|was)\b/.test(lower) ||
    /\bi've\b.*\b(driven|been|visited|seen)\b/.test(lower)
  ) {
    return "yes";
  }
  if (
    /\bnever\b|\bdon't\b|\bdoesn't\b|\bdidn't\b|\bnot\b|\bno idea\b/.test(lower)
  ) {
    return "no";
  }

  return "unknown";
}

function classifyBoolean(candidate) {
  const v1 = detectBooleanSignal(candidate.claim1);
  const v2 = detectBooleanSignal(candidate.claim2);

  if (v1 === "unknown" || v2 === "unknown") {
    return classifyOther(candidate);
  }

  if (v1 === v2) {
    return {
      type: "FALSE_POSITIVE",
      confidence: 0.7,
      reasoning: "Both statements resolve to the same underlying fact.",
    };
  }

  if (v1 === "hedged" || v2 === "hedged") {
    return {
      type: "INFERENTIAL",
      confidence: 0.65,
      reasoning: `One answer is uncertain/hedged ("${candidate.claim1}" / "${candidate.claim2}") — a possible conflict, not a flat denial.`,
    };
  }

  return {
    type: "DIRECT",
    confidence: 0.9,
    reasoning: `Flat, unhedged opposite answers ("${candidate.claim1}" vs "${candidate.claim2}").`,
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
