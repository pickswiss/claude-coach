import JSZip from "jszip";
import { readFileSync } from "fs";
import { execute, queryJson } from "../db/client.js";
import { log } from "../lib/logging.js";

// ============================================================================
// SQL Helper
// ============================================================================

function escapeSQL(val: string | number | null): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return `'${val.replace(/'/g, "''")}'`;
}

// ============================================================================
// Date Helpers
// ============================================================================

function epochMsToDate(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function isoToDate(s: string): string | null {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ============================================================================
// Sleep importer — sleepData.json
// ============================================================================

interface GarminSleepEntry {
  calendarDate?: string;
  deepSleepSeconds?: number;
  lightSleepSeconds?: number;
  remSleepSeconds?: number;
  sleepScores?: { overallScore?: number };
}

function garminSleepScoreTo5(score: number | null): number | null {
  if (score === null) return null;
  if (score <= 20) return 1;
  if (score <= 40) return 2;
  if (score <= 60) return 3;
  if (score <= 80) return 4;
  return 5;
}

function importSleepJSON(entries: GarminSleepEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    const date = entry.calendarDate ? isoToDate(entry.calendarDate) : null;
    if (!date) continue;

    const deepSec = entry.deepSleepSeconds ?? 0;
    const lightSec = entry.lightSleepSeconds ?? 0;
    const remSec = entry.remSleepSeconds ?? 0;
    const totalSec = deepSec + lightSec + remSec;
    if (totalSec < 1800) continue; // less than 30 min → skip

    const durationH = Math.round((totalSec / 3600) * 10) / 10;
    const deepPct = totalSec > 0 ? Math.round((deepSec / totalSec) * 100) : null;
    const remPct = totalSec > 0 ? Math.round((remSec / totalSec) * 100) : null;
    const scoreRaw = entry.sleepScores?.overallScore ?? null;
    const quality = garminSleepScoreTo5(scoreRaw);

    execute(`
      INSERT OR REPLACE INTO sleep (date, duration_h, quality, deep_pct, rem_pct, source)
      VALUES (${escapeSQL(date)}, ${escapeSQL(durationH)}, ${escapeSQL(quality)}, ${escapeSQL(deepPct)}, ${escapeSQL(remPct)}, 'garmin_archive')
    `);
    count++;
  }
  return count;
}

// ============================================================================
// HRV importer — TrainingReadinessDTO_*.json
// ============================================================================

interface GarminTrainingReadiness {
  calendarDate?: string;
  hrvWeeklyAverage?: number;
  level?: string;
}

const HRV_SENTINEL = 511;

function levelToScore(level: string): number | null {
  switch (level.toUpperCase()) {
    case "PRIME":
      return 100;
    case "HIGH":
      return 80;
    case "MODERATE":
      return 60;
    case "LOW":
      return 40;
    case "POOR":
      return 20;
    default:
      return null;
  }
}

function importHRVJSON(entries: GarminTrainingReadiness[]): number {
  // Deduplicate: per date keep highest RMSSD (to prefer more accurate entries)
  const byDate = new Map<string, { rmssd: number; score: number | null }>();

  for (const entry of entries) {
    const date = entry.calendarDate ? isoToDate(entry.calendarDate) : null;
    if (!date) continue;

    const rmssd = entry.hrvWeeklyAverage ?? null;
    if (rmssd === null || rmssd === HRV_SENTINEL) continue;

    const score = entry.level ? levelToScore(entry.level) : null;
    const existing = byDate.get(date);
    if (!existing || rmssd > existing.rmssd) {
      byDate.set(date, { rmssd, score });
    }
  }

  let count = 0;
  for (const [date, { rmssd, score }] of byDate) {
    execute(`
      INSERT OR REPLACE INTO hrv (date, rmssd, hrv_score, source)
      VALUES (${escapeSQL(date)}, ${escapeSQL(rmssd)}, ${escapeSQL(score)}, 'garmin_archive')
    `);
    count++;
  }
  return count;
}

// ============================================================================
// Training Load importer — MetricsAcuteTrainingLoad_*.json
// ============================================================================

interface GarminTrainingLoadEntry {
  calendarDate?: number; // ms epoch
  dailyTrainingLoadAcute?: number;
  dailyTrainingLoadChronic?: number;
}

function importTrainingLoadJSON(entries: GarminTrainingLoadEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (!entry.calendarDate) continue;
    const date = epochMsToDate(entry.calendarDate);

    const acute = entry.dailyTrainingLoadAcute ?? null;
    const chronic = entry.dailyTrainingLoadChronic ?? null;
    if (acute === null && chronic === null) continue;

    const form = chronic != null && acute != null ? Math.round(chronic - acute) : null;

    execute(`
      INSERT OR REPLACE INTO training_load (date, acute_load, chronic_load, form, source)
      VALUES (${escapeSQL(date)}, ${escapeSQL(acute)}, ${escapeSQL(chronic)}, ${escapeSQL(form)}, 'garmin_archive')
    `);
    count++;
  }
  return count;
}

// ============================================================================
// Athlete metrics — bioMetrics_latest.json
// ============================================================================

interface GarminBioMetricsEntry {
  lactateThresholdHeartRate?: number;
  lactateThresholdSpeed?: number;
}

