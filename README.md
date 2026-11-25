# AI Answer Check


A small intelligent interactive system for **selective reliance on AI answers**. A student asks about
coursework rules; GPT answers and splits the answer into date, number and percentage claims; code checks
each claim against a module handbook; the student accepts, revises or defers each claim and can undo.
Report: *AI Answer Check: Supporting Selective Reliance on AI Answers through Claim-Level Evidence* (IIS Assignment 2).

## Project status

- **Works (implemented):** web interface; GPT answering and claim extraction with schema check and one retry;
  code comparator with four evidence states (supported, conflict, outdated, unresolved); three cue modes (none, verbal,
  visual); accept / revise / defer per claim; one reminder when accepting a conflicting or outdated claim;
  undo; a revised answer that rewrites corrections into the AI's sentence (track changes);
  review summary; feedback memory (earlier decisions recalled on later answers, mismatches flagged);
  reliance pattern across questions; interaction log; evaluation script.
- **Works (implemented): my documents.** Students upload their own briefs, handbooks or notes (.txt, .md,
  .docx, .pdf); GPT extracts their date, number and percentage rules once, and questions can then be
  answered and checked against these documents instead of the demo handbook. A file can be marked as an
  older version, so outdated rules are detected too.
- **Simulated:** the module handbook (fictional, current 2026-27 and superseded 2025-26 editions).
- **Backup:** ten preset answers with known errors, reviewed through the same interface, so the demonstration
  and evaluation still run if the API is unavailable. Without a key their claims come from cached GPT
  extractions or, if none are cached, the hand-labelled claims (the interface says which).
- **Unfinished / planned:** a user study of reliance; comparing the three cue modes; checking text rules
  (not only dates, numbers and percentages), for example with an entailment model.

## Technology stack

| part | technology | what it does |
|---|---|---|
| server | Python 3.9+ standard library (`http.server`, `urllib`, `json`) | serves the interface, calls the API, writes logs |
| AI model | OpenAI Chat Completions, default `gpt-4o-mini`, JSON output mode | answers from the handbook; splits answers into claims |
| checking | Python (`checker.py`) | normalises values and decides each claim's status; the model never decides |
| interface | HTML, CSS, plain JavaScript | claim cards, cue modes, decisions, reviewed answer |
| storage | Python `sqlite3` (standard library) | uploaded documents' passages, extracted facts and review history in `data/kb.sqlite` |
| PDF reading | `pypdf` (optional, `pip install pypdf`) | only needed to upload PDF files; .txt, .md and .docx need nothing |
| screenshots | Playwright with Chrome | storyboard images for the report (not needed to run the app) |

Undecided: the final model (a larger model may extract more accurately; to be decided from `eval.py`
results), and how to check text rules.

## Run it

No packages to install.

    python app.py --port 8765

