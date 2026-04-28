import {
  configExists,
  loadConfig,
  promptForConfig,
  saveConfig,
  saveTokens,
  tokensExist,
  getDbPath,
  createConfig,
  setActivePlanPath,
  getSnapshotPath,
  type Tokens,
} from "./lib/config.js";
import { log } from "./lib/logging.js";
import { migrate } from "./db/migrate.js";
import { execute, initDatabase, query, queryJson } from "./db/client.js";
import { getValidTokens } from "./strava/oauth.js";
import { getAllActivities, getAthlete } from "./strava/api.js";
import type { StravaActivity, StravaTokenResponse } from "./strava/types.js";
import { importArchive } from "./garmin/import-archive.js";
import { generateSnapshot } from "./snapshot.js";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Proxy Configuration
// ============================================================================

// Configure proxy for fetch() if HTTP_PROXY or HTTPS_PROXY is set
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface SyncArgs {
  command: "sync";
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  days?: number;
}

interface RenderArgs {
  command: "render";
  inputFile: string;
  outputFile?: string;
  setActive?: boolean;
}

interface QueryArgs {
  command: "query";
  sql: string;
  json: boolean;
}

interface AuthArgs {
  command: "auth";
  clientId?: string;
  clientSecret?: string;
  code?: string;
}

interface GarminArgs {
  command: "garmin";
  subcommand: "import-archive";
  archivePath: string;
  verbose: boolean;
}

interface CheckinArgs {
  command: "checkin";
  date?: string;
  sleepHours?: number;
  sleepQuality?: number;
  legs?: number;
  energy?: number;
  motivation?: number;
  stress?: number;
  notes?: string;
}

interface HelpArgs {
  command: "help";
}

interface SnapshotArgs {
  command: "snapshot";
}

type CliArgs =
  | SyncArgs
  | RenderArgs
  | QueryArgs
  | AuthArgs
  | GarminArgs
  | CheckinArgs
  | SnapshotArgs
  | HelpArgs;

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "sync") {
    // Sync command (default)
    const syncArgs: SyncArgs = { command: "sync" };

    for (const arg of args) {
      if (arg.startsWith("--client-id=")) {
        syncArgs.clientId = arg.split("=")[1];
      } else if (arg.startsWith("--client-secret=")) {
        syncArgs.clientSecret = arg.split("=")[1];
      } else if (arg.startsWith("--access-token=")) {
        syncArgs.accessToken = arg.split("=")[1];
      } else if (arg.startsWith("--refresh-token=")) {
        syncArgs.refreshToken = arg.split("=")[1];
      } else if (arg.startsWith("--days=")) {
        syncArgs.days = parseInt(arg.split("=")[1]);
      }
    }

    return syncArgs;
  }

  if (args[0] === "render") {
    if (!args[1]) {
      log.error("render command requires an input file");
      process.exit(1);
    }

    const renderArgs: RenderArgs = {
      command: "render",
      inputFile: args[1],
    };

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--output" || args[i] === "-o") {
        renderArgs.outputFile = args[i + 1];
        i++;
      } else if (args[i].startsWith("--output=")) {
        renderArgs.outputFile = args[i].split("=")[1];
      } else if (args[i] === "--set-active") {
        renderArgs.setActive = true;
      }
    }

    return renderArgs;
  }

  if (args[0] === "query") {
    if (!args[1]) {
      log.error("query command requires a SQL statement");
      process.exit(1);
    }

    const queryArgs: QueryArgs = {
      command: "query",
      sql: args[1],
      json: args.includes("--json"),
    };

    return queryArgs;
  }

  if (args[0] === "auth") {
    const authArgs: AuthArgs = { command: "auth" };

    for (const arg of args) {
      if (arg.startsWith("--client-id=")) {
        authArgs.clientId = arg.slice("--client-id=".length);
      } else if (arg.startsWith("--client-secret=")) {
        authArgs.clientSecret = arg.slice("--client-secret=".length);
      } else if (arg.startsWith("--code=")) {
        authArgs.code = arg.slice("--code=".length);
      }
    }

    return authArgs;
  }

  if (args[0] === "garmin") {
    if (args[1] === "import-archive") {
      if (!args[2]) {
        log.error("garmin import-archive requires a path to the ZIP file");
        process.exit(1);
      }
      return {
        command: "garmin",
        subcommand: "import-archive",
        archivePath: args[2],
        verbose: args.includes("--verbose"),
      };
    }
    log.error(`Unknown garmin subcommand: ${args[1]}`);
    process.exit(1);
  }

  if (args[0] === "checkin") {
    const checkinArgs: CheckinArgs = { command: "checkin" };
    for (const arg of args.slice(1)) {
      if (arg.startsWith("--date=")) checkinArgs.date = arg.slice("--date=".length);
      else if (arg.startsWith("--sleep-hours="))
        checkinArgs.sleepHours = parseFloat(arg.split("=")[1]);
      else if (arg.startsWith("--sleep-quality="))
        checkinArgs.sleepQuality = parseInt(arg.split("=")[1]);
      else if (arg.startsWith("--legs=")) checkinArgs.legs = parseInt(arg.split("=")[1]);
      else if (arg.startsWith("--energy=")) checkinArgs.energy = parseInt(arg.split("=")[1]);
      else if (arg.startsWith("--motivation="))
        checkinArgs.motivation = parseInt(arg.split("=")[1]);
      else if (arg.startsWith("--stress=")) checkinArgs.stress = parseInt(arg.split("=")[1]);
      else if (arg.startsWith("--notes=")) checkinArgs.notes = arg.slice("--notes=".length);
    }
    return checkinArgs;
  }

  if (args[0] === "snapshot") {
    return { command: "snapshot" };
  }

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    return { command: "help" };
  }

  log.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}

