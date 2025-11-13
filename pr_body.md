## Summary
- Rebuild the Verify modal header so Track sits above Race/Date, with a visible YYYY-MM-DD text field that always submits.
- Harden the modal summary to show query, winners, top link, hits, or server error; add a “Green-Zone Log” JSON panel with request/response details.
- Bias `/api/verify_race` top-result selection toward HorseRacingNation before Equibase, keeping existing logging unchanged.
- Bump the verify loader to `v2025-11-10-23` so the r23 modal ships everywhere.

## Testing
- npm run build