Open [AI Answer Check](http://127.0.0.1:8765/) in your browser. If you start the app with a different port, use the address printed in the terminal.

The main path uses GPT live. Without an API key only the ten preset answers work. To use GPT live, a reviewer supplies their
**own** key as an environment variable. No key is stored in this repository; `.env` is git-ignored.

    # macOS / Linux
    export OPENAI_API_KEY="your-own-key"
    export OPENAI_MODEL="gpt-4o-mini"      # optional
    python app.py --port 8765

    # Windows PowerShell
    $env:OPENAI_API_KEY="your-own-key"
    python app.py --port 8765

With a key, "Ask your own" works and preset answers are also split into claims by GPT (cached in `cache/`).
Under **My documents** on the left, upload a brief or notes, then choose "My documents" before asking.
Click **Preview** next to an uploaded file to read its text in a pop-up.
Fact extraction needs the API key once; after that, checking against those documents works offline.
Add `?mode=none`, `?mode=verbal` or `?mode=visual` to the URL to fix the cue mode.

### Evaluate

    python eval.py             # Part A runs offline; Parts B-C need OPENAI_API_KEY
    python eval.py --runs 3

Results: `results/eval_report.md` and `results/eval_results.json`.

## How it works

| step | file | what |
|---|---|---|
| answer | `pipeline.py` | GPT answers from the handbook (live); preset answers are a backup |
| split | `pipeline.py` | GPT returns claims as JSON (subject, attribute, type, value); schema-checked, one retry |
| check | `checker.py` | values are normalised and compared with handbook facts |
| show | `static/app.js` | claim cards with the AI value beside the quoted handbook sentence |
| decide | `static/app.js` | accept, revise or defer; reminder; undo; review summary |
| revise | `static/app.js` | revised answer: corrections written into the AI's sentence, unconfirmed parts marked |
| remember | `static/app.js` | decisions kept in the browser (`localStorage`); recalled on later answers about the same fact; reliance pattern; "Clear my review history" resets it |
| log | `app.py` | every action is appended to `logs/interaction_log.jsonl` |
| my documents | `kb.py` | upload, split into passages (keeping page and heading), GPT fact extraction, storage in SQLite |

| file | contents |
|---|---|
| `data/handbook.json` | fictional handbook passages and their facts |
| `data/scenarios.json` | 10 questions, preset answers, 28 labelled claims (13 supported, 7 conflict, 4 outdated, 4 unresolved, stored as `missing`) |
| `data/uploads/`, `data/kb.sqlite` | created when you upload; your own files, passages, facts and review history. Git-ignored, never committed |
| `screenshots/` | system diagram, storyboards and cue-mode screenshots used in the report |

## Development record


| stage | change | why | what I checked |
|---|---|---|---|
| A2 concept | One confidence score per answer, rejected | Follow A1's verbal vs visual cue question | A single score cannot say where an error is, so I moved to claims |
| A2 concept | Check an existing answer instead of retrieving documents to generate a new one | Retrieval still leaves one answer to trust or reject | Each claim gets its own evidence, state and decision |
| A2 concept | Claim-level checking + accept / revise / defer + evidence-dependent reminder | A1: appropriate reliance means accepting correct and rejecting incorrect parts | Unresolved and outdated states keep a real judgement for the student |
| v1 data | Own fictional handbook and 10 preset answers; comparator | Only dates, numbers and percentages, so comparison is mechanical | Comparator gives 28/28 labelled claims the right status |
| v1 interface | Claim cards, cue modes, reminder, reviewed answer, undo, log | Five design principles in the report | First conflict message said "I said 1,800" and lost the unit; messages now quote the claim's own words |
| v2 | GPT extraction with schema check, retry and cache; `eval.py` | GPT proposes, code decides | Live run (gpt-4o-mini, 3 runs): recall 99%, precision 98%, state accuracy 83/84; one run missed the unresolved pass-mark claim. See `results/eval_report.md` |
| v3 | Review summary after the last decision; "missing" shown as "Unresolved"; preset answers relabelled as a backup | Review feedback: students needed to know what to do after deciding | Summary lists deferred and unbacked claims with the section or person to check |
| v4 | Revised answer below the claims; feedback memory and reliance pattern | Review feedback: the result should be easier to see, and the student's feedback should be used again | Rewrites checked on all 10 preset answers; a later answer recalls the earlier decision and flags a mismatch |
| v5 | My documents: upload, passages with page and heading, GPT fact extraction stored in SQLite; review history also saved there | Students' real rules live in their own briefs, not in a demo handbook | Tested with a .docx brief and an older .txt version: supported, conflict, outdated and unresolved claims all detected; uploads work offline after extraction |

## AI assistance

- **Claude (Anthropic)**: I asked it to help plan the system from my A1 argument, write and debug the Python
  and JavaScript, produce the diagram and storyboard screenshots.
  I chose the direction (claim-level checking and selective reliance), reviewed each draft and asked for
  changes (for example, a summary after the last decision and plainer report prose); I checked the comparator against my own labels (28/28), ran the app through each scenario,
  and edited the report so every claim and reference matches what the system does.
- **GPT (OpenAI API)**: a component of the system, not a writing tool. Its claim extraction is measured
  by `eval.py` rather than trusted.

## Additional files

None are needed: everything is in this repository. `screenshots/` holds the report figures.
