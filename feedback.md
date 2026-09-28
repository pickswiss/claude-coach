# Feedback usage Claude Coach

## Frictions identifiées

## 2026-04-28 - ouverture du plan sur iphone

-Arriver à visualiser le plan sur mon iphone en html ? Sans forcément une app mais au moins pouvoir le suivre facilement ?
-Meal Plan weekly - pouvoir l'exporter aussi pour l'avoir à disposition pour la semaine avec le plan de course directement

## 2026-04-27 — Bugs et points en suspens fin Phase 4

### Bugs techniques

- TSB +125 absurde dans le snapshot (calcul mélange unités Strava et Garmin training_load)
- rolling4w vide dans le snapshot quand peu d'activités récentes (cas post-marathon)
- Impossible de cocher une semaine entière comme "done" dans le viewer — il faut cocher séance par séance

### Améliorations UX viewer

- Pas de vue "résumé semaine" rapide (voir d'un coup d'œil ce qui reste à faire sans cliquer dans chaque jour)
- Bouton "tout cocher" pour une semaine complétée serait utile

### Robustesse environnement

- [résolu 2026-09-28] sqlite3 CLI absent — Claude Code passait par npx claude-coach query (plus lent). Installé (3.45.1) ; les 5 tests de `tests/cli/db.test.ts` qui en dépendaient passent.
- Scripts custom peuvent boucler (Claude Code a doublé les semaines au 1er run du script de transformation)

### À tester en usage réel

- [ ] Workflow B (plan hebdo) — premier test prévu dimanche 3 mai
- [ ] Workflow C (debrief séance) — à tester sur une vraie séance cette semaine
- [ ] Workflow D (debrief hebdo) — à tester en chaîne avec Workflow B
- [ ] Export FIT Garmin Connect — vérifier sur séance structurée réelle (1er fartlek S8 = mi-juin)

## 2026-09-28 — Bugs repérés pendant la migration intervals.icu

- `claude-coach query --json` plante avec `statement has been finalized` (backend node:sqlite). Non prioritaire : contournement par lecture directe de la base.
- [corrigé 2026-09-28] rolling4w vide : pas lié au nombre d'activités. `date('now', '-4 weeks')` renvoie NULL (SQLite ne connaît pas l'unité weeks), donc rolling4w et recentKeyRuns étaient toujours vides. Remplacé par `-28 days`.
- TSB +125 : pas un mélange Strava/Garmin. `training_load` ne contient que des points de charge Garmin (échelle ~200, pas TSS/jour) figés au 2026-04-26, lus avec des seuils TSB prévus pour TSS/jour. Sera résolu par CTL/ATL/TSB intervals.icu.
