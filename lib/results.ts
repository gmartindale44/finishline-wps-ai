// lib/results.ts

export type ParsedOutcome = {
  win: string;
  place: string;
  show: string;
};

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/[^A-Za-z0-9' .\-]/g, '').trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

export async function fetchAndParseResults(
  url: string,
  options?: { raceNo?: string | number | null },
): Promise<ParsedOutcome> {
  const outcome: ParsedOutcome = { win: '', place: '', show: '' };
  if (!url) return outcome;

  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return outcome;
    const html = await res.text();

    const isHRN = /horseracingnation\.com/i.test(url);

    let scopeHtml = html;
    const raceNo = options?.raceNo;
    // Narrow to requested race for non-HRN sites when raceNo is provided
    if (!isHRN && raceNo != null && raceNo !== '') {
      const num = String(raceNo).trim();
      try {
        const patterns = [
          new RegExp(
            `Race\\s*${num}[\\s\\S]{0,4000}?(?:Finish\\s+Order|Win\\b)`,
            'i',
          ),
          new RegExp(
            `Race\\s*${num}[\\s\\S]{0,4000}?<table[\\s\\S]{0,4000}?</table>`,
            'i',
          ),
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m) {
            scopeHtml = m[0];
            break;
          }
        }
      } catch {
        // fall back to full html on any regex error
      }
    }

    const trySetFromList = (names: string[]) => {
      const filtered = names
        .map(cleanName)
        .filter(Boolean)
        .filter((n) => {
          const lower = n.toLowerCase();

          if (lower === 'win' || lower === 'place' || lower === 'show') {
            return false;
          }

          // Drop pure ordinals like "4th", "2nd", etc.
          if (/^\d+(st|nd|rd|th)$/i.test(lower)) return false;

          const alpha = lower.replace(/[^a-z]/g, '');
          // Drop very short alpha fragments (e.g. "th")
          if (alpha.length < 3) return false;

          // Require at least one word fragment of length >= 3
          if (!/\b[a-z]{3,}\b/i.test(lower)) return false;

          return true;
        });

      if (filtered.length >= 3) {
        outcome.win = outcome.win || filtered[0];
        outcome.place = outcome.place || filtered[1];
        outcome.show = outcome.show || filtered[2];
      }
    };

    // HorseRacingNation-specific parsing (Entries & Results tables)
    if (isHRN) {
      try {
        const tableRe = /<table[\s\S]*?<\/table>/gi;
        let hrnWin = '';
        let hrnPlace = '';
        let hrnShow = '';

        let m: RegExpExecArray | null;
        // Scan tables to find one whose header row has Runner + Win + Place + Show
        // Use full HTML for HRN (not scoped)
        while ((m = tableRe.exec(html))) {
          const table = m[0];
          const headerMatch = table.match(/<tr[\s\S]*?<\/tr>/i);
          if (!headerMatch) continue;

          const headerCells = Array.from(
            headerMatch[0].matchAll(
              /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi,
            ),
          ).map((cell) => cleanName(stripTags(cell[1])).toLowerCase());

          const runnerIdx = headerCells.findIndex(
            (h) => h.includes('runner') || h.includes('horse'),
          );
          const winIdx = headerCells.findIndex((h) => h.includes('win'));
          const placeIdx = headerCells.findIndex((h) => h.includes('place'));
          const showIdx = headerCells.findIndex((h) => h.includes('show'));

          if (
            runnerIdx === -1 ||
            winIdx === -1 ||
            placeIdx === -1 ||
            showIdx === -1
          ) {
            continue;
          }

          const rowMatches = Array.from(
            table.matchAll(/<tr[\s\S]*?<\/tr>/gi),
          ).slice(1); // skip header

          for (const row of rowMatches) {
            const cells = Array.from(
              row[0].matchAll(
                /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi,
              ),
            ).map((cell) => stripTags(cell[1]).trim());

            const runner = cells[runnerIdx] || '';
            const winVal = cells[winIdx] || '';
            const placeVal = cells[placeIdx] || '';
            const showVal = cells[showIdx] || '';

            if (!hrnWin && winVal && runner) hrnWin = runner;
            if (!hrnPlace && placeVal && runner) hrnPlace = runner;
            if (!hrnShow && showVal && runner) hrnShow = runner;
          }

          if (hrnWin || hrnPlace || hrnShow) {
            trySetFromList([hrnWin, hrnPlace, hrnShow]);
            break;
          }
        }
      } catch {
        // fall back to generic parsing
      }
    }

    // Try to parse a Finish Order table first
    const finishMatch = scopeHtml.match(
      /Finish\s+Order[\s\S]{0,2000}?<\/table>/i,
    );
    if (finishMatch) {
      const block = finishMatch[0];
      const names = Array.from(
        block.matchAll(/>([A-Za-z0-9' .\-]+)</g),
      ).map((m) => m[1]);
      trySetFromList(names);
    }

    // Fallback: Win / Place / Show text block
    if (!outcome.win) {
      const hrn = scopeHtml.match(
        /Win[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Place[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Show[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i,
      );
      if (hrn) {
        trySetFromList([hrn[1], hrn[2], hrn[3]]);
      }
    }

    // Fallback: 1st / 2nd / 3rd style text
    if (!outcome.win) {
      const fallback = scopeHtml.match(
        /1st[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?2nd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?3rd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i,
      );
      if (fallback) {
        trySetFromList([fallback[1], fallback[2], fallback[3]]);
      }
    }
  } catch (error) {
    console.error('[results] parse failed', error);
  }

  return outcome;
}
