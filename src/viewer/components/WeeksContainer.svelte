<script lang="ts">
  import type {
    TrainingPlan,
    TrainingWeek,
    TrainingDay,
    Workout,
  } from "../../schema/training-plan.js";
  import type { Settings } from "../stores/settings.js";
  import type { PlanChanges } from "../stores/changes.js";
  import { getEffectiveWorkout, isWorkoutDeleted } from "../stores/changes.js";
  import WeekCard from "./WeekCard.svelte";
  import {
    getOrderedDays,
    getTodayISO,
    parseDate,
    formatDateISO,
    getWeekMonthKey,
    getMonthStarts,
    formatMonthFr,
    formatMonthShortFr,
    findWeekForDate,
  } from "../lib/utils.js";

  interface Props {
    plan: TrainingPlan;
    settings: Settings;
    filters: { sport: string; status: string };
    completed: Record<string, boolean>;
    changes: PlanChanges;
    onWorkoutClick: (workout: Workout, day: TrainingDay) => void;
    onWorkoutMove: (workoutId: string, originalDate: string, newDate: string) => void;
    onAddWorkout: (day: TrainingDay) => void;
  }

  let {
    plan,
    settings,
    filters,
    completed,
    changes,
    onWorkoutClick,
    onWorkoutMove,
    onAddWorkout,
  }: Props = $props();

  const today = getTodayISO();

  const weeks = $derived(plan.weeks ?? []);
  const monthStarts = $derived(getMonthStarts(weeks));
  const separatorBefore = $derived(new Map(monthStarts.map((m) => [m.weekNumber, m.monthKey])));

  let containerEl = $state<HTMLDivElement>();
  let barHeight = $state(0);
  // Week currently at the top of the viewport, just below the sticky bar
  let topWeekNumber = $state<number | null>(null);

  const topWeek = $derived(weeks.find((w) => w.weekNumber === topWeekNumber) ?? weeks[0]);
  const topMonthKey = $derived(topWeek ? getWeekMonthKey(topWeek) : "");

  // Track which weeks intersect the viewport below the sticky bar; the lowest
  // week number among them is the one at the top.
  $effect(() => {
    const offset = Math.ceil(barHeight);
    if (!containerEl) return;

    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const weekNumber = Number((entry.target as HTMLElement).dataset.week);
          if (entry.isIntersecting) visible.add(weekNumber);
          else visible.delete(weekNumber);
        }
        if (visible.size > 0) topWeekNumber = Math.min(...visible);
      },
      { rootMargin: `-${offset}px 0px 0px 0px` }
    );
    containerEl.querySelectorAll("[data-week]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });

  function scrollToWeek(weekNumber: number) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    containerEl
      ?.querySelector(`[data-week="${weekNumber}"]`)
      ?.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "start" });
  }

  function scrollToToday() {
    const week = findWeekForDate(weeks, today);
    if (week) scrollToWeek(week.weekNumber);
  }

  // Build a map of all original workout dates
  function getOriginalDateMap(): Record<string, string> {
    const map: Record<string, string> = {};
    plan.weeks?.forEach((week) => {
      week.days?.forEach((day) => {
        day.workouts?.forEach((w) => {
          map[w.id] = day.date;
        });
      });
    });
    return map;
  }

  // Get effective date for a workout (original or moved)
  function getEffectiveDate(workoutId: string, originalDate: string): string {
    return changes.moved[workoutId] || originalDate;
  }

  // Build a full 7-day week with workouts in their effective positions
  function buildFullWeek(weekData: TrainingWeek): TrainingDay[] {
    const orderedDayNames = getOrderedDays(settings.firstDayOfWeek);
    const dayNameOrder = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    // Create a map from day name to the plan's day data
    const planDaysByName: Record<string, TrainingDay> = {};
    weekData.days?.forEach((day) => {
      planDaysByName[day.dayOfWeek] = day;
    });

    // Use the first plan day as reference to calculate missing dates
    const refDay = weekData.days?.[0];
    if (!refDay) {
      // No days in this week, return empty week
      return orderedDayNames.map((dayName) => ({
        date: "",
        dayOfWeek: dayName,
        workouts: [],
      }));
    }
    const refDate = parseDate(refDay.date);
    const refDayIndex = dayNameOrder.indexOf(refDay.dayOfWeek);

    function getDateForDayName(dayName: string): string {
      const targetDayIndex = dayNameOrder.indexOf(dayName);
      let offset = targetDayIndex - refDayIndex;
      // Keep offset in range -6 to +6 for same week
      if (offset < -3) offset += 7;
      if (offset > 3) offset -= 7;
      const date = new Date(refDate);
      date.setDate(date.getDate() + offset);
      return formatDateISO(date);
    }

    // Build array of all 7 dates in this week
    const allWeekDates: string[] = orderedDayNames.map((dayName) => {
      const planDay = planDaysByName[dayName];
      return planDay ? planDay.date : getDateForDayName(dayName);
    });

    // Collect workouts by their effective date (respecting moves)
    const workoutsByDate: Record<string, Workout[]> = {};
    allWeekDates.forEach((d) => (workoutsByDate[d] = []));

    // Add original plan workouts (respecting moves)
    plan.weeks?.forEach((week) => {
      week.days?.forEach((day) => {
        day.workouts?.forEach((workout) => {
          if (isWorkoutDeleted(workout.id, changes)) return;

          const effectiveDate = getEffectiveDate(workout.id, day.date);
          if (allWeekDates.includes(effectiveDate)) {
            const effectiveWorkout = getEffectiveWorkout(workout, changes);
            workoutsByDate[effectiveDate].push(effectiveWorkout);
          }
        });
      });
    });

    // Add user-created workouts
    Object.entries(changes.added ?? {}).forEach(([id, { date, workout }]) => {
      if (allWeekDates.includes(date) && !isWorkoutDeleted(id, changes)) {
        workoutsByDate[date].push(workout);
      }
    });

    // Build full week in the correct display order
    return orderedDayNames.map((dayName, idx) => {
      const date = allWeekDates[idx];
      return {
        date,
        dayOfWeek: dayName,
        workouts: workoutsByDate[date] || [],
      };
    });
  }

  function filterWorkout(workout: Workout): boolean {
    if (filters.sport !== "all" && workout.sport !== filters.sport) {
      return false;
    }
    if (filters.status === "completed" && !completed[workout.id]) {
      return false;
    }
    if (filters.status === "pending" && completed[workout.id]) {
      return false;
    }
    return true;
  }

  // Get the original date for a workout (needed for move tracking)
  function getOriginalDate(workoutId: string): string {
    // Check if it's a user-added workout
    if (changes.added?.[workoutId]) {
      return changes.added[workoutId].date;
    }
    // Find in original plan
    for (const week of plan.weeks ?? []) {
      for (const day of week.days ?? []) {
        for (const workout of day.workouts ?? []) {
          if (workout.id === workoutId) {
            return day.date;
          }
        }
      }
    }
    return "";
  }

  function handleDrop(workoutId: string, newDate: string) {
    const originalDate = getOriginalDate(workoutId);
    onWorkoutMove(workoutId, originalDate, newDate);
  }
