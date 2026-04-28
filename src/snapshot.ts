import { queryJson } from "./db/client.js";
import { ensureConfigDir, getSnapshotPath } from "./lib/config.js";
import { writeFileSync } from "fs";

interface AthleteRow {
  firstname: string | null;
  lastname: string | null;
  weight: number | null;
  max_heartrate: number | null;
  lthr: number | null;
}

interface WeeklyRunRow {
  week: string;
  sessions: number;
  flat_km: number;
  dplus_m: number;
  efd_km: number;
  hours: number;
}

interface LoadRow {
  acute_load: number | null;
  chronic_load: number | null;
  form: number | null;
}

interface AvgRow {
  avg_val: number | null;
}

interface LastSleepRow {
  duration_h: number;
  quality: number;
}

export interface RecentRun {
  date: string;
  name: string;
  flat_km: number;
  dplus_m: number;
  efd_km: number;
  avg_hr: number | null;
  minutes: number;
}

export interface CheckinRow {
  date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  legs: number | null;
  energy: number | null;
  motivation: number | null;
  stress: number | null;
  notes: string | null;
}

export interface WeeklyStats {
  week: string;
  sessions: number;
  flat_km: number;
  dplus_m: number;
  efd_km: number;
  hours: number;
}

export interface AthleteSnapshot {
  generatedAt: string;
  athlete: {
    name: string;
    weight_kg: number | null;
    hrMax: number | null;
    lthr: number | null;
  };
  rolling4w: WeeklyStats[];
  acuteChronicLoad: {
    acute: number | null;
    chronic: number | null;
    form: number | null;
    ratio: number | null;
  };
  sleepTrend: {
    avg7d_h: number | null;
    avg28d_h: number | null;
    lastNight: { duration_h: number; quality: number } | null;
  };
  hrvTrend: {
    avg7d: number | null;
    avg28d: number | null;
    trend: "rising" | "stable" | "falling" | "unknown";
  };
  recentKeyRuns: RecentRun[];
  morningCheckin: CheckinRow | null;
  readinessFlags: string[];
}

function computeHrvTrend(
  avg7d: number | null,
  avg28d: number | null
): "rising" | "stable" | "falling" | "unknown" {
  if (avg7d == null || avg28d == null || avg28d === 0) return "unknown";
  const ratio = avg7d / avg28d;
  if (ratio > 1.03) return "rising";
  if (ratio < 0.97) return "falling";
  return "stable";
}

function computeFlags(
  load: AthleteSnapshot["acuteChronicLoad"],
  sleep: AthleteSnapshot["sleepTrend"],
  hrv: AthleteSnapshot["hrvTrend"],
  checkin: CheckinRow | null
): string[] {
  const flags: string[] = [];

  if (load.ratio != null && load.ratio > 1.3) {
    flags.push(`Charge aiguë élevée (ratio ATL/CTL ${load.ratio.toFixed(2)}) — risque surmenage`);
  }

  if (hrv.trend === "falling") {
    flags.push("HRV en chute (moy. 7j < moy. 28j) — surveiller la récupération");
  }

  if (sleep.avg7d_h != null && sleep.avg7d_h < 6.5) {
    flags.push(`Déficit sommeil (moy. 7j : ${sleep.avg7d_h}h/nuit)`);
  }

  if (load.form != null && load.form < -15) {
    flags.push(`Fatigue accumulée (TSB ${load.form}) — forme en creux`);
  }

  if (load.form != null && load.form > 10) {
    flags.push(`Bonne forme (TSB +${load.form}) — fenêtre de performance`);
  }

  if (checkin) {
    if (checkin.legs != null && checkin.legs <= 2) {
      flags.push(`Jambes lourdes au check-in (${checkin.legs}/5) — éviter séance D+ exigeante`);
    }
    if (checkin.energy != null && checkin.energy <= 2) {
      flags.push(`Énergie basse au check-in (${checkin.energy}/5)`);
    }
  }

  return flags;
}

