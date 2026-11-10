# /wiki-sync

Fast, surgical wiki update based on small recent changes.
1. Resolve wiki root via `.wikidir` or `wiki/SCHEMA.md`.
2. Check `git status --porcelain` and `git diff --name-only` since latest log or page `source_commit`.
3. Map changed files to wiki pages whose `sources:` list them.
4. Update affected pages, append entry to `log.md`, update `work-tracker.md` and `agent/handoff.md`.
5. Never touch source code outside the wiki.
