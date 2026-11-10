# /wiki-ingest [path]

Deliberate, focused update of the wiki based on a specific file, directory, feature, or topic.
1. Resolve wiki root and read `<wiki-root>/SCHEMA.md`.
2. Read the target source files, related tests, and config.
3. Create or update affected topic/module pages with required frontmatter (`type`, `title`, `description`, `status`, `generated`, `sources`, `source_commit`, `confidence`).
4. Update `index.md`, `project/work-tracker.md`, `agent/handoff.md`, and append an `agent` entry to `log.md`.
5. Never modify repository source files.