function printHelp(): void {
  console.log(`
Claude Coach - Training Plan Tools

Usage: npx claude-coach <command> [options]

Commands:
  sync                        Sync activities from Strava
  auth                        Get Strava authorization URL or exchange code for tokens
  garmin import-archive <zip> Import wellness data from a Garmin Connect export ZIP
  checkin                     Record an optional morning check-in
  snapshot                    Generate/update the athlete snapshot (~/.claude-coach/snapshot.json)
  render <file>               Render a training plan JSON to HTML
  query <sql>                 Run a SQL query against the database
  help                        Show this help message

Auth Options (for headless/Claude environments):
  --client-id=ID        Strava API client ID
  --client-secret=SEC   Strava API client secret
  --code=URL_OR_CODE    Full redirect URL or just the authorization code

  Step 1: Run 'auth' with credentials to get authorization URL
  Step 2: User clicks URL, authorizes, copies entire redirect URL
  Step 3: Run 'auth --code=URL' to exchange for tokens
  Step 4: Run 'sync' to fetch activities

Sync Options:
  --client-id=ID        Strava API client ID (for OAuth flow)
  --client-secret=SEC   Strava API client secret (for OAuth flow)
  --days=N              Days of history to sync (default: 730)

Garmin Import Options:
  --verbose             List all skipped/unrecognized CSV files

Check-in Options:
  --date=YYYY-MM-DD     Date (default: today)
  --sleep-hours=N       Subjective sleep duration in hours
  --sleep-quality=N     Sleep quality 1-5
  --legs=N              Leg freshness 1-5 (1=heavy, 5=fresh)
  --energy=N            Overall energy 1-5
  --motivation=N        Motivation to train 1-5
  --stress=N            Stress level 1-5 (1=calm, 5=stressed)
  --notes="..."         Free text notes

Render Options:
  --output, -o FILE     Output HTML file (default: <input>.html)
  --set-active          Mark this plan JSON as the active plan for weekly coaching

Query Options:
  --json                Output as JSON (default: plain text)

Examples:
  # Headless auth flow (for Claude/automated environments)
  npx claude-coach auth --client-id=12345 --client-secret=abc123
  npx claude-coach auth --code=AUTHORIZATION_CODE
  npx claude-coach sync --days=1095

  # Import Garmin archive (download from garmin.com/account/datamanagement/exportData)
  npx claude-coach garmin import-archive ~/Downloads/garmin-data.zip

  # Record a morning check-in (via Claude conversationally)
  npx claude-coach checkin --sleep-hours=7.5 --sleep-quality=4 --legs=3 --energy=4 --motivation=5 --stress=2

  # Query last check-in
  npx claude-coach query "SELECT * FROM morning_checkin ORDER BY date DESC LIMIT 1" --json

  # Query weekly volume
  npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5"
`);
}

