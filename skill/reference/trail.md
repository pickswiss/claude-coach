# Trail & Mountain Running

## Equivalent Flat Distance (EFD)

Trail activities are assessed using **EFD** rather than raw distance. EFD normalises elevation gain into flat-equivalent effort:

```
EFD (m) = distance_m + elevation_gain_m × 10
```

This is pre-computed and stored as `equivalent_distance_m` for every activity in the database. **Always use EFD** when comparing runs across different terrain or setting weekly volume targets.

**Examples:**

- 10 km flat → EFD 10 km
- 10 km + 500 m D+ → EFD 15 km
- 10 km + 1000 m D+ → EFD 20 km
- 26 km + 1200 m D+ → EFD 38 km (Wild 25 race distance)

**When querying trail volume, always include EFD:**

```sql
SELECT
  strftime('%Y-W%W', start_date) AS week,
  COUNT(*) AS sessions,
  ROUND(SUM(distance) / 1000.0, 1) AS flat_km,
  ROUND(SUM(total_elevation_gain), 0) AS total_dplus,
  ROUND(SUM(equivalent_distance_m) / 1000.0, 1) AS efd_km
FROM activities
WHERE sport_type IN ('Run', 'TrailRun', 'Trail Run', 'Hike')
  AND start_date >= date('now', '-8 weeks')
GROUP BY week
ORDER BY week DESC;
```

---

## Trail Load Model

For trail/mountain athletes, weekly load is tracked in **two dimensions**:

1. **EFD km/week** — flat-equivalent running volume
2. **Weekly D+ (metres of climb)** — vertical load

These can diverge: a 40 EFD km/week athlete on flat roads trains very differently from a 40 EFD km/week athlete in the mountains.

### D+ Scaling Rules

| D+/week     | Load tier | Notes                                           |
| ----------- | --------- | ----------------------------------------------- |
| < 500 m     | Flat      | Road marathon equivalent                        |
| 500–1500 m  | Moderate  | Accessible trails, rolling hills                |
| 1500–3000 m | Hilly     | Regular trail running, moderate mountain access |
| 3000–5000 m | Mountain  | Significant weekly mountain sessions            |
| > 5000 m    | Alpine    | Elite mountain athlete territory                |

### Recovery multiplier

Mountain runs require more recovery than road runs. When scheduling the week after a session with > 800 m D+, apply a **1.5× recovery multiplier** (same as if it had taken 50% longer).

---

## Wild 25 — Race Profile

**Event:** Wild 25 (Wildstrubel 2026)
**Date:** Dimanche 13 septembre 2026
**Location:** Crans-Montana, Valais suisse
**Specs officiels:** 26 km / 1200 m D+ / ~600 m D−
**EFD:** 26 + 12 = **38 km flat-equivalent**
**Terrain:** Alpine single-track, sections techniques, possible névés en altitude
**Altitude:** ~1500–2900 m
**Durée estimée:** 3h00–4h30 selon forme

### Key Race Demands

- Effort soutenu sur 2 ascensions principales
- Course en altitude modérée (1500–2900 m) — effort perçu accru
- Contrôle en descente technique (quadriceps, cheville)
- Autonomie entre ravitaillements
- Gestion thermique variable (froid en altitude, chaud en vallée)

### Target Race Readiness Benchmarks

Avant Wild 25, avoir validé :

- Au moins **une sortie ≥ 20 km avec ≥ 800 m D+** (EFD ≥ 28 km)
- Cumul D+ **≥ 800 m/semaine** pendant au moins 4 des 8 dernières semaines d'entraînement
- Week-ends back-to-back (samedi long + dimanche moyen) gérés sans problème
- **Long run peak en Phase 3 : 27–30 km EFD** (70–80% de la distance EFD de course)

---

## Calendrier de préparation (27 avril – 13 septembre 2026)

**20 semaines totales — 16 semaines de préparation spécifique**

| Période                       | Dates                 | Semaines | Phase     |
| ----------------------------- | --------------------- | -------- | --------- |
| Reprise post-marathon         | 27 avril – 17 mai     | S1–S3    | En cours  |
| Base route + initiation trail | 18 mai – 14 juin      | S4–S7    | Phase 1   |
| Build trail                   | 15 juin – 26 juillet  | S8–S13   | Phase 2   |
| Spécificité montagne          | 27 juillet – 16 août  | S14–S16  | Phase 3   |
| Affûtage                      | 17 août – 6 septembre | S17–S19  | Phase 4   |
| Semaine de course             | 7–13 septembre        | S20      | Race week |

