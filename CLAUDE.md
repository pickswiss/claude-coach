# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Langue

Réponds toujours en français dans ce projet.

## Règle de modification du plan d'entraînement

Plan actif : `data/annecy-marathon-2027.json` (source unique de vérité, versionné).
HTML de consultation : `data/annecy-marathon-2027.html` (versionné aussi).
Archive : `data/wild25-2026.{json,html}` (course terminée, ne plus modifier).

À chaque modification du plan, l'agent DOIT dans cet ordre :

1. Éditer le JSON du plan actif (jamais `~/.claude-coach/`)
2. Régénérer le HTML : `node dist/cli.js render data/annecy-marathon-2027.json --output=data/annecy-marathon-2027.html`
3. Vérifier le HTML généré (voir ci-dessous) avant d'annoncer la modif faite
4. `git add data/ && git commit` avec un message décrivant le changement de plan

Ne jamais annoncer "fait" sans avoir exécuté les étapes 2 et 3. Si une vérification échoue : ne rien commiter, expliquer ce qui cloche.

### Vérifications du HTML (étape 3)

Toujours parser le JSON embarqué (`<script type="application/json" id="plan-data">`) plutôt que grepper le texte brut :

- **JSON embarqué identique au JSON source** (comparaison après parse).
- **`meta.revision`** correspond à la version annoncée. Elle est bumpée dans le même geste que tout changement de contenu : un plan dont la révision ne correspond pas à son contenu est indétectable en aval — toutes les autres vérifications passent, et c'est la seule identité que le fichier porte sur lui-même.
- **Nom de fichier par version** : chaque version livrée porte un nom de fichier distinct, jamais réutilisé (ex. `plan-annecy-2027-v2.5.json`). Dans le dépôt, le chemin `data/annecy-marathon-2027.json` reste stable ; c'est l'historique git qui distingue les versions.
- **Viewer à jour** : le HTML contient `IntersectionObserver` et « Aujourd'hui » (repères temporels, commit f0ad9de). Ne pas se fier à « décembre » : le mot peut venir du contenu du plan. Si absent → `npm run build:viewer` puis re-rendre. `templates/plan-viewer.html` est gitignoré : il n'est jamais dans un commit, seul le build local compte.
- **Taille** : ~850 Ko pour un rendu CLI brut. `data/*.html` est exclu de Prettier (`.prettierignore`), donc le fichier commité n'est plus reformaté (l'ancien ~1,7 Mo venait du reformatage). Une taille très inférieure = rendu tronqué.
- **Contrôles spécifiques** à la modification demandée (durées, dates, champs nutrition…), en énumérant toutes les séances concernées, pas seulement la première.

## Sources de données

