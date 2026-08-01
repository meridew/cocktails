import { createHash } from 'node:crypto';
import type {
  AnalyticsCoverage,
  AnalyticsParty,
  AnalyticsTotals,
  AttendeeAnalytics,
  BaseAnalytics,
  DrinkAnalytics,
  HourlyAnalytics,
  PartyAnalytics,
  PartyAnalyticsSummary,
  UnitBasis,
} from '$lib/shared';
import { RECIPES } from '$lib/shared';
import {
  eventById,
  listGuests,
  listOrderHistory,
  userById,
  type EventRow,
  type OrderHistoryRow,
} from './db';
import { onWire } from './party';

const emptyTotals = (): AnalyticsTotals => ({
  attendeeCount: 0,
  orderedDrinks: 0,
  servedDrinks: 0,
  estimatedUnitsOrdered: 0,
  estimatedUnitsServed: 0,
  knownDrinks: 0,
  unknownDrinks: 0,
  reconstructedDrinks: 0,
});

const addTotals = (
  target: AnalyticsTotals,
  source: Omit<AnalyticsTotals, 'attendeeCount'>,
): void => {
  target.orderedDrinks += source.orderedDrinks;
  target.servedDrinks += source.servedDrinks;
  target.estimatedUnitsOrdered += source.estimatedUnitsOrdered;
  target.estimatedUnitsServed += source.estimatedUnitsServed;
  target.knownDrinks += source.knownDrinks;
  target.unknownDrinks += source.unknownDrinks;
  target.reconstructedDrinks += source.reconstructedDrinks;
};

const coverageFor = (totals: AnalyticsTotals): AnalyticsCoverage => {
  const totalDrinks = totals.knownDrinks + totals.unknownDrinks;
  return {
    knownDrinks: totals.knownDrinks,
    totalDrinks,
    percent: totalDrinks === 0 ? 100 : (totals.knownDrinks / totalDrinks) * 100,
    hasReconstructed: totals.reconstructedDrinks > 0,
  };
};

const partyOnWire = (row: EventRow): AnalyticsParty => {
  const party = onWire(row);
  return {
    id: party.id,
    hostUserId: party.hostUserId,
    hostName: userById(party.hostUserId)?.name ?? 'Unknown host',
    name: party.name,
    status: party.status,
    startsAt: party.startsAt,
    createdAt: party.createdAt,
  };
};

const normalizedName = (name: string): string =>
  name.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase();

const attendeeKey = (eventId: string, deviceId: string | null, name: string): string =>
  createHash('sha256')
    .update(`${eventId}\0${deviceId ?? normalizedName(name)}`)
    .digest('hex')
    .slice(0, 16);

function baseFor(recipeId: string | null, name: string): string {
  if (recipeId === 'legacy-pom-elderflower') return 'Prosecco';
  if (name === 'Wine' || name.startsWith('Wine —')) return 'Wine';
  return (
    RECIPES.find((recipe) => recipe.id === recipeId || recipe.name === name)?.menuBase ??
    RECIPES.find((recipe) => recipe.id === recipeId || recipe.name === name)?.base ??
    'Other'
  );
}

interface MutableAttendee {
  attendeeKey: string;
  name: string;
  identityBasis: 'device' | 'name-only';
  firstOrderAt: number;
  lastOrderAt: number;
  totals: AnalyticsTotals;
  drinks: Map<string, DrinkAnalytics>;
}

const basisRank: Record<UnitBasis, number> = {
  unknown: 0,
  reconstructed: 1,
  'verified-default': 2,
  'host-override': 3,
  'alcohol-free': 4,
};

