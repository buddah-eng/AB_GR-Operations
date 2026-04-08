# Transport & Logistics (GR)

> Transport booking concept with full status lifecycle. FlightAware integration for flight tracking (15min polling).
> Blacklane/Karhoo for ride booking. Driver view via token-scoped external surface. Live location sharing.
> Manager dashboard with all active bookings and exception alerts.

---

## Overview

Transport logistics manages the end-to-end process of getting guests to and from the convention: booking rides, tracking flights, coordinating drivers, and giving guests real-time visibility into their pickup status. It integrates with three external APIs (FlightAware, Blacklane, Karhoo) and exposes two external views (guest pickup info, driver coordination).

**Dependencies:** `api/external-surfaces.md` (driver/guest views), `api/integration-patterns.md` (API integrations), `automation/workflow-actions.md` (call_api, notify)

---

## Full Specification

### 1. Transport Booking Concept

| Property | Type | Description |
|---|---|---|
| `guest_id` | relation (guest) | Which guest |
| `provider` | select | blacklane, karhoo, volunteer, manual |
| `external_booking_id` | text | Provider's booking ID |
| `status` | select | requested, booked, driver_en_route, waiting, picked_up, dropped_off, canceled |
| `pickup_time` | datetime | Scheduled pickup |
| `pickup_location` | text | "Logan Terminal E, Door 4" |
| `dropoff_location` | text | "Hynes Convention Center" |
| `flight_number` | text | "JL008" |
| `flight_status` | select | on_time, delayed, landed, canceled |
| `flight_eta` | datetime | Updated ETA from FlightAware |
| `driver_name` | text | |
| `driver_phone` | text (encrypted) | |
| `driver_plate` | text | |
| `driver_location` | JSONB | `{lat, lng, timestamp}` |
| `special_instructions` | rich_text | |

**Status lifecycle:**
```
requested → booked → driver_en_route → waiting → picked_up → dropped_off
                                                 ↘ canceled (from any state)
```

### 2. Flight Tracking

**Integration:** FlightAware AeroAPI via `call_api` workflow action.

**Workflow:** Scheduled every 15 minutes during convention:
1. Query all transport_bookings WHERE flight_number IS NOT NULL AND status IN ('requested', 'booked', 'driver_en_route', 'waiting')
2. For each: call FlightAware API with flight_number
3. Update flight_status and flight_eta on transport_booking
4. If flight_status changed to 'delayed': notify liaison with new ETA
5. If flight_status changed to 'landed': notify driver to proceed to terminal

**api_integration record:**
```json
{ "name": "FlightAware AeroAPI", "provider": "flightaware",
  "baseUrl": "https://aeroapi.flightaware.com/aeroapi",
  "authType": "api_key" }
```

### 3. Ride Booking Integration

**Blacklane:** Professional chauffeur service with Boston Logan coverage.
- `call_api` action creates booking via Blacklane API
- Webhook receives status updates (driver assigned, en route, etc.)
- Updates transport_booking status + driver details

**Karhoo:** Aggregator as fallback if Blacklane unavailable.
- Same integration pattern, different API endpoints
- Provider field on transport_booking distinguishes source

**Volunteer drivers:** No API — manual assignment. transport_driver concept with name, phone, vehicle, availability.

### 4. Driver View

Token-scoped external surface (see `api/external-surfaces.md`):
- `driver_session` concept with booking_id scope
- **Visible:** guest name (no phone/email), flight number, flight status, terminal, pickup location, special instructions
- **Actions:** status transition buttons (waiting → picked_up → dropped_off)
- **Location sharing:** browser geolocation API, updates transport_booking.driver_location every 30 seconds while active

### 5. Live Location

Driver shares location via simple web page (no app install):
- Browser `navigator.geolocation.watchPosition()` on the driver view page
- Location updates POST to API every 30 seconds: `{ lat, lng, timestamp }`
- Stored in transport_booking.driver_location JSONB
- Guest view shows ETA calculated from driver location → pickup location
- Location sharing auto-stops when booking status → dropped_off

### 6. Manager Dashboard

All active bookings in one view:
- **Status board:** color-coded cards grouped by status (booked=blue, en_route=yellow, waiting=orange, picked_up=green)
- **Exception alerts:** delayed flights (red badge), missing drivers (no driver_name on booked status), overdue pickups (waiting >30min)
- **Timeline:** horizontal timeline of all pickups/dropoffs for the day
- **Quick actions:** reassign driver, cancel booking, send notification

### 7. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| Status transitions | Valid transitions succeed, invalid blocked | Correct lifecycle |
| Flight polling | FlightAware returns delay → booking updated + liaison notified | Status + ETA updated |
| Ride booking | Workflow creates Blacklane booking → external_booking_id stored | Integration works |
| Driver view | Token auth → minimal data shown → status button works | Correct scoping |
| Location sharing | Driver location updates → guest sees ETA | <30s latency |
| Manager dashboard | 5 active bookings → correct status grouping | All displayed correctly |
| Logan specifics | Pickup location includes terminal/door for Logan | B/C/E terminals handled |
