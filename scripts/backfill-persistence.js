/**
 * scripts/backfill-persistence.js
 * Seeds canonical tracks and distance measurements into Upstash Redis via REST.
 * Idempotent: safe to run multiple times. Requires:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   FINISHLINE_PERSISTENCE_ENABLED=true
 *
 * Project is "type": "module" → keep ESM.
 */

const {
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
  FINISHLINE_PERSISTENCE_ENABLED,
} = process.env;

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('[backfill] Missing Upstash envs. Aborting.');
  process.exit(1);
}

if (String(FINISHLINE_PERSISTENCE_ENABLED).toLowerCase() !== 'true') {
  console.warn(
    '[backfill] FINISHLINE_PERSISTENCE_ENABLED is not "true" – proceeding anyway (dry-ish run).'
  );
}

const NS_TRACK = 'fl:persist:track'; // e.g. fl:persist:track:gulfstream_park
const NS_MEAS = 'fl:persist:measurement'; // e.g. fl:persist:measurement:6f

// --- Canonical seeds (expand freely) ----------------------------------------
const TRACKS = [
  'Aqueduct Racetrack',
  'Arlington International Racecourse',
  'Aintree Racecourse',
  'Ascot Racecourse',
  'Ayr Racecourse',
  'Albany Racecourse',
  'Assiniboia Downs',
  'Bergsåker',
  'Belmont Park',
  'Belterra Park',
  'Batavia Downs',
  'Buffalo Raceway',
  'Baden-Baden',
  'Bangalore Turf Club',
  'Bendigo Racecourse',
  'Beverley Racecourse',
  'Churchill Downs',
  'Charles Town Races',
  'Canterbury Park',
  'Colonial Downs',
  'Cheltenham Racecourse',
  'Chantilly Racecourse',
  'Caulfield Racecourse',
  'Curragh Racecourse',
  'Camarero Racetrack',
  'Del Mar Thoroughbred Club',
  'Delta Downs',
  'Dubai Racing Club (Meydan)',
  'Doomben Racecourse',
  'Doncaster Racecourse',
  'Deauville-La Touques',
  'Evangeline Downs',
  'Ellis Park',
  'Epsom Downs',
  'Emerald Downs',
  'Eagle Farm',
  'Fair Grounds',
  'Finger Lakes Gaming & Racetrack',
  'Fort Erie Racetrack',
  'Flemington Racecourse',
  'Ffos Las Racecourse',
  'Gulfstream Park',
  'Golden Gate Fields',
  'Goodwood Racecourse',
  'Greyville Racecourse',
  'Garrison Savannah',
  'Hawthorne Race Course',
  'Hastings Racecourse',
  'Happy Valley Racecourse',
  'Hollywood Park',
  'Hialeah Park',
  'Indiana Grand',
  'Horseshoe Indianapolis',
  'Ipswich Turf Club',
  'Iroquois Park Raceway',
  'Tokyo Racecourse',
  'Jaraguá Jockey Club',
  'Jebel Ali Racecourse',
  'Keeneland Racecourse',
  'Kentucky Downs',
  'Kenilworth Racecourse',
  'Kranji Racecourse',
  'Laurel Park',
  'Lone Star Park',
  'Louisiana Downs',
  'Longchamp Racecourse',
  'Lingfield Park',
  'Leopardstown Racecourse',
  'Monmouth Park',
  'Mountaineer Park',
  'Meadowlands Racetrack',
  'Meydan Racecourse',
  'Moonee Valley',
  'Mombasa Racecourse',
  'Northfield Park',
  'Newcastle Racecourse',
  'Nottingham Racecourse',
  'Naracoorte Racecourse',
  'Oaklawn Park',
  'Oakbank Racecourse',
  'Ohi Racecourse',
  'Rideau Carleton Raceway',
  'Penn National',
  'Pimlico Race Course',
  'Parx Racing',
  'Prairie Meadows',
  'Ascot Racecourse (Perth)',
  'Pakenham Racecourse',
  'Queanbeyan Racecourse',
  'Quirindi Racecourse',
  'Doha Racecourse',
  'Remington Park',
  'Ruidoso Downs',
  'Rosehill Gardens',
  'Randwick Racecourse',
  'Redcar Racecourse',
  'Saratoga Race Course',
  'Santa Anita Park',
  'Sam Houston Race Park',
  'Sunland Park',
  'Sandown Park',
  'Sha Tin Racecourse',
  'Tampa Bay Downs',
  'Turfway Park',
  'Thistledown',
  'Tipperary Racecourse',
  'Taunton Racecourse',
  'Uttoxeter Racecourse',
  'Urawa Racecourse',
  'Umatilla County Fair Track',
  'Vaal Racecourse',
  'Vincennes Hippodrome',
  'Victoria Park',
  'Valparaiso Sporting Club',
  'Woodbine Racetrack',
  'Will Rogers Downs',
  'Wolverhampton Racecourse',
  'Warwick Farm Racecourse',
  'Windsor Racecourse',
  "Xi'an Racecourse",
  'York Racecourse',
  'Yarmouth Racecourse',
  'Yavapai Downs',
  'Yulong Racecourse',
  'Zia Park',
  'Borrowdale Park',
  'Zagreb Racecourse',
];

const MEASUREMENTS = [
  // Thoroughbred (yards + furlongs + routes)
  '300y',
  '330y',
  '440y',
  '4f',
  '4.5f',
  '5f',
  '5.5f',
  '6f',
  '6.5f',
  '7f',
  '7.5f',
  '1m',
  '1 1/16m',
  '1 1/8m',
  '1 3/16m',
  '1 1/4m',
  '1 1/2m',

  // Harness style (kilometer style readouts commonly shown)
  '1.10m',
  '1.12m',
  '1.14m',
];

// --- Minimal helpers --------------------------------------------------------
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const upstash = async (cmd, ...args) => {
  const url = `${UPSTASH_REDIS_REST_URL}/${cmd}/${args
    .map(encodeURIComponent)
    .join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`[upstash] ${cmd} failed (${res.status})`);
  return res.json();
};

// Prefer pipeline to reduce round-trips
const pipeline = async (commands) => {
  const res = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`[upstash] pipeline failed (${res.status})`);
  return res.json();
};

const main = async () => {
  console.log('[backfill] Seeding Tracks and Measurements to Upstash…');

  // Build SET commands (idempotent — SET overwrites with same value)
  const commands = [];

  for (const track of TRACKS) {
    const key = `${NS_TRACK}:${slug(track)}`;
    commands.push(['SET', key, track]); // value = canonical track name
  }

  for (const measurement of MEASUREMENTS) {
    const key = `${NS_MEAS}:${slug(measurement)}`;
    commands.push(['SET', key, measurement]); // value = canonical measurement label
  }

  // Execute in chunks to stay friendly
  const chunkSize = 100;
  for (let i = 0; i < commands.length; i += chunkSize) {
    const slice = commands.slice(i, i + chunkSize);
    await pipeline(slice);
  }

  // Quick counts (approx) using KEYS; fine for small namespaces
  const tracksList = await upstash('KEYS', `${NS_TRACK}:*`);
  const measurementsList = await upstash('KEYS', `${NS_MEAS}:*`);

  console.log(
    `[backfill] Tracks upserted: ${TRACKS.length} (keys now: ${
      Array.isArray(tracksList.result) ? tracksList.result.length : 'n/a'
    })`
  );
  console.log(
    `[backfill] Measurements upserted: ${MEASUREMENTS.length} (keys now: ${
      Array.isArray(measurementsList.result)
        ? measurementsList.result.length
        : 'n/a'
    })`
  );
  console.log('[backfill] Done.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

