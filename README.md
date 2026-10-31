# University Timetable — Sprint 3

Python/FastAPI, SQLAlchemy and SQLite, with HTML/CSS/JavaScript pages.

## Run the local presentation demo

From this project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python run_demo.py
```

If the environment already exists, start at `source .venv/bin/activate`.
Open http://127.0.0.1:8000 and log in with the local sample account:
`admin@sdu.edu.kz` / `Admin123!`. Stop the server with Control+C.
If port 8000 is occupied, use `python run_demo.py --port 8001`.

The demo uses **database.sprint3.db**, initialized from the current seed/CSV data
on first run. It never migrates, clears or overwrites the older `database.db`.
Choose database.sprint3.db in your SQLite viewer when presenting this demo.
Do not commit real database files or use the sample credentials for deployment.

`python run_demo.py --prepare-only` creates the demo database without starting
the server. The runner intentionally does not enable auto-reload: restart after
editing Python files. Sessions expire after 24 hours; with no SECRET_KEY
environment variable configured, restarting the server requires signing in again.

For an independently configured database, set `DATABASE_URL` before running
`python init_db.py` and `python -m uvicorn app:app --reload`. `create_all` creates
missing tables; it does **not** migrate columns in existing tables. Do not run
the latest application against an older schema expecting it to migrate itself.

## Sprint 3 walkthrough (US12–US16)

1. Prepare Data → Run Validation. Review errors and warnings.
2. AI Generator → choose AI-assisted (requires API key) or Algorithm only → Generate Draft. Review coverage, failures, execution log, score and generation method.
3. Explain automatic room assignment using the generated course/type/room/group rows.
4. Schedule Grid → Re-scan Conflicts. Review Active Conflicts.
5. Return to Optimization Score to explain the weighted preference penalties.

Coverage is the percentage of required sessions that were placed. The score is
a **soft-preference score**, not a combined proof of coverage and hard-constraint
satisfaction. The conflict report is separate. Generation runs preflight checks
and scans the candidate before committing it. Failed validation, an entirely
failed generation, or a failed database write preserves the previous timetable.
A partial generation can replace the active semester's draft: inspect its coverage.
Other semesters' schedules are retained.

The construction engine is a greedy rule-based heuristic. AI-assisted mode calls
a pretrained OpenAI model to select a validated candidate using administrator
preferences. It is not a model trained by this team or an exact optimizer.
See [AI setup instructions](AI_SETUP.md) to configure the server key and verify
a real API call. Algorithm only explicitly records that no model was used. Elective-to-elective student overlaps are explicitly allowed by the
current business rule; teacher and room overlaps are still prohibited. Confirm
this rule with the team before treating the draft as ready for publication.

The CSV sample has no submitted availability matrices. Prepare Data reports this
as a warning: unspecified availability is treated as neutral. Do not claim that
the sample schedule incorporates preferences that no teacher has submitted.

## Review fixes

- Atomic schedule replacement and rollback on failure; no deletion before generation.
- Subgroup booking checks preserve independent subgroup availability and account
  for all configured subgroups; subgroup seat counts round up.
- Active time slots come from the database without silently invented fallback slots.
  Overlapping active periods are rejected, and scans compare actual intervals.
- Capacity, room type, equipment and teacher qualifications are errors. Scans also
  check daily load, missing references, inactive periods, and lunch breaks.
- Generation, dashboard and score preview use one scoring implementation.
- Invalid availability shapes, malformed stored configuration, invalid semester
  terms, missing references, long passwords and malformed tokens have controlled
  responses. Foreign keys prevent deleting resources still used by a timetable.
- Database conflicts/unavailability return JSON errors; browser requests display
  network/server errors and redirect expired sessions to login.
- The JWT secret is read from the environment, with a random per-process fallback,
  replacing the published constant. Personal dashboard class lists are scoped to
  the user's teacher profile or student group.
- The old destructive CSV importer is replaced by the current idempotent seed
  workflow. It inserts missing records; it does not refresh existing CSV records.

## Regression checks

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node --check static/app.js
node --test tests/frontend.test.cjs
git diff --check
```

Tests use temporary databases. They cover the Sprint 3 success path, validation,
authentication and role errors, conflict types, subgroup scheduling, consistent
scores, foreign-key protection, and preservation of a previous schedule after
generation and write failures. Node is only needed for the JavaScript checks.
The frontend checks also cover offline/non-JSON errors, expired sessions, text
escaping and the availability initializer accidentally running on the schedule page.

This is a focused functional review of the local Sprint 3 demo. Later-sprint
publishing, export and personal timetable features are outside these checks.

AI regression tests cover missing keys, mocked selection/provenance, provider errors,
invalid/refused responses, coverage guards and input edits during generation.
They do not verify live model access or billing; that requires a configured key.

Teacher qualifications accept the current course-code format and the legacy
course-name format, so existing demo databases remain usable after an update.
