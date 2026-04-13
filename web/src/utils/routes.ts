/**
 * Shared route maps for concept-to-route resolution.
 * Used by ConfigListPage, DashboardWidget, and other navigation helpers.
 */

export const CONCEPT_DETAIL_ROUTES: Record<string, string> = {
  guest: 'guest-detail',
  staff: 'staff-detail',
  schedule: 'schedule-detail',
  prep_item: 'prep-detail',
  transport: 'travel-detail',
  venue: 'venue-detail',
  pairing: 'pairing-detail',
}

export const CONCEPT_LIST_ROUTES: Record<string, string> = {
  guest: '/guests',
  staff: '/staff',
  transport: '/travel',
  prep_item: '/prep-tracker',
  schedule: '/schedule',
  venue: '/venues',
  pairing: '/pairings',
}