// ============================================================================
// Auth Command (for headless/Claude environments)
// ============================================================================

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";

async function runAuth(args: AuthArgs): Promise<void> {
  // If code is provided, exchange it for tokens
  if (args.code) {
    if (!configExists()) {
      log.error("No configuration found. Run 'auth' with --client-id and --client-secret first.");
      process.exit(1);
    }

    // Extract code from full URL if user pasted the entire redirect URL
    let code = args.code;
    if (code.includes("localhost") || code.startsWith("http")) {
      try {
        const url = new URL(code);
        const extractedCode = url.searchParams.get("code");
        if (extractedCode) {
          code = extractedCode;
        } else {
          log.error("Could not find 'code' parameter in URL");
          process.exit(1);
        }
      } catch {
        // Not a valid URL, use as-is
      }
    }

    const config = loadConfig();
    log.start("Exchanging authorization code for tokens...");

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.strava.client_id,
        client_secret: config.strava.client_secret,
        code: code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      log.error(`Token exchange failed: ${error}`);
      process.exit(1);
    }

    const data: StravaTokenResponse = await tokenResponse.json();

    const tokens: Tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete_id: data.athlete.id,
    };

    saveTokens(tokens);
    log.success(`Authenticated as ${data.athlete.firstname} ${data.athlete.lastname}`);
    log.ready("Now run: npx claude-coach sync");
    return;
  }

  // Otherwise, generate and print the authorization URL
  if (!args.clientId || !args.clientSecret) {
    log.error("Required: --client-id and --client-secret");
    log.info("Get these from: https://www.strava.com/settings/api");
    process.exit(1);
  }

  // Save config for later use
  const config = createConfig(args.clientId, args.clientSecret, 730);
  saveConfig(config);

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", args.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "activity:read_all");
  authUrl.searchParams.set("approval_prompt", "auto");

  console.log("\n📋 AUTHORIZATION URL:\n");
  console.log(authUrl.toString());
  console.log("\n📝 INSTRUCTIONS:");
  console.log("1. Open the URL above in a browser");
  console.log("2. Click 'Authorize' on Strava");
  console.log("3. You'll be redirected to a page that won't load (that's OK!)");
  console.log("4. Copy the ENTIRE URL from your browser's address bar");
  console.log("5. Paste it back to Claude\n");
}

// ============================================================================
// Sync Command
// ============================================================================

function escapeString(str: string | null | undefined): string {
  if (str == null) return "NULL";
  return `'${str.replace(/'/g, "''")}'`;
}

function calcEFD(
  distance: number | null | undefined,
  elevationGain: number | null | undefined
): string {
  if (distance == null || elevationGain == null) return "NULL";
  // Trail approximation: 100m D+ ≈ 1km flat (10m/m factor)
  return String(Math.round(distance + elevationGain * 10));
}

