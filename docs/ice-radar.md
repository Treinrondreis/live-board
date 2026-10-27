# Maurits’ ICE-radar

`/maurits` is a separate public page; `/ice-radar` remains an alias. `/api/ice-radar` reads only the existing in-memory NDOV InfoPlus receiver. It neither queries nor writes bookings, customer records or Sanity. No extra NDOV subscription or production configuration is introduced.

The response groups ICE departures by service date and NDOV ride identity, keeps the newest observation per station, selects the next known departure, and returns at most eight journeys chronologically. The window is three hours behind to twelve hours ahead. The first available Dutch station is the displayed origin, not a complete international itinerary. Coverage depends on stations already subscribed to by the receiver.

## Estimated location

After a reported departure, position is interpolated in a straight line between two stations using their expected departure times. Both observations must have realtime, be at most fifteen minutes old and neither be cancelled nor marked not boardable. Invalid or inverted times, missing coordinates and intervals exceeding three hours disable estimation. This model does not include exact railway geometry or arrival/dwell times and cannot detect an unreported standstill. It is visibly labelled as estimated, never GPS or confirmed arrival.

Fallback markers explicitly represent a station report, not a train location. Unknown stations remain in the list without a marker. Delay is unknown when realtime is missing or stale. Data refreshes every thirty seconds; fetch failure clears train markers and list instead of leaving apparently current results. Tile failure keeps the train list available.

## Map and external requests

Leaflet 1.9.4 is vendored under public/vendor/leaflet with its BSD licence. The browser requests only visible OpenStreetMap tiles using normal browser caching and referrer policy, with visible attribution; no prefetch, offline download or tile proxy. OSM receives ordinary browser connection information, but no dossiers, bookings or customer data. Tiles are best effort. Tile policy: https://operations.osmfoundation.org/policies/tiles/

Tests use fictional train identifiers and intercepted synthetic tiles. They verify interpolation, stale/cancelled/missing-data fallback, deduplication, eight-row limit, map labels, mobile layout and fetch failure. They do not prove complete live national coverage. Public NDOV category ICE was checked at Amsterdam, Utrecht and Arnhem before the initial PR.

## Selection and source transparency

The IFF parser now retains complete ICE journeys, including foreign stops, country codes and arrival-only Dutch terminal stops. Existing station departure output is unchanged. The radar matches NDOV observations only by train, service day, station and planned departure within five minutes. No match means no realtime evidence; a loaded schedule never implies punctuality.

The selected window runs from sixty minutes before the first Dutch arrival/departure to sixty minutes after the last Dutch departure/arrival. These are station boundaries, not measured border crossings. Direct usable departure delay is applied to station times; for a downstream end without its own report, the latest recent delay is extrapolated and labelled as calculated. Otherwise the schedule remains explicitly the basis. A terminal arrival is never presented as confirmed from a departure report elsewhere. Statuses distinguish expected in-NL, approaching, departing soon and recently finished. In-NL comes first, upcoming services next and recently finished last. Pagination keeps every eligible service accessible with at most eight visible.

Every row identifies the exact station, forecast versus reported departure, source timestamp and age. Old forecasts are unknown. A reported historical departure delay remains historical evidence with its age, never current data. The last global feed receipt is shown separately from row timestamps and page refresh time.

Only supported estimated vehicle positions appear on the map, as small dots with hover labels and popups; historical station boxes are removed. A completed departure event can support a bounded estimate with a fresh next-stop forecast; it does not expire merely because the event was over fifteen minutes ago. No arrival or precise railway geometry is inferred. When no position can be supported, the map says so and the evidence remains visible in the list.