---

## Trail-Specific Phase Structure

### Reprise post-marathon (semaines 1–3, 27 avril – 17 mai) — en cours

- Volume réduit : EFD 15–22 km/sem
- Aucun trail technique, D+ < 200 m
- Renforcement musculaire 1×/sem maintenu
- Objectif : récupérer, retrouver l'envie de courir

### Phase 1 — Base (semaines 4–7, 18 mai – 14 juin)

- Build aerobic base, principalement route
- 1 trail/semaine, D+ < 400 m (sorties accessibles, pas de technique)
- Focus : EFD volume, pas d'intensité
- EFD hebdo : 25–35 km
- D+ hebdo cible : 300–600 m
- Semaine de récupération : S7

### Phase 2 — Build Trail (semaines 8–13, 15 juin – 26 juillet)

- 2 trails/semaine
- D+ progressif : 600 m → 1400 m/sem sur 6 semaines
- Introduction des descentes techniques (pratique contrôle, appui)
- Long run terrain trail, EFD progressif
- EFD hebdo : 32–45 km
- Progression max 10%/sem, semaine de récup S11
- Long run peak de phase : EFD 22–25 km

### Phase 3 — Spécificité montagne (semaines 14–16, 27 juillet – 16 août)

- ≥ 1 longue sortie montagne/semaine (terrain alpine si possible)
- Long run EFD atteint **27–30 km** (70–80% des 38 km EFD de course)
- Inclure au moins 1 vertical K (montée soutenue effort seuil)
- D+ hebdo cible : 1200–2000 m
- EFD hebdo : 40–48 km
- Simuler les conditions course : altitude, trail technique, autonomie nutrition

### Phase 4 — Affûtage (semaines 17–19, 17 août – 6 septembre)

- Réduction EFD –40 à –50%
- Maintenir la proportion de terrain (trail, technique) — juste moins long
- 1 séance de qualité trail en S17 et S18, puis retrait progressif
- Confirmer équipement (bâtons?, guêtres, nutrition stratégie)
- Vérifier chaussures trail (pas de chaussures neuves !)

### Race week (semaine 20, 7–13 septembre)

- Lundi–jeudi : footing léger 20–30 min max, Z1 uniquement
- Vendredi : repos complet ou 15 min marche
- Samedi : repos complet, boire, récupérer, préparer matériel
- Dimanche : Wild 25

---

## Trail-Specific Workout Library

### Intervalles verticaux

**Durée :** 70–80 min | **Zone :** Z3–Z4 (163–178 bpm)

```
Échauffement : 15 min progressif Z1→Z2 (130–155 bpm)
Principal : 4 × (10 min montée seuil Z3-Z4 + 5 min descente récup Z1)
Retour au calme : 10 min Z1
```

**Objectif :** Économie de montée, tolérance lactique spécifique.
**FIT export :** séance structurée avec zones FC — disponible dans le viewer HTML.

**Structure JSON pour le plan :**

```json
{
  "sport": "run",
  "type": "hills",
  "name": "Intervalles verticaux",
  "durationMinutes": 75,
  "primaryZone": "Zone 3-4",
  "structure": {
    "warmup": [
      {
        "type": "warmup",
        "name": "Échauffement progressif",
        "duration": { "value": 15, "unit": "minutes" },
        "intensity": { "unit": "hr_zone", "value": 1, "valueLow": 120, "valueHigh": 148 }
      }
    ],
    "main": [
      {
        "repeats": 4,
        "name": "Montée seuil / descente récup",
        "steps": [
          {
            "type": "work",
            "name": "Montée seuil",
            "duration": { "value": 10, "unit": "minutes" },
            "intensity": { "unit": "hr_zone", "value": 4, "valueLow": 163, "valueHigh": 178 },
            "notes": "Effort soutenu montée, cadence courte, appui avant-pied"
          },
          {
            "type": "recovery",
            "name": "Descente récupération",
            "duration": { "value": 5, "unit": "minutes" },
            "intensity": { "unit": "hr_zone", "value": 1, "valueLow": 110, "valueHigh": 148 },
            "notes": "Descente contrôlée, récupération active"
          }
        ]
      }
    ],
    "cooldown": [
      {
        "type": "cooldown",
        "name": "Retour au calme",
        "duration": { "value": 10, "unit": "minutes" },
        "intensity": { "unit": "hr_zone", "value": 1, "valueLow": 110, "valueHigh": 140 }
      }
    ]
  }
}
```