function aggregateRows(
  eventId: string,
  rows: OrderHistoryRow[],
): {
  totals: AnalyticsTotals;
  attendees: AttendeeAnalytics[];
  popularDrinks: DrinkAnalytics[];
  bases: BaseAnalytics[];
  hourly: HourlyAnalytics[];
} {
  const guestNames = new Map(listGuests(eventId).map((guest) => [guest.deviceId, guest.name]));
  const attendees = new Map<string, MutableAttendee>();
  const popular = new Map<string, DrinkAnalytics>();
  const hourly = new Map<number, HourlyAnalytics>();

  for (const order of rows) {
    const key = order.deviceId ?? `name:${normalizedName(order.name)}`;
    const person = attendees.get(key) ?? {
      attendeeKey: attendeeKey(eventId, order.deviceId, order.name),
      name: (order.deviceId && guestNames.get(order.deviceId)) || order.name,
      identityBasis: order.deviceId ? ('device' as const) : ('name-only' as const),
      firstOrderAt: order.createdAt,
      lastOrderAt: order.createdAt,
      totals: emptyTotals(),
      drinks: new Map<string, DrinkAnalytics>(),
    };
    person.firstOrderAt = Math.min(person.firstOrderAt, order.createdAt);
    person.lastOrderAt = Math.max(person.lastOrderAt, order.createdAt);
    attendees.set(key, person);

    const hour = Math.floor(order.createdAt / 3_600_000) * 3_600_000;
    const hourRow = hourly.get(hour) ?? { start: hour, orders: 0, drinks: 0 };
    hourRow.orders += 1;
    hourly.set(hour, hourRow);

    for (const item of order.items) {
      const orderedDrinks = item.qty;
      const servedDrinks =
        order.status === 'serving' || order.status === 'done'
          ? item.qty
          : Math.min(item.made ?? 0, item.qty);
      const units = item.unit?.unitsPerServing;
      const known = units !== null && units !== undefined;
      const contribution = {
        orderedDrinks,
        servedDrinks,
        estimatedUnitsOrdered: known ? units * orderedDrinks : 0,
        estimatedUnitsServed: known ? units * servedDrinks : 0,
        knownDrinks: known ? orderedDrinks : 0,
        unknownDrinks: known ? 0 : orderedDrinks,
        reconstructedDrinks: item.unit?.basis === 'reconstructed' ? orderedDrinks : 0,
      };
      addTotals(person.totals, contribution);
      hourRow.drinks += orderedDrinks;

      const existing = person.drinks.get(item.name) ?? {
        name: item.name,
        base: baseFor(item.unit?.recipeId ?? null, item.name),
        orderedDrinks: 0,
        servedDrinks: 0,
        estimatedUnitsOrdered: 0,
        estimatedUnitsServed: 0,
        basis: item.unit?.basis ?? ('unknown' as const),
      };
      existing.orderedDrinks += contribution.orderedDrinks;
      existing.servedDrinks += contribution.servedDrinks;
      existing.estimatedUnitsOrdered += contribution.estimatedUnitsOrdered;
      existing.estimatedUnitsServed += contribution.estimatedUnitsServed;
      if (basisRank[item.unit?.basis ?? 'unknown'] < basisRank[existing.basis]) {
        existing.basis = item.unit?.basis ?? 'unknown';
      }
      person.drinks.set(item.name, existing);

      const all = popular.get(item.name) ?? {
        ...existing,
        orderedDrinks: 0,
        servedDrinks: 0,
        estimatedUnitsOrdered: 0,
        estimatedUnitsServed: 0,
      };
      all.orderedDrinks += contribution.orderedDrinks;
      all.servedDrinks += contribution.servedDrinks;
      all.estimatedUnitsOrdered += contribution.estimatedUnitsOrdered;
      all.estimatedUnitsServed += contribution.estimatedUnitsServed;
      if (basisRank[item.unit?.basis ?? 'unknown'] < basisRank[all.basis]) {
        all.basis = item.unit?.basis ?? 'unknown';
      }
      popular.set(item.name, all);
    }
  }

  const people: AttendeeAnalytics[] = [...attendees.values()].map((person) => ({
    ...person.totals,
    attendeeCount: 1,
    attendeeKey: person.attendeeKey,
    name: person.name,
    identityBasis: person.identityBasis,
    firstOrderAt: person.firstOrderAt,
    lastOrderAt: person.lastOrderAt,
    drinks: [...person.drinks.values()].sort(
      (a, b) => b.orderedDrinks - a.orderedDrinks || a.name.localeCompare(b.name),
    ),
  }));
  const totals = emptyTotals();
  totals.attendeeCount = people.length;
  for (const person of people) addTotals(totals, person);
  const bases = new Map<string, BaseAnalytics>();
  for (const drink of popular.values()) {
    const base = bases.get(drink.base) ?? {
      name: drink.base,
      orderedDrinks: 0,
      servedDrinks: 0,
      estimatedUnitsOrdered: 0,
      estimatedUnitsServed: 0,
    };
    base.orderedDrinks += drink.orderedDrinks;
    base.servedDrinks += drink.servedDrinks;
    base.estimatedUnitsOrdered += drink.estimatedUnitsOrdered;
    base.estimatedUnitsServed += drink.estimatedUnitsServed;
    bases.set(drink.base, base);
  }
  return {
    totals,
    attendees: people,
    popularDrinks: [...popular.values()].sort(
      (a, b) => b.orderedDrinks - a.orderedDrinks || a.name.localeCompare(b.name),
    ),
    bases: [...bases.values()].sort(
      (a, b) => b.orderedDrinks - a.orderedDrinks || a.name.localeCompare(b.name),
    ),
    hourly: [...hourly.values()].sort((a, b) => a.start - b.start),
  };
}

export function analyticsForEvent(eventId: string): PartyAnalytics | null {
  const party = eventById(eventId);
  if (!party) return null;
  const aggregate = aggregateRows(eventId, listOrderHistory(eventId));
  return {
    party: partyOnWire(party),
    ...aggregate,
    coverage: coverageFor(aggregate.totals),
  };
}

export function analyticsSummary(party: EventRow): PartyAnalyticsSummary {
  const aggregate = aggregateRows(party.id, listOrderHistory(party.id));
  return {
    party: partyOnWire(party),
    totals: aggregate.totals,
    coverage: coverageFor(aggregate.totals),
    popularDrinks: aggregate.popularDrinks.slice(0, 5),
  };
}
