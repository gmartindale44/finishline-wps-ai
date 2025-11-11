export type ParsedOutcome = {
  win: string;
  place: string;
  show: string;
};

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/[^A-Za-z0-9' .\-]/g, '').trim();
}

export async function fetchAndParseResults(url: string): Promise<ParsedOutcome> {
  const outcome: ParsedOutcome = { win: '', place: '', show: '' };
  if (!url) return outcome;

  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return outcome;
    const html = await res.text();

    const trySetFromList = (names: string[]) => {
      const filtered = names.map(cleanName).filter(Boolean);
      if (filtered.length >= 3) {
        outcome.win = outcome.win || filtered[0];
        outcome.place = outcome.place || filtered[1];
        outcome.show = outcome.show || filtered[2];
      }
    };

    const finishMatch = html.match(/Finish\s+Order[\s\S]{0,2000}?<\/table>/i);
    if (finishMatch) {
      const block = finishMatch[0];
      const names = Array.from(block.matchAll(/>([A-Za-z0-9' .\-]+)</g)).map((m) => m[1]);
      trySetFromList(names);
    }

    if (!outcome.win) {
      const hrn = html.match(/Win[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Place[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Show[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i);
      if (hrn) {
        trySetFromList([hrn[1], hrn[2], hrn[3]]);
      }
    }

    if (!outcome.win) {
      const fallback = html.match(/1st[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?2nd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?3rd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i);
      if (fallback) {
        trySetFromList([fallback[1], fallback[2], fallback[3]]);
      }
    }
  } catch (error) {
    console.error('[results] parse failed', error);
  }

  return outcome;
}
