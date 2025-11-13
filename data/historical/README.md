### Historical Data Drop Folder

Use this directory to stage Equibase/Brisnet/Kaggle-style CSV exports before
normalising them into the FinishLine calibration dataset.

#### Quick Start

1. Drop one or more CSVs here (or point to absolute paths).
2. Run the backfill script:

   ```
   node scripts/backfill_historical.ts data/historical/example_hist.csv
   ```

3. Normalised rows are appended to `data/finishline_historical_v1.csv`
   (header added automatically, duplicates skipped).

#### Accepted Inputs

- **Canonical FinishLine schema** &mdash; CSV already matches
  `race_id,track,race_num,...,profit_loss`.
  These rows are validated with the same loader used by calibration.
- **Generic historical schema** &mdash; columns such as
  `date`, `track`, `race_number`, `winner`, `place`, `show`,
  `win_payoff`, `place_payoff`, `show_payoff`.
  The script auto-detects common aliases (see `schema.md`) and builds the
  canonical FinishLine row with conservative defaults (confidence/top3 mass set
  to 0, profit computed from a $2 W/P/S ticket).

Rows missing critical information (track, race number, date, winner) or with
invalid numerics are skipped with a console warning.

Real customer data must be stored securely. This folder is committed only for
local workflows and should remain empty in production builds.

