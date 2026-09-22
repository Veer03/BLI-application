# Deposition Contradiction Detector

This app compares two depositions from the same witness and finds contradictions between them.

It does not treat every contradiction the same way. It splits them into three types:

- DIRECT: a clean, flat conflict. Example: "I was home all night" vs "I stepped out"
- INFERENTIAL: both statements sound fine on their own, but together they do not add up. Example: "asleep by 10" vs "up until midnight"
- FALSE_POSITIVE: not a real contradiction, just normal human imprecision. Example: "around 8" vs "8:05"

The confidence score and the type are decided by code in this project, not by the LLM. The LLM only extracts the claims from the transcripts. It never decides if something is a contradiction or how confident we should be. That logic lives in `backend/classifier.js`.

## How to run it

You need Node.js installed, and one API key: either an Anthropic key or a Groq key.

Get a Groq key here (free): https://console.groq.com/keys
Get an Anthropic key here: https://console.anthropic.com/settings/keys

Steps:

```bash
git clone https://github.com/Veer03/BLI-application.git
cd BLI-application
npm install
cd client
npm install
cd ..
```

Now create a file at `backend/.env` and add one of these two keys:
ANTHROPIC_API_KEY=your_key_here
or
GROQ_API_KEY=your_key_here

If both are set, the app uses Anthropic first.

Then run:

```bash
npm start
```

This starts the backend and the frontend together. Open `http://localhost:5173` in your browser and click "Find Contradictions."

## How it works

1. The backend sends both transcripts to the LLM with a strict prompt. The prompt tells it to go through every question in Transcript 1, find the matching question in Transcript 2, and return the exact quotes. It is not allowed to judge or summarize.
2. The backend code then looks at those quote pairs on its own and decides the type and confidence. It does this with its own rules, for example:
   - Time claims get parsed into minutes and compared by how big the gap is
   - Yes or no claims get checked for words like "yes," "no," "never," "might," and so on, directly from the actual quote, not from anything the LLM labeled
   - Words like "maybe" or "around" are treated differently depending on whether they are casting doubt on the whole statement or just softening a number
3. If two extracted claims are actually the same one twice, they get removed before scoring. If a topic in Transcript 1 has no matching question in Transcript 2, it gets left out instead of forcing a false comparison.

## Bugs found while building this

- The first model name used did not exist on the account being tested with. Fixed by switching models.
- Early on, the classifier was reading the LLM's own reworded version of a claim instead of the witness's actual words. This let the LLM quietly influence a score that was supposed to be independent. Fixed by having the classifier read the real quotes directly.
- "Midnight" was not being converted to a time correctly, so a two hour gap was being calculated as a twenty two hour gap.
- A two hour gap with hedging language like "maybe" and "around" was being marked as a flat DIRECT contradiction instead of INFERENTIAL, even though this matches the exact example given in the assessment email.
- The word "around" in a sentence like "around 7pm" was weakening the whole claim's confidence, even when it had nothing to do with the actual contradiction. This caused a real contradiction to get marked as a false positive.
- The same yes or no logic issue also existed for boolean questions. Fixed the same way, by reading the real quote instead of trusting the LLM's label.
- The first version of the extraction prompt let the LLM decide on its own which topics were worth reporting. This caused it to sometimes skip a topic or report the same one twice. Fixed by rewriting the prompt to require going through every question in order, and by adding code that removes exact duplicates.

## Stack

Frontend: React with Vite
Backend: Node.js with Express
LLM: Anthropic Claude or Groq, whichever key is set
