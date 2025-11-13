### Historical CSV Schema (draft)

| Column            | Type    | Notes                                                     |
|-------------------|---------|-----------------------------------------------------------|
| date              | string  | `YYYY-MM-DD`                                              |
| track             | string  | Track identifier (free-text)                              |
| raceNo            | string  | Race number or designation                                |
| distanceF         | number  | Distance in furlongs                                      |
| surface           | string  | e.g. `Dirt`, `Turf`, `Synthetic`                          |
| fieldSize         | number  | Count of starters                                         |
| confidence        | number  | FinishLine model confidence (0-100) if available          |
| top3Mass          | number  | Sum of top-three probabilities (0-100)                    |
| gap12             | number  | Model gap between #1 and #2 picks                         |
| gap23             | number  | Model gap between #2 and #3 picks                         |
| suggested         | string  | Suggested bet type (`ATB`, `WinOnly`, `ExactaBox`, …)     |
| stake             | number  | Stake amount used in backtest (default 1)                 |
| profit            | number  | Net profit relative to stake (negative for losses)        |
| winHorse          | string  | Official winner                                           |
| placeHorse        | string  | Official place finisher                                   |
| showHorse         | string  | Official show finisher                                    |
| winHit            | number  | `1` if model hit the win slot, else `0`                   |
| placeHit          | number  | `1` if model hit the place slot                           |
| showHit           | number  | `1` if model hit the show slot                            |

Additional columns may be included; unknown fields are ignored by the importer.

