-- Core activity data
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,           -- Strava activity ID
  name TEXT,
  sport_type TEXT,                  -- Run, Ride, Swim, etc.
  start_date TEXT,                  -- ISO 8601 UTC
  elapsed_time INTEGER,             -- seconds
  moving_time INTEGER,              -- seconds
  distance REAL,                    -- meters
  total_elevation_gain REAL,        -- meters
  average_speed REAL,               -- m/s
  max_speed REAL,                   -- m/s
  average_heartrate REAL,
  max_heartrate REAL,
  average_watts REAL,               -- cycling/running power
  max_watts REAL,
  weighted_average_watts REAL,      -- normalized power
  kilojoules REAL,
  suffer_score INTEGER,             -- Strava's relative effort
  average_cadence REAL,
  calories REAL,
  description TEXT,
  workout_type INTEGER,             -- 0=default, 1=race, 2=workout, 3=long run
  gear_id TEXT,
  raw_json TEXT,                    -- full Strava response as JSON
  equivalent_distance_m REAL,       -- flat-equivalent distance: distance + elevation_gain * 10 (100m D+ ≈ 1km flat)
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Time-series streams (HR, power, pace over time)
CREATE TABLE IF NOT EXISTS streams (
  activity_id INTEGER PRIMARY KEY,
  time_data TEXT,                   -- JSON array: seconds from start
  distance_data TEXT,               -- JSON array: cumulative meters
  heartrate_data TEXT,              -- JSON array
  watts_data TEXT,                  -- JSON array
  cadence_data TEXT,                -- JSON array
  altitude_data TEXT,               -- JSON array
  velocity_data TEXT,               -- JSON array: m/s
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Athlete profile
CREATE TABLE IF NOT EXISTS athlete (
  id INTEGER PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  weight REAL,                      -- kg
  ftp INTEGER,                      -- functional threshold power (watts)
  max_heartrate INTEGER,
  lthr INTEGER,                     -- lactate threshold heart rate (bpm)
  threshold_pace_sec_per_km REAL,   -- threshold pace in seconds per km
  profile_source TEXT,              -- 'strava', 'garmin_archive', 'manual'
  raw_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Training goals
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT,                  -- "Ironman 70.3 Oceanside"
  event_date TEXT,                  -- ISO 8601
  event_type TEXT,                  -- triathlon, marathon, ultra, century
  notes TEXT,                       -- constraints, injuries, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

-- Wellness data from Garmin archive (one-shot import)
CREATE TABLE IF NOT EXISTS sleep (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD
  duration_h REAL,                  -- total sleep hours
  quality INTEGER,                  -- 1-5 scale (mapped from Garmin score)
  deep_pct REAL,                    -- % deep sleep
  rem_pct REAL,                     -- % REM sleep
  source TEXT DEFAULT 'garmin_archive'
);

CREATE TABLE IF NOT EXISTS hrv (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD
  rmssd REAL,                       -- root mean square of successive differences (ms)
  hrv_score INTEGER,                -- Garmin HRV status score (0-100)
  source TEXT DEFAULT 'garmin_archive'
);

CREATE TABLE IF NOT EXISTS training_load (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD
  acute_load REAL,                  -- 7-day acute training load
  chronic_load REAL,                -- 42-day chronic training load
  form REAL,                        -- form = chronic - acute (positive = fresh)
  source TEXT DEFAULT 'garmin_archive'
);

-- Optional morning check-in (user-initiated, not daily)
CREATE TABLE IF NOT EXISTS morning_checkin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,               -- YYYY-MM-DD
  sleep_hours REAL,                 -- subjective sleep duration
  sleep_quality INTEGER,            -- 1-5
  legs INTEGER,                     -- perceived leg fatigue 1-5 (1=heavy, 5=fresh)
  energy INTEGER,                   -- overall energy 1-5
  motivation INTEGER,               -- motivation to train 1-5
  stress INTEGER,                   -- stress level 1-5 (1=calm, 5=high stress)
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  completed_at TEXT,
  activities_synced INTEGER,
  status TEXT                       -- success, failed, partial
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(start_date);
CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
CREATE INDEX IF NOT EXISTS idx_activities_sport_date ON activities(sport_type, start_date);

-- Useful views
DROP VIEW IF EXISTS weekly_volume;
CREATE VIEW weekly_volume AS
SELECT
  strftime('%Y-W%W', start_date) AS week,
  sport_type,
  COUNT(*) AS sessions,
  ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
  ROUND(SUM(distance) / 1000.0, 1) AS km,
  ROUND(AVG(average_heartrate), 0) AS avg_hr,
  ROUND(AVG(suffer_score), 0) AS avg_effort
FROM activities
GROUP BY week, sport_type
ORDER BY week DESC, sport_type;

DROP VIEW IF EXISTS recent_activities;
CREATE VIEW recent_activities AS
SELECT
  date(start_date) AS date,
  sport_type,
  name,
  moving_time / 60 AS minutes,
  ROUND(distance / 1000.0, 1) AS km,
  ROUND(average_heartrate, 0) AS hr,
  suffer_score
FROM activities
ORDER BY start_date DESC
LIMIT 50;
