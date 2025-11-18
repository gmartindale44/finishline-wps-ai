Skip to content
Navigation Menu
gmartindale44
finishline-wps-ai

Type / to search
Code
Issues
Pull requests
Actions
Projects
Wiki
Security
Insights
Settings
fix: improve HRN parser to use payout cells and simplify summary display #102
✨ 
 Merged
gmartindale44 merged 10 commits into master from fix/hrn-race-specific-parser  yesterday
+67 −121 
 Conversation 1
 Commits 10
 Checks 1
 Files changed 2
 
File filter 
 
0 / 2 files viewed
Filter changed files
  138 changes: 54 additions & 84 deletions138  
pages/api/verify_race.js
Viewed
Original file line number	Diff line number	Diff line change
@@ -193,117 +193,87 @@ function parseHRNRaceOutcome($, raceNo) {

      // Parse rows to find Win/Place/Show horses
      // The Runner (speed) table encodes finishing positions:
      // - Row with non-empty Win column = winner
      // - Row with non-empty Place column = place horse
      // - Row with non-empty Show column = show horse
      // - Row with payout in first payout cell (Win) = winner
      // - Row with payout in second payout cell (Place) = place horse
      // - Row with payout in third payout cell (Show) = show horse
      const rows = $table.find("tr").slice(1); // Skip header
      let winHorse = null;
      let placeHorse = null;
      let showHorse = null;

      /**
       * Check if a cell value indicates a payout/result (non-empty)
       * Accepts: dollar amounts ($8.20), numbers, or any non-whitespace text
       * Rejects: empty, "-", whitespace-only, or speed figures like "98*"
       */
      const isNonEmptyPayout = (val) => {
        if (!val) return false;
        const trimmed = val.trim();
        if (!trimmed || trimmed === "-") return false;
        // Reject if it looks like a speed figure (number followed by *)
        if (/^\d+\s*\*?\s*$/.test(trimmed)) return false;
        // Accept anything else that's not just whitespace
        return trimmed.length > 0;
      };

      rows.each((_, row) => {
        const cells = $(row).find("td, th").toArray();
        const maxIdx = Math.max(runnerIdx, winIdx, placeIdx, showIdx);
        if (cells.length <= maxIdx) {
          return; // Not enough cells
        if (cells.length < 2) {
          return; // Need at least runner name + some payout cells
        }

        // Extract runner name (strip speed figure suffix like "(98*)")
        let runnerName = $(cells[runnerIdx]).text().trim();
        // Extract runner name from the first cell (strip speed figure suffix like "(98*)")
        let runnerName = $(cells[0]).text().trim();
        // Remove speed figure in parentheses: "Full Time Strutin (98*)" -> "Full Time Strutin"
        runnerName = runnerName.replace(/\s*\([^)]*\)\s*$/, "").trim();
        runnerName = normalizeHorseName(runnerName);

        if (!runnerName) return;

        // Extract Win/Place/Show values - get text content and check for non-empty
        // CRITICAL: Use the exact column indices we found - do not swap or infer
        // Also check for images/icons that might indicate a payout (some sites use checkmarks/images)
        const winCell = $(cells[winIdx]);
        const placeCell = $(cells[placeIdx]);
        const showCell = $(cells[showIdx]);

        // Get text content - also check if cell has images or other indicators
        let winVal = winCell.text().trim();
        let placeVal = placeCell.text().trim();
        let showVal = showCell.text().trim();

        // If text is empty but cell has images/icons, treat as non-empty
        // (some sites use images to indicate payouts)
        if (!winVal && winCell.find("img, svg, [class*='icon'], [class*='check']").length > 0) {
          winVal = "X"; // Mark as non-empty
        }
        if (!placeVal && placeCell.find("img, svg, [class*='icon'], [class*='check']").length > 0) {
          placeVal = "X"; // Mark as non-empty
        }
        if (!showVal && showCell.find("img, svg, [class*='icon'], [class*='check']").length > 0) {
          showVal = "X"; // Mark as non-empty
        // Find payout cells: cells that contain "$" (dollar amounts)
        // In HRN Runner table, payout cells are the ones with dollar amounts like "$8.20"
        // Other cells may contain post position numbers, speed figures, icons, etc. - ignore those
        const payoutCells = cells
          .map((cell, idx) => ({ cell: $(cell), idx }))
          .filter(({ cell }) => {
            const text = cell.text().trim();
            return text.includes("$");
          });

        // We need at least 3 payout cells (Win, Place, Show)
        // But we'll work with what we have
        if (payoutCells.length < 1) {
          return; // No payout cells found in this row
        }

        // Debug: log column indices and values for first few rows (server-side only)
        // Extract payout text from each payout cell
        // payoutCells[0] = Win payout, [1] = Place payout, [2] = Show payout
        const winText =
          payoutCells[0]?.cell.text().trim() || "";
        const placeText =
          payoutCells[1]?.cell.text().trim() || "";
        const showText =
          payoutCells[2]?.cell.text().trim() || "";

        // Check if each payout is valid (non-empty and not "-")
        const hasWin = !!winText && winText !== "-" && winText.length > 0;
        const hasPlace = !!placeText && placeText !== "-" && placeText.length > 0;
        const hasShow = !!showText && showText !== "-" && showText.length > 0;

        // Debug logging (server-side only)
        if (process.env.VERIFY_DEBUG === "true") {
          console.log("[verify_race] HRN cell values", {
          console.log("[verify_race] HRN payout cells", {
            runnerName,
            runnerIdx,
            winIdx,
            placeIdx,
            showIdx,
            winVal,
            placeVal,
            showVal,
            winIsValid: isNonEmptyPayout(winVal),
            placeIsValid: isNonEmptyPayout(placeVal),
            showIsValid: isNonEmptyPayout(showVal),
            payoutCellsCount: payoutCells.length,
            winText,
            placeText,
            showText,
            hasWin,
            hasPlace,
            hasShow,
          });
        }

        // Assign positions based on which columns have non-empty payout values
        // Each position should be assigned to the FIRST row that has a non-empty value in that column
        // and hasn't already been assigned to a higher position
        if (!winHorse && isNonEmptyPayout(winVal)) {
          winHorse = runnerName;
        // Assign positions: only assign once per bucket (first row with valid payout)
        if (hasWin && !outcome.win) {
          outcome.win = runnerName;
        }
        if (!placeHorse && isNonEmptyPayout(placeVal) && runnerName !== winHorse) {
          placeHorse = runnerName;
        if (hasPlace && !outcome.place) {
          outcome.place = runnerName;
        }
        if (
          !showHorse &&
          isNonEmptyPayout(showVal) &&
          runnerName !== winHorse &&
          runnerName !== placeHorse
        ) {
          showHorse = runnerName;
        if (hasShow && !outcome.show) {
          outcome.show = runnerName;
        }
      });

      // Store what we found from the Runner (speed) table
      // CRITICAL: Assign exactly as found - Win column => win, Place column => place, Show column => show
      if (winHorse || placeHorse || showHorse) {
        if (winHorse) outcome.win = winHorse;
        if (placeHorse) outcome.place = placeHorse;
        if (showHorse) outcome.show = showHorse;

      // If we found at least one position from the Runner (speed) table, we're done with this table
      // The outcome object was populated directly in the loop above
      if (outcome.win || outcome.place || outcome.show) {
        // Debug logging for HRN parsing (server-side only)
        if (process.env.VERIFY_DEBUG === "true") {
          console.log("[verify_race] HRN Runner table result", {
            winHorse,
            placeHorse,
            showHorse,
            outcome: { ...outcome },
          });
        }
  50 changes: 13 additions & 37 deletions50  
public/js/verify-modal.js
Viewed
Original file line number	Diff line number	Diff line change
@@ -135,34 +135,17 @@
      lines.push(`Using date: ${data.date}`);
    }

    // Show error info first if present
    // If there's an error, show a minimal error block and stop
    if (data.error) {
      lines.push(`Error: ${data.error}`);
    }
    if (data.details && data.details !== data.error) {
      lines.push(`Details: ${data.details}`);
    }
    if (data.step) {
      lines.push(`Step: ${data.step}`);
    }

    // Show query if present
    if (data.query) {
      lines.push(`Query: ${data.query}`);
    }

    // Show top result if present (with safe checks) - BEFORE outcome
    if (data.top && typeof data.top === "object" && data.top.title) {
      lines.push(
        `Top Result: ${data.top.title}${
          data.top.link ? `\n${data.top.link}` : ""
        }`
      );
    } else if (data.link) {
      lines.push(`Link: ${data.link}`);
      if (data.details && data.details !== data.error) {
        lines.push(`Details: ${data.details}`);
      }
      summaryEl.textContent = lines.join("\n");
      return;
    }

    // Show outcome if present (with safe checks)
    // Success path: only show Outcome (if present)
    if (data.outcome && typeof data.outcome === "object") {
      const parts = [];
      if (data.outcome.win) parts.push(`Win ${data.outcome.win}`);
@@ -173,19 +156,12 @@
      }
    }

    // Show hits if present (with safe checks) - always show
    if (data.hits && typeof data.hits === "object") {
      const hitParts = [];
      if (data.hits.winHit) hitParts.push("Win");
      if (data.hits.placeHit) hitParts.push("Place");
      if (data.hits.showHit) hitParts.push("Show");
      lines.push(
        hitParts.length ? `Hits: ${hitParts.join(", ")}` : "Hits: (none)"
      );
    }

    // Show summary text if present
    if (data.summary && typeof data.summary === "string") {
    // If no outcome and no error, but we have some summary text, show that
    if (
      !data.error &&
      (!data.outcome || !lines.some((l) => l.startsWith("Outcome:"))) &&
      data.summary
    ) {
      lines.push(data.summary);
    }

Footer
© 2025 GitHub, Inc.
Footer navigation
Terms
Privacy
Security
Status
Community
Docs
Contact
Manage cookies
Do not share my personal information
fix: improve HRN parser to use payout cells and simplify summary display by gmartindale44 · Pull Request #102 · gmartindale44/finishline-wps-ai