function insertActivity(activity: StravaActivity): void {
  const sql = `
    INSERT OR REPLACE INTO activities (
      id, name, sport_type, start_date, elapsed_time, moving_time,
      distance, total_elevation_gain, average_speed, max_speed,
      average_heartrate, max_heartrate, average_watts, max_watts,
      weighted_average_watts, kilojoules, suffer_score, average_cadence,
      calories, description, workout_type, gear_id, raw_json,
      equivalent_distance_m, synced_at
    ) VALUES (
      ${activity.id},
      ${escapeString(activity.name)},
      ${escapeString(activity.sport_type)},
      ${escapeString(activity.start_date)},
      ${activity.elapsed_time ?? "NULL"},
      ${activity.moving_time ?? "NULL"},
      ${activity.distance ?? "NULL"},
      ${activity.total_elevation_gain ?? "NULL"},
      ${activity.average_speed ?? "NULL"},
      ${activity.max_speed ?? "NULL"},
      ${activity.average_heartrate ?? "NULL"},
      ${activity.max_heartrate ?? "NULL"},
      ${activity.average_watts ?? "NULL"},
      ${activity.max_watts ?? "NULL"},
      ${activity.weighted_average_watts ?? "NULL"},
      ${activity.kilojoules ?? "NULL"},
      ${activity.suffer_score ?? "NULL"},
      ${activity.average_cadence ?? "NULL"},
      ${activity.calories ?? "NULL"},
      ${escapeString(activity.description)},
      ${activity.workout_type ?? "NULL"},
      ${escapeString(activity.gear_id)},
      ${escapeString(JSON.stringify(activity))},
      ${calcEFD(activity.distance, activity.total_elevation_gain)},
      datetime('now')
    );
  `;

  execute(sql);
}

function backfillEFD(): void {
  execute(`
    UPDATE activities
    SET equivalent_distance_m = ROUND(distance + total_elevation_gain * 10)
    WHERE equivalent_distance_m IS NULL
      AND distance IS NOT NULL
      AND total_elevation_gain IS NOT NULL
  `);
}

function insertAthlete(athlete: {
  id: number;
  firstname: string;
  lastname: string;
  weight?: number;
  ftp?: number;
}): void {
  // Use upsert instead of INSERT OR REPLACE to preserve lthr/threshold_pace_sec_per_km
  // set by Garmin archive import — Strava does not provide these values.
  const sql = `
    INSERT INTO athlete (id, firstname, lastname, weight, ftp, raw_json, updated_at, profile_source)
    VALUES (
      ${athlete.id},
      ${escapeString(athlete.firstname)},
      ${escapeString(athlete.lastname)},
      ${athlete.weight ?? "NULL"},
      ${athlete.ftp ?? "NULL"},
      ${escapeString(JSON.stringify(athlete))},
      datetime('now'),
      'strava'
    )
    ON CONFLICT(id) DO UPDATE SET
      firstname    = excluded.firstname,
      lastname     = excluded.lastname,
      weight       = excluded.weight,
      ftp          = excluded.ftp,
      raw_json     = excluded.raw_json,
      updated_at   = excluded.updated_at;
  `;
  execute(sql);
}