export function generateSnapshot(): AthleteSnapshot {
  // 1. Athlete profile
  const athleteRows = queryJson<AthleteRow>(
    "SELECT firstname, lastname, weight, max_heartrate, lthr FROM athlete LIMIT 1"
  );
  const a = athleteRows[0];

  // 2. Rolling 4-week run volume by week
  const weeklyStats = queryJson<WeeklyRunRow>(`
    SELECT
      strftime('%Y-W%W', start_date) AS week,
      COUNT(*) AS sessions,
      ROUND(SUM(distance) / 1000.0, 1) AS flat_km,
      ROUND(COALESCE(SUM(total_elevation_gain), 0), 0) AS dplus_m,
      ROUND(COALESCE(SUM(equivalent_distance_m), SUM(distance)) / 1000.0, 1) AS efd_km,
      ROUND(SUM(moving_time) / 3600.0, 1) AS hours
    FROM activities
    WHERE sport_type IN ('Run', 'TrailRun', 'Trail Run', 'VirtualRun')
      AND start_date >= date('now', '-4 weeks')
    GROUP BY week
    ORDER BY week DESC
  `);

  // 3. Latest training load from Garmin archive
  const loadRows = queryJson<LoadRow>(
    "SELECT acute_load, chronic_load, form FROM training_load ORDER BY date DESC LIMIT 1"
  );
  const load = loadRows[0] ?? { acute_load: null, chronic_load: null, form: null };
  const ratio =
    load.acute_load != null && load.chronic_load != null && load.chronic_load > 0
      ? Math.round((load.acute_load / load.chronic_load) * 100) / 100
      : null;

  // 4. Sleep trend
  const sleep7d = queryJson<AvgRow>(
    "SELECT ROUND(AVG(duration_h), 1) AS avg_val FROM sleep WHERE date >= date('now', '-7 days')"
  );
  const sleep28d = queryJson<AvgRow>(
    "SELECT ROUND(AVG(duration_h), 1) AS avg_val FROM sleep WHERE date >= date('now', '-28 days')"
  );
  const lastSleep = queryJson<LastSleepRow>(
    "SELECT duration_h, quality FROM sleep ORDER BY date DESC LIMIT 1"
  );

  // 5. HRV trend (RMSSD)
  const hrv7d = queryJson<AvgRow>(
    "SELECT ROUND(AVG(rmssd), 1) AS avg_val FROM hrv WHERE date >= date('now', '-7 days')"
  );
  const hrv28d = queryJson<AvgRow>(
    "SELECT ROUND(AVG(rmssd), 1) AS avg_val FROM hrv WHERE date >= date('now', '-28 days')"
  );
  const avg7dHrv = hrv7d[0]?.avg_val ?? null;
  const avg28dHrv = hrv28d[0]?.avg_val ?? null;

  // 6. Recent key runs (last 5 runs, last 4 weeks)
  const recentRuns = queryJson<RecentRun>(`
    SELECT
      date(start_date) AS date,
      name,
      ROUND(distance / 1000.0, 1) AS flat_km,
      ROUND(COALESCE(total_elevation_gain, 0), 0) AS dplus_m,
      ROUND(COALESCE(equivalent_distance_m, distance) / 1000.0, 1) AS efd_km,
      ROUND(average_heartrate, 0) AS avg_hr,
      ROUND(moving_time / 60.0, 0) AS minutes
    FROM activities
    WHERE sport_type IN ('Run', 'TrailRun', 'Trail Run')
      AND start_date >= date('now', '-4 weeks')
    ORDER BY start_date DESC
    LIMIT 5
  `);

  // 7. Latest morning check-in (< 48h)
  const checkinRows = queryJson<CheckinRow>(
    `SELECT date, sleep_hours, sleep_quality, legs, energy, motivation, stress, notes
     FROM morning_checkin
     WHERE date >= date('now', '-2 days')
     ORDER BY created_at DESC
     LIMIT 1`
  );
  const checkin = checkinRows[0] ?? null;

  const sleepTrend: AthleteSnapshot["sleepTrend"] = {
    avg7d_h: sleep7d[0]?.avg_val ?? null,
    avg28d_h: sleep28d[0]?.avg_val ?? null,
    lastNight: lastSleep[0] ?? null,
  };

  const acuteChronicLoad: AthleteSnapshot["acuteChronicLoad"] = {
    acute: load.acute_load,
    chronic: load.chronic_load,
    form: load.form,
    ratio,
  };

  const hrvTrend: AthleteSnapshot["hrvTrend"] = {
    avg7d: avg7dHrv,
    avg28d: avg28dHrv,
    trend: computeHrvTrend(avg7dHrv, avg28dHrv),
  };

  const readinessFlags = computeFlags(acuteChronicLoad, sleepTrend, hrvTrend, checkin);

  const snapshot: AthleteSnapshot = {
    generatedAt: new Date().toISOString(),
    athlete: {
      name: a ? `${a.firstname ?? ""} ${a.lastname ?? ""}`.trim() : "Julien",
      weight_kg: a?.weight ?? null,
      hrMax: a?.max_heartrate ?? null,
      lthr: a?.lthr ?? null,
    },
    rolling4w: weeklyStats,
    acuteChronicLoad,
    sleepTrend,
    hrvTrend,
    recentKeyRuns: recentRuns,
    morningCheckin: checkin,
    readinessFlags,
  };

  ensureConfigDir();
  writeFileSync(getSnapshotPath(), JSON.stringify(snapshot, null, 2));

  return snapshot;
}