---

### Fartlek trail

**Durée :** 50–60 min | **Zone :** Z2–Z3 (148–172 bpm)

```
Échauffement : 10 min Z1
Principal : 30 min fartlek libre sur terrain varié
  - En montée (courtes) : accélérer Z3 (163-172 bpm)
  - En descente ou plat : revenir Z2 (148-162 bpm)
  - Pas de structure rigide — écouter le terrain
Retour au calme : 10 min Z1
```

**Objectif :** Variabilité de l'effort, spécificité terrain trail.
**FIT export :** séance structurée disponible dans le viewer HTML.

**Structure JSON pour le plan :**

```json
{
  "sport": "run",
  "type": "hills",
  "name": "Fartlek trail",
  "durationMinutes": 55,
  "primaryZone": "Zone 2-3",
  "structure": {
    "warmup": [
      {
        "type": "warmup",
        "name": "Échauffement",
        "duration": { "value": 10, "unit": "minutes" },
        "intensity": { "unit": "hr_zone", "value": 1, "valueLow": 120, "valueHigh": 145 }
      }
    ],
    "main": [
      {
        "type": "work",
        "name": "Fartlek terrain libre",
        "duration": { "value": 35, "unit": "minutes" },
        "intensity": { "unit": "hr_zone", "value": 2, "valueLow": 148, "valueHigh": 172 },
        "notes": "Accélérer en montée (Z3), récupérer en descente/plat (Z2). Pas de chrono, jouer le terrain."
      }
    ],
    "cooldown": [
      {
        "type": "cooldown",
        "name": "Retour au calme",
        "duration": { "value": 10, "unit": "minutes" },
        "intensity": { "unit": "hr_zone", "value": 1, "valueLow": 110, "valueHigh": 140 }
      }
    ]
  }
}
```

---

### Sortie longue trail (stacked climbing day)

**Durée :** 2–3h | **Zone :** Z2 (148–162 bpm)

```
Sortie trail avec 600–1200 m D+ selon phase
Effort aérobie maîtrisé (Z2) sur toute la sortie
Marche en montée raide = tactique normale, pas une faiblesse
Post-séance : dîner récupération dans les 90 min
```

**Objectif :** Endurance montagne, conditionnement trail.

---

### Back-to-back weekend (spécificité Phase 3)

**Jour 1 (samedi) :** Long trail, EFD 25–30 km, D+ 800–1200 m — Z2, effort contrôlé
**Jour 2 (dimanche) :** Sortie medium, 50–60% durée J1, jambes volontairement fatiguées — Z1–Z2

**Objectif :** Résistance à la fatigue spécifique course.

---

## Nutrition for Trail / Mountain Running

Voir `skill/reference/nutrition.md` pour le détail complet (recettes, plans repas, fueling race day).

### Pendant les sorties longues (> 90 min)

- Glucides : 60–80 g/heure (commencer à 45 min)
- Séquence gels Overstims (de CLAUDE.md) :
  - 0–60 min : Energix
  - 60–120 min : Antioxydant
  - 120+ min : Coup de fouet
  - Dernier km : Red Tonic (caféine)
- Eau : 500–700 ml/heure selon température
- Entraîner au minimum 3 sorties longues avec le fueling de course

### Altitude (> 2000 m)

L'appétit diminue, l'effort perçu augmente. S'entraîner à manger même sans faim.

---

## Morning Check-In Integration for Trail Athletes

Trail running accumule la fatigue différemment (dommages excentriques, stress articulaire). Le score **jambes** est particulièrement critique.

| Legs score | Guidance                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| 1–2        | Pas de séance D+ exigeante. Facile uniquement. Pas de descentes techniques. |
| 3          | Modéré. Trail plat ou route OK. Réduire le D+ prévu de 50%.                 |
| 4–5        | Procéder comme prévu.                                                       |

Quand un check-in < 48h est disponible, toujours référencer **legs** et **energy** avant de recommander une séance trail avec D+ significatif.
