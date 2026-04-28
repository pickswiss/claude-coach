# Snapshot Athlète

Le snapshot est un fichier JSON pré-calculé qui synthétise le contexte d'entraînement des 4 dernières semaines. Il est mis à jour automatiquement à chaque sync Strava ou manuellement avec `npx claude-coach snapshot`.

## Charger le snapshot

```bash
cat ~/.claude-coach/snapshot.json
```

**Temps de réponse : < 2s** (pas de requête SQL, lecture fichier directe)

## Charger le plan actif

```bash
cat ~/.claude-coach/active-plan.txt   # → chemin vers le plan JSON
cat <chemin>                           # → plan complet
```

## Structure du snapshot

```json
{
  "generatedAt": "2026-04-27T10:00:00Z",
  "athlete": {
    "name": "Julien",
    "weight_kg": 84.8,
    "hrMax": 186,
    "lthr": 170
  },
  "rolling4w": [
    {
      "week": "2026-W17",
      "sessions": 3,
      "flat_km": 28.1,
      "dplus_m": 410,
      "efd_km": 32.2,
      "hours": 3.8
    }
  ],
  "acuteChronicLoad": {
    "acute": 52,
    "chronic": 48,
    "form": -4,
    "ratio": 1.08
  },
  "sleepTrend": {
    "avg7d_h": 7.1,
    "avg28d_h": 6.9,
    "lastNight": { "duration_h": 7.3, "quality": 4 }
  },
  "hrvTrend": {
    "avg7d": 68,
    "avg28d": 65,
    "trend": "rising"
  },
  "recentKeyRuns": [
    {
      "date": "2026-04-26",
      "name": "Sortie trail Valère",
      "flat_km": 15.2,
      "dplus_m": 620,
      "efd_km": 21.4,
      "avg_hr": 152,
      "minutes": 98
    }
  ],
  "morningCheckin": null,
  "readinessFlags": []
}
```

## Interprétation des champs

### rolling4w

4 semaines glissantes de volume course (Run, TrailRun, Trail Run, VirtualRun). La semaine la plus récente est en premier. Si une semaine n'a aucune activité, elle n'apparaît pas.

### acuteChronicLoad

Données Garmin archive (training_load table). Peut être `null` si l'archive n'a pas été importée.

- `form` = chronic − acute (positif = frais, négatif = fatigue)
- `ratio` = acute / chronic (> 1.30 = zone rouge)

### sleepTrend

Données Garmin archive (sleep table). `lastNight` peut être `null`.

- `quality` : 1–5 (mappé depuis le score Garmin)

### hrvTrend

Données Garmin archive (hrv table). `rmssd` en millisecondes.

- `trend` : "rising" si avg7j > avg28j × 1.03, "falling" si < 0.97, sinon "stable", "unknown" si données insuffisantes

### morningCheckin

Dernier check-in si < 48h. `null` sinon.

### readinessFlags

Liste de chaînes décrivant les alertes détectées. Vide = pas d'alerte.

Flags possibles :

- `"Charge aiguë élevée (ratio ATL/CTL X.XX)"` → ratio > 1.30
- `"HRV en chute (moy. 7j < moy. 28j)"` → HRV trend falling
- `"Déficit sommeil (moy. 7j : X.Xh/nuit)"` → avg7d < 6.5h
- `"Fatigue accumulée (TSB X)"` → form < -15
- `"Bonne forme (TSB +X)"` → form > 10
- `"Jambes lourdes au check-in (X/5)"` → legs ≤ 2
- `"Énergie basse au check-in (X/5)"` → energy ≤ 2

## Seuils d'ajustement plan (Workflow B)

| Flag                | Action recommandée                                                   |
| ------------------- | -------------------------------------------------------------------- |
| Ratio > 1.30        | Remplacer la séance la plus exigeante de la semaine par récupération |
| HRV falling         | Convertir 1 séance de qualité en Z2 facile                           |
| TSB < -15           | Signaler, proposer semaine allégée                                   |
| Legs ≤ 2 (check-in) | Déplacer ou alléger la séance trail D+                               |

**Important :** Les ajustements sont proposés et confirmés avec l'utilisateur avant modification du plan master.

## Requêtes SQL complémentaires (pour analyse approfondie)

Pour des questions historiques ("compare cette sortie à celle de 2024") :

```sql
-- Comparaison sortie spécifique
SELECT date(start_date), name, flat_km, dplus_m, efd_km, avg_hr, minutes
FROM activities
WHERE sport_type IN ('Run', 'TrailRun', 'Trail Run')
  AND start_date BETWEEN '2024-01-01' AND '2024-12-31'
ORDER BY efd_km DESC
LIMIT 5;

-- Tendance EFD sur 12 semaines
SELECT strftime('%Y-W%W', start_date) AS week,
  ROUND(SUM(equivalent_distance_m)/1000.0, 1) AS efd_km,
  ROUND(SUM(total_elevation_gain), 0) AS dplus_m
FROM activities
WHERE sport_type IN ('Run', 'TrailRun', 'Trail Run')
  AND start_date >= date('now', '-12 weeks')
GROUP BY week ORDER BY week;
```