</script>

<div class="phase-timeline">
  {#each plan.phases ?? [] as phase, idx}
    {@const weeks = phase.endWeek - phase.startWeek + 1}
    {@const phaseName = phase.name.toLowerCase()}
    <button
      class="phase-segment {phaseName}"
      style="flex: {weeks}"
      onclick={() => scrollToWeek(phase.startWeek)}
    >
      <span class="phase-label">{phase.name}</span>
    </button>
  {/each}
</div>

<div class="timeline-bar" bind:offsetHeight={barHeight}>
  {#if topWeek}
    <p class="current-position">
      <strong>{formatMonthFr(topMonthKey)}</strong>
      <span class="sep">·</span>
      S{topWeek.weekNumber}
      <span class="sep">·</span>
      {topWeek.phase}
    </p>
  {/if}
  <div class="month-nav-row">
    <nav class="month-nav" aria-label="Mois du plan">
      {#each monthStarts as { monthKey, weekNumber }, i (monthKey)}
        {#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}
        <button
          class="month-link"
          class:active={monthKey === topMonthKey}
          aria-current={monthKey === topMonthKey ? "true" : undefined}
          title={formatMonthFr(monthKey)}
          onclick={() => scrollToWeek(weekNumber)}
        >
          {formatMonthShortFr(monthKey)}
        </button>
      {/each}
    </nav>
    <button class="today-button" onclick={scrollToToday}>Aujourd'hui</button>
  </div>
</div>

<div class="weeks-container" bind:this={containerEl} style="--sticky-offset: {barHeight}px">
  {#each weeks as week, index (week.weekNumber)}
    {@const monthKey = separatorBefore.get(week.weekNumber)}
    {#if monthKey}
      <h2 class="month-separator">{formatMonthFr(monthKey)}</h2>
    {/if}
    <div data-week={week.weekNumber}>
      <WeekCard
        {week}
        fullWeek={buildFullWeek(week)}
        {settings}
        {today}
        {completed}
        {filterWorkout}
        {onWorkoutClick}
        onDrop={handleDrop}
        {onAddWorkout}
        animationDelay={index * 0.05}
      />
    </div>
  {/each}
</div>

<style>
  .phase-timeline {
    display: flex;
    gap: 4px;
    margin-bottom: 1.5rem;
    padding: 0 1rem;
  }

  .phase-segment {
    flex: 1;
    height: 28px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #64748b, #475569); /* fallback */
  }

  .phase-segment:hover {
    filter: brightness(1.2);
  }

  .phase-segment:active {
    transform: scale(0.98);
  }

  .phase-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .phase-segment.base {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
  }
  .phase-segment.build {
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  }
  .phase-segment.peak {
    background: linear-gradient(135deg, #ec4899, #db2777);
  }
  .phase-segment.taper {
    background: linear-gradient(135deg, #14b8a6, #0d9488);
  }
  .phase-segment.recovery {
    background: linear-gradient(135deg, #6b7280, #4b5563);
  }
  .phase-segment.rebuild {
    background: linear-gradient(135deg, #f97316, #ea580c);
  }
  .phase-segment.survival {
    background: linear-gradient(135deg, #f59e0b, #d97706);
  }
  .phase-segment.bank {
    background: linear-gradient(135deg, #10b981, #059669);
  }

  /* Sticks to the viewport: no ancestor (.main-content, .app, body) may create a
     scroll container, hence overflow-x: clip rather than hidden on body. */
  .timeline-bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin: 0 -1rem 1.5rem;
    padding: 0.6rem 1rem;
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border-subtle);
  }

  .current-position {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-secondary);
  }

  .current-position strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .sep {
    color: var(--text-muted);
    margin: 0 0.25rem;
  }

  .month-nav-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .month-nav {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .month-link {
    flex-shrink: 0;
    padding: 0.15rem 0.4rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    transition: all var(--transition-fast);
  }

  .month-link:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .month-link.active {
    color: var(--accent);
    font-weight: 600;
  }

  .today-button {
    flex-shrink: 0;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--border-medium);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.8rem;
    transition: all var(--transition-fast);
  }

  .today-button:hover {
    background: var(--bg-tertiary);
  }

  .weeks-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .weeks-container > [data-week] {
    scroll-margin-top: calc(var(--sticky-offset, 0px) + 0.75rem);
  }

  .month-separator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0 -0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .month-separator::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border-medium);
  }
</style>
