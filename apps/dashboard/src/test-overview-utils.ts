import type { Overview, OverviewApi } from "./lib/overview-api";

export const TEST_OVERVIEW: Overview = {
  windowDays: 7,
  accepted: 12,
  refused: 2,
  volumeMinor: "420000",
  daily: [{ date: "2026-11-09", accepted: 12, volumeMinor: "420000" }],
  pendingReviews: 3,
  reconciliation: { status: "drift", checkedAt: "2026-11-09T10:00:00.000Z" },
};

export function fakeOverviewApi(overrides: Partial<OverviewApi> = {}): OverviewApi {
  return { get: () => Promise.resolve(TEST_OVERVIEW), ...overrides };
}
