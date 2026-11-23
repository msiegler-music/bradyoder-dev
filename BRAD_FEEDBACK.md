# Brad's Feedback & Feature Roadmap

This document outlines the architectural specifications, prioritized backlog, and implementation roadmap based on Brad's direct feedback (Nov 2026).

---

## Executive Summary & Guiding Principles

1. **Hierarchy of Truth (The Golden Chart Rule)**:
   - **`LETTERS` (Concert Key)** is always the primary, default chart.
   - **`NUMBERS` (Nashville Number System)** is the secondary chart.
   - **`GTR` / `GUITAR` (Pre-transposed shapes)** is a musician convenience/fallback, never the default when concert letters exist.
   - **`.docx`** is preferred for interactive semantic rendering & real-time transposition; **`.pdf`** is preserved as an authentic print/reference artifact.
2. **"De-Brading" the UI**:
   - Translate internal draft filenames (`compass-LETTERs - no dropped beat in instrumental.docx`) into standardized, professional musical mode toggles:
     `[ Letters (Concert) ]` `[ Numbers ]` `[ Guitar Capo Shapes ]`.
3. **Beyond Albums (Flexible Discovery)**:
   - Brad needs custom groupings (e.g. `obscure`, `fan-favorite`, `live staple`, `in progress`), not just static album tracklists or "everything else".
4. **Frictionless Intake ("Gemini Gateway")**:
   - An intelligent ingestion bridge so Brad can drop in a new `.docx` or raw chart/lyrics and have it automatically parsed, normalized, and deployed into the songbook without manually editing CSVs.

---

## Feature Set 1: Dynamic Tagging & Advanced Discovery (Beyond Albums)

### Problem Statement
Currently, songs are strictly partitioned by `album_id`. Any song not on a commercial album is dumped into `unrecorded` or "everything else." Brad needs thematic categories (e.g. *obscure*, *covers*, *collaborations*, *live staples*, *holiday*, *kids*) and fast search across his catalog.

### Technical Specification
1. **Schema Extension (`songs.csv`)**:
   - Add a `tags` column (comma-delimited string):
     ```csv
     url,title,album_id,track_number,tags,composition_date,tuning_capo,notes
     https://bradyoder.com/songs/compass/,compass (deep down),unrecorded,1,"obscure, fan-favorite, contemplative",...
     ```
2. **UI Enhancements**:
   - **Category / Tag Filter Dropdown**: In the left sidebar header beside Album select:
     - Groupings: *All Songs*, *By Album...*, *By Collection / Tag (e.g. Obscure, Staples)*.
   - **Universal Fast-Search Bar**:
     - Instant client-side search indexing: Title, Lyrics text, Tuning/Capo values, Notes, and Tags.
     - Search query syntax: e.g. `tag:obscure`, `capo:5`, or freeform lyric search (`"deep down"`).
   - **Multi-Category Pills**:
     - Visual badge pills on song detail headers showing active tags with one-click filter activation.

---

## Feature Set 2: Chart Hierarchy & Standardized Mode Toggles ("De-Brading")

### Problem Statement
Chart selection currently defaults to whatever filename is first in `charts.csv` (e.g. *Box of Tears* currently opens to `GUITAR CHORDS` instead of `LETTERS`). Furthermore, version buttons show raw filename suffixes like `GUITAR CHORDS (Eb, C capo 3) (docx)` which clutters mobile and looks unpolished.

### Technical Specification
1. **Deterministic Priority Ranking Engine**:
   - When resolving default chart for any song in `app.js`:
     ```javascript
     function getChartPriorityScore(filename) {
         const name = filename.toUpperCase();
         const isDocx = /\.(docx?|html?)$/i.test(filename);
         const formatScore = isDocx ? 100 : 0; // Prefer interactive DOCX over PDF
         
         if (name.includes("LETTERS") || name.includes("LETTER")) return formatScore + 30;
         if (name.includes("NUMBERS") || name.includes("NUMBER")) return formatScore + 20;
         if (name.includes("GTR") || name.includes("GUITAR"))   return formatScore + 10;
         return formatScore + 5;
     }
     ```
   - Sort `chart_alternates` by score descending so `LETTERS` is **always** index 0 (default).
2. **"De-Braded" Standardized UI Toggles**:
   - Instead of displaying raw filenames, map alternates into clean mode pills:
     - `LETTERS` -> `Letters (Concert Key)`
     - `NUMBERS` -> `Numbers (Nashville)`
     - `GTR` / `GUITAR` -> `Guitar Shapes (Capo)`
     - Duplicate format pairings (`.docx` vs `.pdf`) collapsed into a single version with a format switch or PDF view icon.

---

## Feature Set 3: Chart Version De-Cluttering & Curation ("The Compass Problem")

