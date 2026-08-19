# Pushing this to GitHub

The brief asks for a GitHub repo link. From the unzipped project folder:

```bash
git init
git add .
git commit -m "MoKnowledge: website scraper to structured knowledge base"

# Create the repo and push in one step (GitHub CLI):
gh repo create moknowledge --public --source=. --push

# Or, if you made the repo in the browser first:
git branch -M main
git remote add origin https://github.com/<you>/moknowledge.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `.next/` and `.data/` (the local
store — runtime state, not source), so `git add .` is safe.

## Before you push

- [ ] `npm install && npm run build` — the build has never run; see the README.
- [ ] `npm run smoke` — should report all checks passing.
- [ ] Take the six screenshots listed in `screenshots/README.md` and commit them,
      or delete that file and drop the "Screenshots" bullet from the README.
- [ ] Skim `docs/questions.md` — the five answers are written in the first
      person and should sound like you before a reviewer reads them.
- [ ] Decide whether to keep `PUSHING.md` in the repo. It's for you, not the
      reviewer; deleting it before the first commit is reasonable.

## What the reviewer will look for, and where it is

| Brief requirement | Where |
|---|---|
| Complete source, organised | `src/` — see the layout table in the README |
| README: what it does, setup, features, approach, schema, prompts, limitations | `README.md` |
| Screenshots | `screenshots/` — **not captured yet** |
| JSON output, ≥1 complete example | `examples/example-knowledge-base.json` |
| Answers to the 5 required questions | `docs/questions.md` |
| 2–3 example prompts | `prompts/` (three, plus a README on the shared template) |
| Data-quality thinking | `docs/data-quality.md` |
| Knowledge-enrichment ideas | `docs/knowledge-enrichment-ideas.md` |
| Database schema design | `src/lib/db/schema.sql` + `docs/database-schema.md` |
| Bonus: Supabase structure, RLS, multi-company, versioning | `docs/database-schema.md` |
