# Maurits’ ICE-radar

`/ice-radar` is a separate public page, using `/api/ice-radar` and the existing in-memory NDOV InfoPlus receiver. It reads public train observations only. It neither queries nor writes bookings, customer records or Sanity. No additional subscription or production configuration is introduced.

The response groups ICE departures by service date and NDOV ride identity, keeps the newest observation per station, selects the next known departure, and returns at most eight journeys in chronological order. The window is three hours behind to twelve hours ahead. The first available Dutch station is the displayed route origin; this is not a claim about the complete international itinerary. Coverage depends on stations already subscribed to by the existing receiver.

The map is a schematic Netherlands station radar, not vehicle tracking. Coordinates identify stations; markers show the station associated with the selected departure forecast, not a train's physical position. Unknown stations remain visible in the list without a map marker. Delay is unknown when realtime is missing or the observation is over fifteen minutes old. Updates refresh every thirty seconds. A fetch failure clears the display instead of leaving seemingly current results.

Before deployment, verify the live NDOV category values, station coverage and current feed health. Unit tests use fictional train identifiers. Browser layout checks use intercepted fictional responses and do not prove live feed coverage.