### Problem Statement
Songs like *Compass* have 7 versions in `charts.csv`:
- `compass-GUITAR_CHORDS.docx`
- `compass-LETTERs - no dropped beat in instrumental.docx` (Draft / experimental)
- `compass-LETTERs - UPDATE.docx` (Canonical updated version)
- `compass-LETTERs.docx` (Superseded older version)
- `.pdf` equivalents of each.

Showing all 7 in the main header overwhelms the interface with superseded drafts.

### Technical Specification
1. **Canonical vs Archive Version Classification**:
   - Differentiate **Canonical Active Versions** from **Draft / Archive Versions**.
   - Keyword detection for archive classification: `UPDATE` replaces non-update; `no dropped beat`, `draft`, `old`, `scratch` flagged as archive.
   - Alternatively, support explicit curation syntax in `charts.csv`:
     `compass-LETTERs - UPDATE.docx, compass-NUMBERS.docx, compass-GUITAR_CHORDS.docx | [archive] compass-LETTERs - no dropped beat in instrumental.docx, ...`
2. **UI Implementation**:
   - Primary tabs show only canonical active modes: `[ Letters ] [ Guitar Shapes ]`.
   - An unobtrusive dropdown or collapsible link: `"Alternate Drafts & Historical Versions (4) ▾"` for accessing historical notes and experimental arrangements without cluttering gig use.

---

## Feature Set 4: Missing Chart Integration (Immediate Data Fixes)

### Identified Catalog Discrepancies
1. **"As Easily As Birds"**:
   - *Current State*: Only `As Easily as Birds-GTR CHORDS.docx/.pdf` is linked in `charts.csv`.
   - *Discovery*: Complete `As Easily as Birds-LETTERS.docx` and `NUMBERS.docx` exist in `archive/raw_charts/multi/`.
   - *Action*: Promote files to `charts/input/` and update `charts.csv` with `LETTERS` as primary.
2. **"Box of Tears"**:
   - *Current State*: `box of tears-GUITAR CHORDS (Eb, C capo 3).docx` is currently listed first.
   - *Action*: Re-order `charts.csv` so `box of tears-LETTERS (Eb).docx` is first, followed by `NUMBERS`, then `GUITAR CHORDS`.

---

## Feature Set 5: The "Gemini Gateway" (Frictionless Intake Pipeline)

### Problem Statement
Brad frequently writes new songs or updates charts and lyrics in Word. Currently, adding a chart requires manually converting files, updating multiple CSVs (`songs.csv`, `charts.csv`, `lyrics.csv`), generating audio IDs, and verifying joins. Brad needs a "drop-in" gateway.

### Technical Architecture
A specialized Gemini-powered intake pipeline (runnable via CLI or web endpoint):
1. **Document Ingestion**:
   - Brad uploads or drops a `.docx`, `.pdf`, or text document.
2. **Gemini Extraction & Normalization**:
   - **Song Metadata**: Extracts canonical title, composition date, tuning & capo notation, and album/collection context.
   - **Lead-Sheet Chord Parser**:
     - Classifies chart type (`LETTERS`, `NUMBERS`, or `GTR CHORDS`).
     - Normalizes measure bars (`|`, `||:`, `:||`), floating meter shifts, asymmetric voltas, and chord alignments.
   - **Lyrics Parser**:
     - Segments lyrics into structured JSON (`stanzas`, verse/chorus/bridge labels, line breaks).
3. **Automated Asset Placement & Catalog Updates**:
   - Saves normalized `.docx` / `.pdf` directly to `charts/input/`.
   - Upserts record into `songs.csv`, `charts.csv`, and `lyrics.csv`.
   - Performs automated schema and link validation before landing.

---

## Implementation Action Plan & Milestones

| Milestone | Scope | Deliverables |
|---|---|---|
| **Phase 1: Immediate Chart Hierarchy & Data Fixes** | Fix priority bug, promote missing charts, "De-Brad" tab labels | 1. Implement deterministic `LETTERS > NUMBERS > GTR` priority in `app.js`.<br>2. Promote *As Easily As Birds* LETTERS & NUMBERS.<br>3. Fix *Box of Tears* default to LETTERS.<br>4. Clean standardized toggle labels in UI. |
| **Phase 2: Compass Curation & Version Deduplication** | Clean up multi-version songs | 1. Implement Canonical vs Archive version parser in `charts.csv`.<br>2. Pair PDF/DOCX into single mode entries.<br>3. Hide drafts behind "Other versions" disclosure. |
| **Phase 3: Tagging & Universal Search** | Non-album organization | 1. Add `tags` column in `songs.csv`.<br>2. Add Collection/Tag dropdown filter.<br>3. Add instant multi-field search bar. |
| **Phase 4: Gemini Intake Gateway** | Frictionless ingestion pipeline | 1. Intake CLI tool (`scripts/ingest_chart.py`) using Gemini API.<br>2. Automated extraction of metadata, lyrics JSON, and chord charts.<br>3. End-to-end test ingestion of a new Brad chart. |
