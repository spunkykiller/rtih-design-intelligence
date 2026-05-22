# RTIH Design Research Operation

This workspace is for research, evidence capture, design strategy, and approval artifacts for the Ratan Tata Incubation Hub redesign. It intentionally does not contain frontend implementation code.

## Operating Rules

- No website development begins until research, audit, style guide, UX principles, information architecture, and anti-slop review are complete and approved.
- Every recommendation must be traceable to evidence: screenshots, comparative reasoning, applicability to RTIH, implementation complexity, and risk.
- The research system privileges authentic institutional trust, founder clarity, ecosystem density, accessibility, and mobile-first behavior over fashionable visual effects.

## Commands

- `npm run research:capture -- --limit=3` captures benchmark screenshots and metadata for the next uncaptured priority sites.
- `npm run research:hourly` researches 3-5 additional websites, captures screenshots, appends findings, and updates the comparison queue.
- `npm run research:report` generates the six-hour design intelligence report.
- `npm run research:daily` refreshes brand, typography, CTA, navigation, and storytelling recommendations.
- `npm run research:status` summarizes current screenshot and findings coverage.

## Evidence Locations

- `research/screenshots/`: categorized screenshots by site, viewport, section, and pattern.
- `research/findings/`: JSONL evidence records and pattern findings.
- `research/reports/`: rolling intelligence reports.
- `research/benchmark-analysis/`: benchmark-by-benchmark strategic analysis.
- `research/design-audits/`: current RTIH audits and anti-slop reviews.
- `research/style-guide/`: approved or pending style system guidance.

