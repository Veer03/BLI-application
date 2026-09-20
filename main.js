import { useState } from "react";

// Two depositions from the same witness, 6 months apart
const TRANSCRIPT_1 = `
Deposition of Marcus Webb — March 14, 2023

Q: Where were you on the evening of November 3rd?
A: I was at home all evening. I ordered pizza around 7pm and watched TV.

Q: Did you speak to anyone that night?
A: No, I was alone. My wife was visiting her sister in Portland.

Q: What time did you go to sleep?
A: Around 10, maybe 10:30. I had work the next morning.

Q: Have you ever been to the Hargrove Street warehouse?
A: No, never. I don't even know where that is.

Q: Do you own a grey Honda Civic?
A: I did at the time, yes. I sold it in January.

Q: Had you met Daniel Cho before November 3rd?
A: No. I'd never heard of him before this whole thing started.
`;

const TRANSCRIPT_2 = `
Deposition of Marcus Webb — September 9, 2023

Q: Walk me through the evening of November 3rd again.
A: I was home. I think I went out briefly to get some groceries, maybe around 7:30, but came right back.

Q: You mentioned last time you ordered pizza. Now you're saying groceries?
A: I might have done both. I don't remember exactly, it was almost a year ago.

Q: Did anyone see you that evening?
A: My neighbor, Tom, might have seen me. We waved or something in the parking lot.

Q: What time did you go to sleep?
A: It was late. Midnight maybe. I had trouble sleeping.

Q: Had you ever visited the Hargrove Street area?
A: I mean, I've driven through that part of town. I didn't say I'd never been in that general area.

Q: And Daniel Cho — did you know him?
A: I knew of him. We had mutual friends. I don't think I'd met him face to face.
`;

export default function DepositionChecker() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Find contradictions between these two depositions from the same witness. 
            
Transcript 1: ${TRANSCRIPT_1}

Transcript 2: ${TRANSCRIPT_2}

Return a JSON array of contradictions like: [{claim1, claim2, type, severity}]
Types: DIRECT, INFERENTIAL, or FALSE_POSITIVE
Severity: HIGH, MEDIUM, LOW`,
            },
          ],
        }),
      });

      const data = await res.json();
      const text = data.content[0].text;
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setResults(parsed);
    } catch (e) {
      setError("Failed: " + e.message);
    }

    setLoading(false);
  }

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 900,
        margin: "0 auto",
        fontFamily: "sans-serif",
      }}
    >
      <h1>⚖️ Deposition Contradiction Detector</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h3>Transcript — March 2023</h3>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {TRANSCRIPT_1}
          </pre>
        </div>
        <div>
          <h3>Transcript — September 2023</h3>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {TRANSCRIPT_2}
          </pre>
        </div>
      </div>

      <button
        onClick={analyze}
        disabled={loading}
        style={{
          padding: "12px 32px",
          fontSize: 16,
          background: "#1a1a2e",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {loading ? "Analyzing..." : "Find Contradictions"}
      </button>

      {error && <p style={{ color: "red", marginTop: 16 }}>{error}</p>}

      {results && (
        <div style={{ marginTop: 24 }}>
          <h2>Results ({results.length} found)</h2>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                marginBottom: 12,
                borderLeft: `4px solid ${r.type === "DIRECT" ? "#ef4444" : r.type === "INFERENTIAL" ? "#f59e0b" : "#9ca3af"}`,
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    background:
                      r.type === "DIRECT"
                        ? "#fee2e2"
                        : r.type === "INFERENTIAL"
                          ? "#fef3c7"
                          : "#f3f4f6",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  {r.type}
                </span>
                <span style={{ fontSize: 12, color: "#666" }}>
                  Severity: {r.severity}
                </span>
              </div>
              <div style={{ fontSize: 14 }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>March:</strong> "{r.claim1}"
                </div>
                <div>
                  <strong>September:</strong> "{r.claim2}"
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