- **intervals.icu = source principale** (via serveur MCP `intervals-icu`, hhopke/intervals-icu-mcp, scope user). Synchronisé avec Garmin Connect (activités + wellness : sommeil, HRV, FC repos) et calcule CTL/ATL/TSB de manière cohérente.
  - Identifiants : variables `INTERVALS_ICU_API_KEY` et `INTERVALS_ICU_ATHLETE_ID` dans la config MCP user (`claude mcp add intervals-icu -s user -e … -- uvx intervals-icu-mcp`), à saisir dans un terminal à part. Le serveur ne relit ses variables qu'au redémarrage de Claude Code. Il n'existe pas de commande `icu-mcp-auth`.
  - Statut au 2026-09-28 : **source validée** (voir decisions log). Import historique Garmin complet : comparaison 01.07→28.09 conforme à Strava (14/14 activités, distance identique, FC ±2 bpm, temps total identique ; seuls écarts : temps en mouvement dû à l'auto-pause et D+). Le volume bas de l'été est réel : Garmin Connect ne contient rien de plus (vérifié par Julien), base Strava locale sans trou (fenêtre 730 j, scope `activity:read_all`). Pendant la phase 1, en attendant le redémarrage de Claude Code après changement de clé, la lecture peut se faire en GET direct sur l'API (clé lue depuis la config MCP, jamais affichée).
  - **Écart de D+ intervals.icu vs Strava** : intervals.icu (Garmin, altimètre barométrique) donne un D+ souvent plus élevé que Strava (recalcul sur modèle de terrain, lissé) : jusqu'à +25 % (16.08 : 941 → 1181 m ; Wild 25 : 1213 → 1309 m, officiel 1200). L'EFD (distance + D+ × 10) sera donc plus élevée côté intervals.icu : ne pas comparer directement des EFD d'avant et d'après la migration sans en tenir compte.
  - Migration : phase 1 = bilans lus directement via le MCP pendant la validation. Snapshot final : option B privilégiée (commande CLI qui remplit la base locale, clé hors dépôt dans `~/.claude-coach/`) pour la base locale, le viewer, les tests et l'historique. Décision à trancher après 2 à 4 semaines d'usage.
  - **Zones FC : le plan et intervals.icu ne se lisent pas pareil.** Le plan calcule ses zones en % de réserve cardiaque (max 189, repos 43) ; intervals.icu les dérive du seuil (FTHR 171 pour la course) : Z1 0–144, Z2 145–152, Z3 153–161, Z4 162–170, Z5 171–175. Le Z2 du plan (131–148, plafond unique depuis la v2.9 pour footings et longues) correspond donc au **Z1 d'intervals.icu**, plus le bas de son Z2 (145–148). Un footing bien exécuté apparaît surtout en Z1 dans intervals.icu : ce n'est pas une séance trop facile. Le Z4 du plan (160–170) recouvre presque le Z4 intervals.icu.
  - Lecture seule par défaut : aucune écriture dans intervals.icu (events, activités, workouts, wellness) sans validation explicite de Julien.
  - Clé API : jamais affichée, loggée ni écrite dans un fichier du dépôt.
- **Pipeline Garmin direct : abandonné.** MCP Garmin bloqué par le SSO (voir decisions log), import d'archive one-shot figé au 2026-04-26. La table `training_load` (unités Garmin, source du TSB +125) ne doit plus être utilisée pour le coaching.
- **Strava : en sursis.** intervals.icu est validé depuis le 2026-09-28, mais Strava reste en place (`sync`, table `activities`, `rolling4w`) jusqu'à la décision sur le snapshot final (option B, après 2 à 4 semaines de phase 1) et la phase de retrait. Ne pas le retirer sans validation explicite de Julien ; corriger ses bugs reste autorisé.

## Envoi intervals.icu

Règles validées le 2026-10-06 pour envoyer les séances planifiées au calendrier intervals.icu (catégorie WORKOUT). Toute écriture reste soumise à validation explicite de Julien (voir « Lecture seule par défaut »).

- **Footings et sorties Z2** : une seule étape, cible en % FC max, ex. `- 30m 69-78% HR` (69–78 % de 189 ≈ 131–148 bpm). La syntaxe en bpm (`131-148bpm`, avec ou sans `HR`) n'est pas parsée par intervals.icu : l'étape est créée sans cible.
- **Séances avec allure** : allures absolues `x:xx/km Pace` (ex. `- 1km 4:45/km Pace`, `- 10m 6:00-5:40/km Pace`), durée ou distance toujours avant la cible.
- **Natation** : type Swim, distances en `mtr` (`m` = minutes), allures en /100m (ex. `- 200mtr 2:35/100m Pace`).
- **Renfo** : type WeightTraining, détail des exercices dans la description, sans cibles.
- **Bug MCP** : le seuil d'allure course est renvoyé en m/s et affiché à tort en min:sec par le serveur MCP (3,33 m/s = 5:00/km, affiché « 3:20 /km »). Ne pas le « corriger ». Le seuil natation (0,833 m/s = 2:00/100m) s'affiche correctement.
- **Toujours** : récapitulatif (date, nom, type, durée, texte workout) avant création et attente du OK ; vérifier le calendrier pour n'avoir aucun doublon ; après création, relire `workout_doc` et vérifier que chaque étape a sa cible. `workout_parsed: true` renvoyé par le MCP ne suffit pas : il est vrai même quand la cible a sauté.
- **Ne jamais inventer** d'échauffement, de découpage ou d'allure absents du plan sans le signaler.

## Decisions log

### 2026-09-28 — intervals.icu validé comme source principale

- Comparaison intervals.icu vs base Strava locale sur 01.07→28.09 : 14/14 activités appariées, distances et temps totaux identiques, FC moyenne et max à ±2 bpm.
- Écarts connus : temps en mouvement (auto-pause, 2 activités) ; D+ plus élevé côté intervals.icu (baromètre Garmin), jusqu'à +25 %, d'où une EFD plus élevée.
- Volume bas (14 activités) confirmé réel : rien de plus dans Garmin Connect, pas de trou dans la base Strava.
- CTL/ATL/TSB intervals.icu cohérents (TSB +6 au 2026-09-28 en fin de récup), en remplacement du TSB Garmin `training_load` (+125).
- Suite : phase 1 (bilans via MCP) pendant 2 à 4 semaines, puis décision snapshot (option B privilégiée), puis retrait Strava/Garmin sur validation explicite.

### 2026-04-26 — Import archive Garmin (one-shot)

- Sleep: 34 records (2026-02-11 → 2026-04-26)
- HRV: 37 records (2026-02-26 → 2026-04-26)
- Training load: 97 records
- Athlete profile updated: yes (LTHR)

### 2026-04-26 — Abandon de l'intégration Garmin MCP automatique

**Package abandonné :** `@etweisberg/garmin-connect-mcp` v0.1.22 ([@etweisberg](https://github.com/etweisberg/garmin-connect-mcp))

**Raison :** Garmin bloque la soumission du formulaire SSO côté serveur ("AN UNEXPECTED ERROR HAS OCCURRED" après clic sur Sign In). Le problème est côté Garmin, pas côté package. Pas d'issue GitHub correspondante, pas de contournement disponible au moment de l'abandon.

**Alternative adoptée :** Import one-shot via export ZIP manuel depuis Garmin Connect (commande `claude-coach garmin import-archive <path.zip>`). Strava reste la source pérenne pour les activités.

## Contexte du fork

Ce dépôt est un fork personnel de claude-coach, adapté à l'athlète suivant :

```json
{
  "$schema": "athlete-profile.v1",
  "lastUpdated": "2026-04-26",

  "identity": {
    "name": "Julien",
    "language": "fr",
    "household": {
      "adults": 2,
      "children": 1,
      "mealsPlannedFor": 3
    }
  },

  "athlete": {
    "type": "amateur_endurance",
    "philosophy": "wellbeing_happiness_not_elite_performance",
    "selfCoached": true,
    "weeklyRunSessions": 3,
    "complementaryActivities": ["pilates", "yoga", "stretching"],
    "mandatoryAdditions": ["home_strength_minimum_1x_week"],
    "plannedAdditions": ["swimming_indoor_autumn_winter"],
    "notPlanned": ["cycling", "home_trainer"]
  },

  "physiology": {
    "weight_kg": 84.8,
    "weightTrend": "losing_5kg_since_january_peak_90kg",
    "height_cm": 184,
    "hrMax": 186,
    "hrMax_source": "manual_known_value",
    "lthr": 170,
    "lthr_source": "garmin_estimated_from_archive_2026-04",
    "thresholdPace_min_per_km": null,
    "ftp_watts": null,
    "swimBackground": "7_years_water_polo_solid_base"
  },

  "nutrition": {
    "macroTargets": {
      "protein_g_per_kg": 1.7,
      "protein_g_total": 144,
      "fat_g_per_kg": 1.0,
      "fat_g_total": 85,
      "carbs_periodized": {
        "rest_day_g_per_kg": 3.5,
        "moderate_training_g_per_kg": 6.0,
        "intense_training_g_per_kg": 7.5
      }
    },
    "habitualBreakfast": {
      "name": "Bircher muesli optimisé",
      "note": "Base établie — développer d'autres options faciles et week-end",
      "ingredients": [
        { "item": "Yaourt grec", "g": 200 },
        { "item": "Muesli sans sucre", "g": 50 },
        { "item": "Graines de chia", "g": 10 },
        { "item": "Whey chocolat Sponser", "g": 15 },
        { "item": "Granola", "g": 20 },
        { "item": "Fruits frais", "g": 100 },
        { "item": "Confiture maison ou miel", "g": "10 ou 5" },
        { "item": "Mélange noix (au service)", "g": 15 }
      ]
    },
    "snacks": [
      { "item": "Figues séchées", "context": "encas après-midi" },
      { "item": "Dattes", "context": "encas après-midi" }
    ],
    "fueling": {
      "raceAid": "banane aux ravitaillements",
      "gelStrategy": {
        "early": "Overstims Energix",
        "mid": "Overstims Antioxydant",
        "late": "Overstims Coup de fouet",
        "finalKm": "Overstims Red Tonic (caféine)"
      }
    },
    "preferences": {
      "approach": "ingredient_driven_not_idealized",
      "evening": "lighter_easily_digestible",
      "trainingDay": "higher_carb"
    }
  },

  "goals": {
    "completed": [
      {
        "name": "Marathon Paris",
        "date": "2026-04-12",
        "result": "3h49'10''",
        "target": "sub_4h",
        "achieved": true,
        "context": "rhume avec fièvre 2 semaines avant, taper protégé"
      }
    ],
    "current": {
      "phase": "reprise_post_marathon",
      "status": "semaine_4_reprise_progressive",
      "context": "semaines_2_et_3_amputees_hanche_laterale_TFL_irritation_mecanique_marche_job",
      "plan": "2_footings_25_30min_facile_plus_1_renfo_au_ressenti_semaine_4"
    },
    "next": {
      "name": "Wild 25",
      "date": "2026-09-13",
      "event": "Wildstrubel 2026",
      "location": "Crans-Montana",
      "type": "trail_alpine",
      "distance_km": 26,
      "dplus_m": 1200,
      "efd_km": 38
    },
    "philosophy": "beautiful_races_for_wellbeing_not_elite_performance",
    "ideasPool": [
      "Semi-marathon Aletsch (refaire en bonne condition)",
      "Trails alpins reconnus, beaux parcours",
      "Semi-marathons plaisir"
    ],
    "horizon2027": {
      "status": "open_decision_late_2026",
      "options": ["Sierre-Zinal (si job compatible)", "marathon", "autre course belle"],
      "constraint": "festival_pro_une_semaine_avant_sierre_zinal_incompatible_job_actuel"
    }
  },

  "equipment": {
    "owned": ["pull_up_bar", "foam_rollers"],
    "consideringAcquisition": ["kettlebell"],
    "available": ["piscine_publique_sion"],
    "swimmingNote": "piscine_interieure_preferee_disponible_automne_hiver_uniquement"
  },

  "coachingPreferences": {
    "tone": "motivating_grounded_no_flattery_no_alarm",
    "communicationStyle": "casual_french",
    "responseFormat": "concise_concrete",
    "adaptability": "approximate_after_baseline",
    "treatStatedConstraintsAs": "firm",
    "respectsSelfCorrection": true
  },

  "tooling": {
    "current": ["Runna", "Garmin Connect", "Strava"],
    "target": ["claude-coach-fork", "Garmin Connect"],
    "toRetire": ["Runna", "Strava Premium", "Foodvisor"]
  }
}
```

## Project Overview

Claude Coach is an end-to-end training plan generation and management tool for endurance athletes. It has three main components:

1. **CLI Tool** (`src/cli.ts`): Node.js command-line tool that syncs Strava activity data via OAuth, queries the local SQLite database, and renders training plans to HTML.
2. **Claude Skill** (`skill/SKILL.md`): A conversational skill for Claude.ai/Claude Code that guides users through creating personalized training plans by analyzing their fitness data.
3. **Viewer/Web App** (`src/viewer/`): A browser-based Svelte application embedded in a single HTML file that allows users to view, edit, and export training plans (to ZWO, FIT, MRC, or iCalendar formats).

The project is published as an npm package and distributed as a downloadable skill zip file.

## Build & Development Commands

### Core Build

```bash
npm run build              # Build everything (TypeScript, viewer, skill)
npm run build:ts           # Compile TypeScript to dist/
npm run build:viewer       # Build Svelte viewer to templates/plan-viewer.html
npm run build:skill        # Package skill/ directory to dist/coach-skill.zip
npm run build:website      # Build documentation website
```

### Development

```bash
npm start                  # Run CLI directly with tsx (watches for changes)
npm run dev                # Watch and recompile CLI on file changes
npm run dev:viewer         # Dev server for viewer (Vite on localhost:5173)
npm run typecheck          # Run TypeScript type checking
npm run format             # Format code with Prettier
npm run format:check       # Check formatting without changing files
```

### Testing

```bash
npm test                   # Run tests in watch mode
npm run test:run           # Run tests once and exit
```

Tests are located in `tests/` and use Vitest. Test files end in `.test.ts`. Single test files can be run with:

```bash
npx vitest run tests/cli/config.test.ts
npx vitest tests/cli/config.test.ts    # Watch mode
```

### Before Committing

The pre-commit hook (`.husky/pre-commit`) runs:

1. TypeScript type checking
2. Prettier formatting check via lint-staged

If either fails, the commit is blocked. Run `npm run typecheck` and `npm run format` to fix issues.

## Architecture & Key Files

### Database Layer

- **Schema** (`src/db/schema.sql`): SQLite schema with tables for activities, athlete profile, goals, and sync metadata. Includes views for common queries (weekly_volume, recent_activities).
- **Client** (`src/db/client.ts`): Abstraction over SQLite, supporting both Node.js 22.5+ built-in SQLite and fallback to CLI (`sqlite3` command).
- **Migration** (`src/db/migrate.ts`): Runs schema.sql on startup to initialize database.

### CLI Architecture

The CLI (`src/cli.ts`) has five commands, all implemented in a single file:

1. **sync**: Fetches Strava activities via OAuth (opens browser) or token-based auth. Stores activities and athlete data in SQLite.
2. **auth**: Generates OAuth authorization URL for headless environments. Handles callback URL parsing to extract authorization code.
3. **render**: Converts a training plan JSON file to an HTML file by embedding it in the `templates/plan-viewer.html` template.
4. **query**: Runs raw SQL against the database, with optional JSON output.
5. **help**: Shows command documentation.

Argument parsing is custom (no framework) with `--flag=value` syntax.

### Strava Integration

- **OAuth** (`src/strava/oauth.ts`): Handles token refresh, local browser-based redirect server (port 8765).
- **API** (`src/strava/api.ts`): Fetches athlete profile and activities with automatic retry on 429 rate limits.
- **Types** (`src/strava/types.ts`): TypeScript definitions for Strava API responses.

### Training Plan Schema

- **Types** (`src/schema/training-plan.ts`): Complete TypeScript schema for training plans. Includes:
  - Athlete fitness assessment (foundation, current form, strengths, limiters, constraints)
  - Training zones (heart rate, power, pace, swim)
  - Weekly structure with daily workouts
  - Structured workouts (intervals, steps with intensity/duration) for device export
  - Race strategy with pacing, nutrition, taper
  - Periodization phases

### Config & State Management

- **Config** (`src/lib/config.ts`): Stores Strava credentials and tokens in `~/.claude-coach/config.json` and `~/.claude-coach/tokens.json`. Database is `~/.claude-coach/coach.db`.
- **Logging** (`src/lib/logging.ts`): Wrapper around consola for colored console output.

### Viewer (Web App)

The viewer is a Svelte 5 app that renders training plans in the browser:

- **App.svelte**: Main component managing modals, filters, completion state, settings persistence.
- **Stores**:
  - `plan.ts`: Reads embedded JSON from `#plan-data` script tag in HTML.
  - `changes.ts`: Tracks user edits (workout modifications, new workouts).
  - `settings.ts`: User preferences (theme, distance units, first day of week).
- **Components**:
  - `Sidebar.svelte`: Week navigation, summary stats, settings.
  - `WeeksContainer.svelte` & `WeekCard.svelte`: Week/day layout.
  - `WorkoutCard.svelte`: Individual workout display.
  - `WorkoutModal.svelte`: Edit/create workouts.
  - `SettingsModal.svelte`: Unit preferences, theme, zones.
  - `ImportHelpModal.svelte`: Instructions for importing to Zwift, Garmin, TrainingPeaks.
- **Export**: Multiple exporters in `lib/export/`:
  - `zwo.ts`: Zwift workout format (bike/run only).
  - `fit.ts`: Garmin FIT format (uses Garmin FITSDK).
  - `erg.ts`: MRC/ERG format for indoor trainers (bike only).
  - `ics.ts`: iCalendar format for all workouts.

### Build Pipeline

- **TypeScript**: Target ES2022, strict mode, outputs to `dist/`.
- **Vite**: Builds viewer app to a single HTML file in `templates/plan-viewer.html` using `vite-plugin-singlefile`.
- **Skill Packaging**: `skill/` directory zipped to `dist/coach-skill.zip` for distribution via GitHub Releases.

## Key Dependencies

- **@garmin/fitsdk**: FIT file generation for Garmin Connect.
- **jszip**: Zip file creation (used in exports).
- **undici**: HTTP client with proxy support.
- **svelte**: UI framework for viewer.
- **vite**: Build tool for viewer.
- **vitest**: Test runner and assertion library.
- **prettier**: Code formatting.
- **husky & lint-staged**: Pre-commit hooks for type checking and formatting.

## Important Implementation Details

### Token Refresh

The Strava OAuth module automatically refreshes access tokens when they expire (checked before each API call). Refresh tokens are stored locally and used to obtain new access tokens.

### Activity Syncing

Activities are fetched in batches of 100 with pagination. The sync stores complete raw JSON in the `raw_json` column for future processing. Athlete weight and FTP are also captured for zone calculations.

### Training Plan Export

Exports are handled client-side in the browser. ICS files export all workouts as calendar events. ZWO/FIT files use structured workout data (intensity targets, durations, intervals) for device-compatible formats.

### Database Flexibility

The database layer (`src/db/client.ts`) can use either Node.js 22.5+ built-in SQLite or shell out to the `sqlite3` CLI command. This ensures compatibility across Node versions and CI environments where native modules may not be available.

## Release Process

See `RELEASING.md` for detailed steps. Summary:

1. Update version with `npm version [patch|minor|major]` (creates git commit and tag).
2. Run `npm run build:viewer && npm run build:skill` to build artifacts.
3. Publish to npm with `npm publish`.
4. Push to GitHub with `git push origin main --tags`.
5. Create GitHub Release with skill zip as an attachment.

## Viewer HTML Template

The viewer is embedded as a single HTML file in `templates/plan-viewer.html`. This file:

- Contains the complete Svelte app (bundled with Vite's singlefile plugin).
- Has a `<script type="application/json" id="plan-data">` tag where the training plan JSON is injected.
- Is generated by the build process and committed to the repository.

The CLI's `render` command reads a training plan JSON file and replaces the plan-data script tag to create a standalone HTML file.

## Working with the Skill

The `skill/SKILL.md` file documents how the Claude Coach skill works within Claude.ai and Claude Code. Key points:

- The skill guides users through connecting Strava or providing fitness data manually.
- It generates personalized training plans based on athlete assessment, constraints, and event.
- It uses reference documentation in `skill/reference/` for training principles (zones, periodization, race strategy, etc.).
- The skill runs the CLI commands (`sync`, `render`) to fetch data and generate outputs.
