# /wiki-lint

Read-only health check for the repository-local wiki.
1. Run `python3 validate-wiki.py <wiki-root>` first for deterministic structural validation.
2. Check Core map, staleness (`source_commit` vs `HEAD`), Git drift, orphans, gaps, evidence, tracker single-status rules, decisions approval rules, handoff freshness (`>= 5` commits), and byte budgets (`20 KB` single page, `60 KB` Core read, `30 KB` log).
3. Produce a read-only `# Wiki Lint Report - YYYY-MM-DD`.
