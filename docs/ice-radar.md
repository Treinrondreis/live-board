# Maurits’ ICE-radar

`/maurits` is a separate public page; `/ice-radar` remains an alias. `/api/ice-radar` reads only the existing in-memory NDOV InfoPlus receiver. It neither queries nor writes bookings, customer records or Sanity. No extra NDOV subscription or production configuration is introduced.

The response groups ICE departures by service date and NDOV ride identity, keeps the newest observation per station, selects the next known departure, and returns at most eight journeys chronologically. The window is three hours behind to twelve hours ahead. The first available Dutch station is the displayed origin, not a complete international itinerary. Coverage depends on stations already subscribed to by the receiver.

## Estimated location

After a reported departure, position is interpolated in a straight line between two stations using their expected departure times. Both observations must have realtime, be at most fifteen minutes old and neither be cancelled nor marked not boardable. Invalid or inverted times, missing coordinates and intervals exceeding three hours disable estimation. This model does not include exact railway geometry or arrival/dwell times and cannot detect an unreported standstill. It is visibly labelled as estimated, never GPS or confirmed arrival.

Fallback markers explicitly represent a station report, not a train location. Unknown stations remain in the list without a marker. Delay is unknown when realtime is missing or stale. Data refreshes every thirty seconds; fetch failure clears train markers and list instead of leaving apparently current results. Tile failure keeps the train list available.

## Map and external requests

Leaflet 1.9.4 is vendored under public/vendor/leaflet with its BSD licence. The browser requests only visible OpenStreetMap tiles using normal browser caching and referrer policy, with visible attribution; no prefetch, offline download or tile proxy. OSM receives ordinary browser connection information, but no dossiers, bookings or customer data. Tiles are best effort. Tile policy: https://operations.osmfoundation.org/policies/tiles/

Tests use fictional train identifiers and intercepted synthetic tiles. They verify interpolation, stale/cancelled/missing-data fallback, deduplication, eight-row limit, map labels, mobile layout and fetch failure. They do not prove complete live national coverage. Public NDOV category ICE was checked at Amsterdam, Utrecht and Arnhem before the initial PR.
