require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { classify } = require("./classifier");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const EXTRACTION_PROMPT = (
  t1,
  t2,
) => `You are a fact-extraction engine for legal deposition review. Your ONLY job is extracting comparable claim pairs. You must NOT judge whether they contradict, and you must NOT invent, paraphrase, or infer facts not present in the text.

TASK: Transcript 1 contains a series of Q&A pairs. Walk through Transcript 1 IN ORDER, one question at a time. For EVERY question in Transcript 1, with no exceptions, including ones about property, vehicles, timing, relationships, or minor-seeming details, find the corresponding question and answer in Transcript 2. It may be worded differently but must cover the same underlying subject. Produce exactly one output entry per question in Transcript 1.

If Transcript 2 truly has no corresponding question for a given Transcript 1 topic, still include the entry, with:
  "claim2": "",
  "value2": "no_matching_answer"

RULES:
- Quote claim1 and claim2 VERBATIM from the transcripts. Never summarize or reword.
- Never emit the same topic twice.
- Never skip a question because it seems unimportant. Completeness is required.
- category_hint must be one of: "temporal" (times/dates), "boolean" (yes/no or presence/absence), "numeric" (counts/quantities), "identity" (whether a person/place is known), "other".

OUTPUT FORMAT: a single JSON array, nothing else. No prose, no markdown fences, no commentary before or after.

EXAMPLE (illustrative only, not part of your input):
Transcript 1 excerpt: "Q: Did you own a car? A: Yes, a red Toyota."
Transcript 2 excerpt: "Q: Any vehicles? A: I had a red Toyota at the time."
Correct output entry:
{
  "topic": "car_ownership",
  "claim1": "Yes, a red Toyota.",
  "claim2": "I had a red Toyota at the time.",
  "category_hint": "boolean",
  "value1": "yes",
  "value2": "yes"
}

Now extract from these transcripts:

Transcript 1:
${t1}

Transcript 2:
${t2}`;

// Calls Anthropic if a key is set, otherwise falls back to Groq.
// Lets anyone running this app use whichever provider they already have a key for.
async function callLLM(prompt) {
  if (ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`);
    const data = await res.json();
    return data.content[0].text;
  }

  if (GROQ_API_KEY) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Groq API error: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  throw new Error(
    "No API key found. Set ANTHROPIC_API_KEY or GROQ_API_KEY in backend/.env",
  );
}

// Extracts a JSON array even if the model wraps it in prose or an object.
function extractJsonArray(raw) {
  let cleaned = raw.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const arrKey = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
      if (arrKey) return parsed[arrKey];
    }
  } catch (_) {
    // fall through to bracket extraction below
  }

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found in model output");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

app.post("/api/analyze", async (req, res) => {
  const { transcript1, transcript2 } = req.body;
  if (!transcript1 || !transcript2) {
    return res
      .status(400)
      .json({ error: "transcript1 and transcript2 are required" });
  }

  try {
    const raw = await callLLM(EXTRACTION_PROMPT(transcript1, transcript2));
    console.log("RAW LLM OUTPUT:\n", raw);

    let candidates;
    try {
      candidates = extractJsonArray(raw);
    } catch (parseErr) {
      console.error("RAW LLM OUTPUT THAT FAILED TO PARSE:\n", raw);
      return res
        .status(502)
        .json({
          error: `Failed to parse model output as JSON: ${parseErr.message}`,
        });
    }

    // Dedupe on actual claim content, not the LLM's topic label.
    // Two entries can describe the same fact with different labels.
    const seen = new Set();
    candidates = candidates.filter((c) => {
      const key = `${(c.claim1 || "").toLowerCase().trim()}|${(c.claim2 || "").toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Drop entries where extraction found no corresponding answer.
    // There is nothing to compare, so classifying them would be noise.
    candidates = candidates.filter((c) => c.value2 !== "no_matching_answer");

    // Independent classification. This is our code, not the LLM's.
    const results = candidates.map((c) => {
      const verdict = classify(c);
      return {
        topic: c.topic,
        claim1: c.claim1,
        claim2: c.claim2,
        type: verdict.type,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
      };
    });

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
