# StratoSort Core User Guide

This guide explains how to use StratoSort Core day-to-day, including Smart Folders, Knowledge OS,
and key settings.

For installation help, use [INSTALL_GUIDE.md](./INSTALL_GUIDE.md).  
For beta testing and bug reporting, use [BETA_TESTER_GUIDE.md](./BETA_TESTER_GUIDE.md).

---

## 1) What StratoSort Does

StratoSort uses local AI to:

- Analyze your files by content (not just filename)
- Suggest where files belong
- Rename files using your naming rules
- Help you search by meaning using Knowledge OS
- Visualize relationships in the Knowledge Graph

Everything runs locally after model download.

---

## 2) Typical Workflow

StratoSort is organized into phases:

1. **Welcome** - Start and choose your flow.
2. **Setup** - Configure Smart Folders (trusted destinations).
3. **Discover** - Analyze files and review suggestions.
4. **Organize** - Approve and apply moves/renames.
5. **Complete** - Review results and finish.

---

## 3) Smart Folders (Most Important First Setup)

Smart Folders are destination folders that the AI routes files into.

### Best practices

- Create folders around real outcomes (for example: `Invoices`, `Receipts`, `Screenshots`,
  `Contracts`).
- Keep descriptions specific and plain language.
- Start with fewer, clearer folders before adding many overlapping categories.

### Good folder description examples

- **Invoices:** "Bills from vendors and monthly service invoices."
- **Tax Documents:** "W-2, 1099, tax forms, receipts needed for filing."
- **Project Specs:** "Requirements, architecture docs, and project briefs."

---

## 4) Naming Conventions

Open **Settings -> Default Locations -> File naming defaults**.

You can control:

- **Convention**
  - `subject-date`
  - `date-subject`
  - `project-subject-date`
  - `category-subject`
  - `keep-original`
- **Date Format**
  - `YYYY-MM-DD`
  - `MM-DD-YYYY`
  - `DD-MM-YYYY`
  - `YYYYMMDD`
- **Case**
  - `kebab-case`, `snake_case`, `camelCase`, `PascalCase`, `lowercase`, `UPPERCASE`
- **Separator**
  - Use safe separators like `-` or `_`

Tip: If you need maximum compatibility across apps and systems, prefer `kebab-case` plus
`YYYY-MM-DD`.

---

## 5) Knowledge OS Search and Knowledge Graph

Open search and use natural language queries like:

- "Show invoices from last quarter"
- "Find screenshots related to onboarding"
- "Documents about pricing changes"

### Knowledge OS tips

- Be specific in your query (topic + time period + file type).
- If results are weak, rephrase with clearer intent.
- If semantic results seem empty, check embedding/model health in Settings.

### Knowledge Graph tips

- Use graph view to inspect relationships between files.
- Great for finding clusters, duplicates, and concept neighborhoods.
- Use it as an exploration tool, then open/reveal files directly.

---

## 6) Settings Walkthrough

Open **Settings** and focus on these sections:

### AI Configuration

- **Local AI Engine**: check model and GPU status.
- **Default AI models**: set text, vision, and embedding models.
- **Embedding behavior / rebuild**: rebuild index when embedding model changes.

### Performance

- **Auto-organize**: enable automatic routing from downloads.
- **Confidence threshold**: adjust how strict automation is.
- **Graph retrieval**: tune graph expansion and contextual chunk settings.

### Default Locations

- Set where Smart Folders are created by default.
- Configure file naming defaults.

### Application

- Notification behavior
- Backups/import/export settings
- Analysis history access

---

## 7) Recommended Starter Configuration

If you want a safe default profile:

- Enable **Auto-organize**
- Keep confidence around **75-85%**
- Start with **Smart folder routing: Auto**
- Use naming convention `subject-date`
- Use date format `YYYY-MM-DD`
- Keep separators simple (`-`)

Then run a small batch first and review outcomes before scaling up.

---

## 8) Daily Usage Pattern

1. Drop or collect files in your intake location (for example Downloads).
2. Run Discover/analysis.
3. Review suggested destinations and names.
4. Approve organize actions.
5. Use Knowledge OS search to find and validate file placement.
6. Use Undo/Redo when needed.

---

## 9) Troubleshooting Quick Fixes

### Search is weak or empty

- Check **Settings -> AI Configuration** for model status.
- Confirm embeddings exist and rebuild if needed.
- Retry with a more specific query.

### Auto-organize feels too risky

- Increase confidence threshold.
- Keep Smart Folders tightly defined.
- Start with manual review before fully trusting automation.

### File names are not what you expect

- Review naming defaults in Settings.
- Confirm convention/date/case/separator values.

---

## 10) Reporting Problems

Use the beta guide for full reporting instructions: [BETA_TESTER_GUIDE.md](./BETA_TESTER_GUIDE.md)

Direct bug form:
[Open a bug report](https://github.com/iLevyTate/StratoSortCore/issues/new?template=bug_report.md)