async function runSync(args: SyncArgs): Promise<void> {
  log.box("Claude Coach - Strava Sync");

  // Step 0: Initialize SQLite backend
  await initDatabase();

  const syncDays = args.days || 730;

  // Step 1: Handle token-based auth (no browser needed)
  if (args.accessToken && args.refreshToken) {
    log.info("Using provided access tokens...");

    // Save tokens - we'll get athlete_id after fetching profile
    // Set expiry to 1 hour from now (we have refresh token for renewal)
    const tempTokens = {
      access_token: args.accessToken,
      refresh_token: args.refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete_id: 0, // Will be updated after fetching athlete
    };
    saveTokens(tempTokens);

    // Create minimal config if needed
    if (!configExists()) {
      // Token-based auth doesn't need client credentials for initial sync
      // but we need them for token refresh - use placeholders
      const config = createConfig("token-auth", "token-auth", syncDays);
      saveConfig(config);
    }

    // Initialize database
    migrate();

    // Fetch athlete to get ID and validate tokens
    log.start("Validating tokens and fetching athlete profile...");
    const athlete = await getAthlete(tempTokens);

    // Update tokens with real athlete ID
    const tokens = { ...tempTokens, athlete_id: athlete.id };
    saveTokens(tokens);

    insertAthlete(athlete);
    log.success(`Authenticated as ${athlete.firstname} ${athlete.lastname}`);

    // Fetch activities
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - syncDays);
    const activities = await getAllActivities(tokens, afterDate);

    // Store activities
    log.start("Storing activities in database...");
    let count = 0;
    for (const activity of activities) {
      insertActivity(activity);
      count++;
      if (count % 50 === 0) {
        log.progress(`   Stored ${count}/${activities.length}...`);
      }
    }
    log.progressEnd();
    log.success(`Stored ${activities.length} activities`);

    // Backfill EFD for any activities that didn't get it on insert
    log.start("Computing equivalent flat distance for all activities...");
    backfillEFD();

    execute(`
      INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
      VALUES (datetime('now'), datetime('now'), ${activities.length}, 'success');
    `);

    // Generate athlete snapshot post-sync
    try {
      generateSnapshot();
      log.success("Snapshot athlète mis à jour");
    } catch {
      // Non-fatal: snapshot may fail if insufficient data
    }

    log.info(`Database: ${getDbPath()}`);
    log.ready("Sync complete! You can now create training plans.");
    return;
  }

  // Step 2: OAuth-based auth (requires browser)
  if (!configExists()) {
    if (args.clientId && args.clientSecret) {
      log.info("Creating configuration from command line arguments...");
      const config = createConfig(args.clientId, args.clientSecret, syncDays);
      saveConfig(config);
      log.success("Configuration saved");
    } else {
      log.info("No configuration found. Let's set things up.");
      const config = await promptForConfig();
      saveConfig(config);
      log.success("Configuration saved");
    }
  }

  const config = loadConfig();
  const configSyncDays = args.days || config.sync_days || 730;

  // Initialize database
  migrate();

  // Authenticate with Strava (opens browser)
  const tokens = await getValidTokens();

  // Step 4: Fetch and store athlete profile
  log.start("Fetching athlete profile...");
  const athlete = await getAthlete(tokens);
  insertAthlete(athlete);
  log.success(`Athlete: ${athlete.firstname} ${athlete.lastname}`);

  // Step 5: Fetch activities
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - configSyncDays);

  const activities = await getAllActivities(tokens, afterDate);

  // Step 6: Store activities
  log.start("Storing activities in database...");
  let count = 0;
  for (const activity of activities) {
    insertActivity(activity);
    count++;
    if (count % 50 === 0) {
      log.progress(`   Stored ${count}/${activities.length}...`);
    }
  }
  log.progressEnd();
  log.success(`Stored ${activities.length} activities`);

  // Step 7: Backfill EFD for all activities (including pre-existing ones)
  log.start("Computing equivalent flat distance for all activities...");
  backfillEFD();

  // Step 8: Log sync
  execute(`
    INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
    VALUES (datetime('now'), datetime('now'), ${activities.length}, 'success');
  `);

  // Generate athlete snapshot post-sync
  try {
    generateSnapshot();
    log.success("Snapshot athlète mis à jour");
  } catch {
    // Non-fatal: snapshot may fail if insufficient data
  }

  log.info(`Database: ${getDbPath()}`);
  log.ready(`Query with: sqlite3 -json "${getDbPath()}" "SELECT * FROM weekly_volume"`);
}

// ============================================================================
// Garmin Command
// ============================================================================

async function runGarmin(args: GarminArgs): Promise<void> {
  await initDatabase();
  migrate();
  await importArchive(args.archivePath, args.verbose);
}

// ============================================================================
// Check-in Command
// ============================================================================

