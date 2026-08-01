import type { UnitBasis } from './alcohol';

export interface AnalyticsTotals {
  attendeeCount: number;
  orderedDrinks: number;
  servedDrinks: number;
  estimatedUnitsOrdered: number;
  estimatedUnitsServed: number;
  knownDrinks: number;
  unknownDrinks: number;
  reconstructedDrinks: number;
}

export interface AnalyticsCoverage {
  knownDrinks: number;
  totalDrinks: number;
  percent: number;
  hasReconstructed: boolean;
}

export interface DrinkAnalytics {
  name: string;
  base: string;
  orderedDrinks: number;
  servedDrinks: number;
  estimatedUnitsOrdered: number;
  estimatedUnitsServed: number;
  basis: UnitBasis;
}

export interface BaseAnalytics {
  name: string;
  orderedDrinks: number;
  servedDrinks: number;
  estimatedUnitsOrdered: number;
  estimatedUnitsServed: number;
}

export interface AttendeeAnalytics extends AnalyticsTotals {
  attendeeKey: string;
  name: string;
  identityBasis: 'device' | 'name-only';
  firstOrderAt: number;
  lastOrderAt: number;
  drinks: DrinkAnalytics[];
}

export interface HourlyAnalytics {
  start: number;
  orders: number;
  drinks: number;
}

export interface AnalyticsParty {
  id: string;
  hostUserId: string;
  hostName: string;
  name: string;
  status: 'draft' | 'live' | 'done';
  startsAt: number | null;
  createdAt: number;
}

export interface PartyAnalytics {
  party: AnalyticsParty;
  totals: AnalyticsTotals;
  coverage: AnalyticsCoverage;
  attendees: AttendeeAnalytics[];
  popularDrinks: DrinkAnalytics[];
  bases: BaseAnalytics[];
  hourly: HourlyAnalytics[];
}

export interface PartyAnalyticsSummary {
  party: AnalyticsParty;
  totals: AnalyticsTotals;
  coverage: AnalyticsCoverage;
  popularDrinks: DrinkAnalytics[];
}
