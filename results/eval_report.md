# Offline evaluation

Live run on the author's machine, 25 Nov 2026 (`python eval.py`, gpt-4o-mini, 3 runs per preset answer).

## A. Comparator on hand-labelled claims

28 of 28 claims received the labelled status.

| label \ system | supported | conflict | outdated | unresolved |
|---|---|---|---|---|
| supported | 13 | 0 | 0 | 0 |
| conflict | 0 | 7 | 0 | 0 |
| outdated | 0 | 0 | 4 | 0 |
| unresolved | 0 | 0 | 0 | 4 |

## B. GPT extraction + comparator (gpt-4o-mini, 3 runs per scenario)

- Recall (labelled claims extracted with the right subject, attribute and value): 99%
- Precision (extracted claims that match a labelled claim): 98%
- End-to-end status accuracy: 83 / 84 = 99%

| label \ system | supported | conflict | outdated | unresolved | not extracted |
|---|---|---|---|---|---|
| supported | 39 | 0 | 0 | 0 | 0 |
| conflict | 0 | 21 | 0 | 0 | 0 |
| outdated | 0 | 0 | 12 | 0 | 0 |
| unresolved | 0 | 0 | 0 | 11 | 1 |

## C. Reminders on correct claims

0 of 39 supported claims would have triggered the accept reminder by mistake.

### Errors

| scenario | run | claim | label | system |
|---|---|---|---|---|
| s06 | 3 | at least 40% to pass | unresolved | not extracted |