async function runCheckin(args: CheckinArgs): Promise<void> {
  await initDatabase();
  migrate();

  const date = args.date ?? new Date().toISOString().split("T")[0];

  const sql = `
    INSERT INTO morning_checkin (date, sleep_hours, sleep_quality, legs, energy, motivation, stress, notes, created_at)
    VALUES (
      '${date}',
      ${args.sleepHours ?? "NULL"},
      ${args.sleepQuality ?? "NULL"},
      ${args.legs ?? "NULL"},
      ${args.energy ?? "NULL"},
      ${args.motivation ?? "NULL"},
      ${args.stress ?? "NULL"},
      ${args.notes ? `'${args.notes.replace(/'/g, "''")}'` : "NULL"},
      datetime('now')
    );
  `;
  execute(sql);
  log.success(`Check-in recorded for ${date}`);

  // Show what was saved
  const rows = queryJson<Record<string, unknown>>(
    `SELECT * FROM morning_checkin WHERE date = '${date}' ORDER BY created_at DESC LIMIT 1`
  );
  if (rows.length > 0) {
    const r = rows[0];
    const parts: string[] = [];
    if (r.sleep_hours != null) parts.push(`sleep ${r.sleep_hours}h (quality ${r.sleep_quality}/5)`);
    if (r.legs != null) parts.push(`legs ${r.legs}/5`);
    if (r.energy != null) parts.push(`energy ${r.energy}/5`);
    if (r.motivation != null) parts.push(`motivation ${r.motivation}/5`);
    if (r.stress != null) parts.push(`stress ${r.stress}/5`);
    if (r.notes) parts.push(`"${r.notes}"`);
    if (parts.length > 0) log.info(parts.join(" · "));
  }
}

// ============================================================================
// Render Command
// ============================================================================

function getTemplatePath(): string {
  // Look for template in multiple locations
  const locations = [
    join(__dirname, "..", "templates", "plan-viewer.html"),
    join(__dirname, "..", "..", "templates", "plan-viewer.html"),
    join(process.cwd(), "templates", "plan-viewer.html"),
  ];

  for (const loc of locations) {
    try {
      readFileSync(loc);
      return loc;
    } catch {
      // Continue to next location
    }
  }

  throw new Error("Could not find plan-viewer.html template");
}

function runRender(args: RenderArgs): void {
  log.start("Rendering training plan...");

  // Read the plan JSON
  let planJson: string;
  try {
    planJson = readFileSync(args.inputFile, "utf-8");
  } catch (err) {
    log.error(`Could not read input file: ${args.inputFile}`);
    process.exit(1);
  }

  // Validate it's valid JSON
  try {
    JSON.parse(planJson);
  } catch (err) {
    log.error("Input file is not valid JSON");
    process.exit(1);
  }

  // Read the template
  const templatePath = getTemplatePath();
  let template = readFileSync(templatePath, "utf-8");

  // Replace the plan data in the template
  const planDataRegex = /<script type="application\/json" id="plan-data">[\s\S]*?<\/script>/;
  const newPlanData = `<script type="application/json" id="plan-data">\n${planJson}\n</script>`;
  template = template.replace(planDataRegex, newPlanData);

  // Output
  if (args.outputFile) {
    writeFileSync(args.outputFile, template);
    log.success(`Training plan rendered to: ${args.outputFile}`);
    if (args.setActive) {
      const absPath = resolve(args.inputFile);
      setActivePlanPath(absPath);
      log.success(`Plan actif défini : ${absPath}`);
    }
  } else {
    // Output to stdout
    console.log(template);
  }
}

// ============================================================================
// Snapshot Command
// ============================================================================

async function runSnapshot(): Promise<void> {
  await initDatabase();
  migrate();
  const snapshot = generateSnapshot();
  log.success(`Snapshot athlète mis à jour : ${getSnapshotPath()}`);
  const currentWeek = snapshot.rolling4w[0];
  if (currentWeek) {
    log.info(
      `Semaine courante : ${currentWeek.efd_km} km EFD / ${currentWeek.dplus_m} m D+ / ${currentWeek.hours}h`
    );
  }
  for (const flag of snapshot.readinessFlags) {
    log.info(`⚠  ${flag}`);
  }
}

// ============================================================================
// Query Command
// ============================================================================

async function runQuery(args: QueryArgs): Promise<void> {
  await initDatabase();

  if (args.json) {
    const results = queryJson(args.sql);
    console.log(JSON.stringify(results, null, 2));
  } else {
    const result = query(args.sql);
    console.log(result);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  switch (args.command) {
    case "help":
      printHelp();
      break;
    case "auth":
      await runAuth(args);
      break;
    case "sync":
      await runSync(args);
      break;
    case "garmin":
      await runGarmin(args);
      break;
    case "checkin":
      await runCheckin(args);
      break;
    case "snapshot":
      await runSnapshot();
      break;
    case "render":
      runRender(args);
      break;
    case "query":
      await runQuery(args);
      break;
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
