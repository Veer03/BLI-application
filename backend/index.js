require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { classify } = require("./classifier");

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";
const EXTRACTION_PROMPT = (
  t1,
  t2,
) => `You are extracting FACTS ONLY. Do not judge whether they contradict — that is done by other code.

Compare these two deposition transcripts from the same witness. Find every topic discussed in both where the witness gave an answer.

For each topic, output an object:
{
  "topic": "short label",
  "claim1": "verbatim quote from transcript 1",
  "claim2": "verbatim quote from transcript 2",
  "category_hint": "temporal" | "boolean" | "numeric" | "identity" | "other",
  "value1": "normalized value from claim1 (e.g. a time, yes/no, a number, a name)",
  "value2": "normalized value from claim2"
}

category_hint guide:
- "temporal": times/dates mentioned
- "boolean": yes/no or presence/absence questions
- "numeric": counts or measurable quantities
- "identity": whether a person/place is known or not
- "other": anything else

Return ONLY a JSON array, no prose, no markdown fences.

Transcript 1:
${t1}

Transcript 2:
${t2}`;

app.post("/api/analyze", async (req, res) => {
  const { transcript1, transcript2 } = req.body;
  if (!transcript1 || !transcript2) {
    return res
      .status(400)
      .json({ error: "transcript1 and transcript2 are required" });
  }

  try {
    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 2000,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: EXTRACTION_PROMPT(transcript1, transcript2),
            },
          ],
        }),
      },
    );

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return res.status(502).json({ error: `Groq API error: ${errText}` });
    }

    const data = await groqRes.json();
    const raw = data.choices[0].message.content;

    let candidates;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      candidates = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(502).json({
        error: `Failed to parse model output as JSON: ${parseErr.message}`,
      });
    }

    // Independent classification — this is our code, not the LLM's.
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
