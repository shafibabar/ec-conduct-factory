# EC City Explainer

This repo builds a single isometric explorable explainer for the Smarsh Enterprise Conduct
microservices platform, using the `isometric-explainer` skill.

## Context

All architecture, simulation spec, narration, and fidelity ledger inputs are in:
  knowledge/system-explainer-input.md

Read that file before writing any code. It is the sole source of truth for:
- What each service (building) does
- How the vehicle travels between them
- What model.js must compute
- What the narration panels say

## First run

Copy the template, then replace the subject:
  cp -r .claude/skills/isometric-explainer/assets/template src
  cd src && python -m http.server 8000