function updateAthleteFromBioMetrics(entries: GarminBioMetricsEntry[]): boolean {
  let lthr: number | null = null;
  for (const entry of entries) {
    const hr = entry.lactateThresholdHeartRate;
    if (hr != null && hr > 100 && hr < 230) {
      lthr = lthr == null ? hr : Math.max(lthr, hr);
    }
  }
  if (lthr === null) return false;

  execute(`
    UPDATE athlete
    SET lthr = ${lthr}, updated_at = datetime('now')
    WHERE lthr IS NULL OR lthr = 0
  `);
  return true;
}

// ============================================================================
// Date Range Helper
// ============================================================================

function getDateRange(table: string): { from: string | null; to: string | null } {
  try {
    const rows = queryJson<{ min_date: string | null; max_date: string | null }>(
      `SELECT MIN(date) as min_date, MAX(date) as max_date FROM ${table}`
    );
    if (rows.length > 0) return { from: rows[0].min_date, to: rows[0].max_date };
  } catch {
    // table empty or doesn't exist
  }
  return { from: null, to: null };
}

// ============================================================================
// File Type Detection (by filename pattern)
// ============================================================================

type FileType = "sleep" | "hrv" | "training_load" | "bio_metrics" | "unknown";

function detectJSONType(filePath: string): FileType {
  const name = filePath.toLowerCase();
  if (name.includes("sleepdata")) return "sleep";
  if (name.includes("trainingreadinessdto")) return "hrv";
  if (name.includes("metricsacutetrainingload")) return "training_load";
  if (name.includes("biometrics_latest")) return "bio_metrics";
  return "unknown";
}

// ============================================================================
// Main Export
// ============================================================================

export async function importArchive(archivePath: string, verbose = false): Promise<void> {
  log.start(`Reading archive: ${archivePath}`);

  let data: Buffer;
  try {
    data = readFileSync(archivePath);
  } catch {
    log.error(`Cannot read file: ${archivePath}`);
    process.exit(1);
  }

  const zip = await JSZip.loadAsync(data);

  const jsonPaths: string[] = [];
  zip.forEach((path) => {
    if (
      path.toLowerCase().endsWith(".json") &&
      !path.includes("__MACOSX") &&
      detectJSONType(path) !== "unknown"
    ) {
      jsonPaths.push(path);
    }
  });

  log.info(`Found ${jsonPaths.length} relevant JSON files in archive`);

  let sleepCount = 0;
  let hrvCount = 0;
  let trainingLoadCount = 0;
  let athleteUpdated = false;
  const skipped: string[] = [];

  for (const filePath of jsonPaths) {
    const file = zip.file(filePath);
    if (!file) continue;

    const text = await file.async("string");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (verbose) log.warn(`  Skipped (invalid JSON): ${filePath}`);
      continue;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      if (verbose) log.info(`  Skipped (empty): ${filePath}`);
      continue;
    }

    const type = detectJSONType(filePath);

    switch (type) {
      case "sleep": {
        const n = importSleepJSON(parsed as GarminSleepEntry[]);
        sleepCount += n;
        if (n > 0) log.success(`  Sleep: ${n} records ← ${filePath}`);
        break;
      }
      case "hrv": {
        const n = importHRVJSON(parsed as GarminTrainingReadiness[]);
        hrvCount += n;
        if (n > 0) log.success(`  HRV: ${n} records ← ${filePath}`);
        break;
      }
      case "training_load": {
        const n = importTrainingLoadJSON(parsed as GarminTrainingLoadEntry[]);
        trainingLoadCount += n;
        if (n > 0) log.success(`  Training load: ${n} records ← ${filePath}`);
        break;
      }
      case "bio_metrics": {
        athleteUpdated =
          updateAthleteFromBioMetrics(parsed as GarminBioMetricsEntry[]) || athleteUpdated;
        if (verbose) log.info(`  Bio metrics processed ← ${filePath}`);
        break;
      }
      default:
        skipped.push(filePath);
        if (verbose) log.info(`  Skipped (unrecognized): ${filePath}`);
    }
  }

  // Summary
  log.box("Garmin Archive Import — Summary");
  log.info(`Sleep records:         ${sleepCount}`);
  log.info(`HRV records:           ${hrvCount}`);
  log.info(`Training load records: ${trainingLoadCount}`);
  log.info(`Athlete profile:       ${athleteUpdated ? "updated (LTHR)" : "unchanged"}`);
  if (skipped.length > 0 && !verbose) {
    log.info(`Skipped files:         ${skipped.length} (run with --verbose to list them)`);
  }

  const sleepRange = getDateRange("sleep");
  const hrvRange = getDateRange("hrv");
  const today = new Date().toISOString().split("T")[0];

  const snippet = [
    `### Garmin archive import — ${today}`,
    ``,
    `- Sleep: ${sleepCount} records (${sleepRange.from ?? "?"} → ${sleepRange.to ?? "?"})`,
    `- HRV: ${hrvCount} records (${hrvRange.from ?? "?"} → ${hrvRange.to ?? "?"})`,
    `- Training load: ${trainingLoadCount} records`,
    `- Athlete profile updated: ${athleteUpdated ? "yes (LTHR)" : "no"}`,
  ].join("\n");

  console.log("\n" + "=".repeat(60));
  console.log("CLAUDE.md snippet — copy manually to Decisions log:");
  console.log("=".repeat(60));
  console.log(snippet);
  console.log("=".repeat(60) + "\n");
}
