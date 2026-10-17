# Tijdelijk onderdeel Reisschema’s

Het centrale register staat los van FloRA onder `/seinhuis/reisschemas/`,
met een eigen tegel in Seinhuis. De pagina zoekt op dossier, trein, station en
reisdatum en toont links naar actuele reisschema’s. Alleen bestaande
Seinhuis-beheerders (owner/admin) hebben toegang. Er worden geen accountrechten
toegevoegd of uitgebreid. Gewone FloRA-toegang geeft geen toegang tot dit onderdeel.

Dit tijdelijke onderdeel is alleen-lezen. De oude FloRA-registerroutes zijn
verwijderd; ook controles kunnen niet via deze pagina worden toegevoegd.
Een actieve versie betekent niet dat de dienstregeling recent gecontroleerd is.
Geen Sanity-wijzigingen, automatische controles of berichten.

De bestaande serverinstellingen blijven behouden, zodat geen sleutels hoeven
te worden verplaatst: `REISSCHEMA_REGISTER_URL` en `REGISTER_FLORA_TOKEN`.
De historische modulenaam `flora-register.mjs` verwijst alleen naar de interne
adapter en plaatst het onderdeel niet in FloRA. De sleutel blijft uitsluitend
server-side. Het gebruikte serviceprofiel kan lezen en controles toevoegen;
deze webpagina biedt uitsluitend lezen aan. Gebruik hier nooit een builder-
of databasebeheersleutel.

De client leest alle pagina’s, gebruikt de private Railway-hostnaam en weigert
redirects. De cache verloopt na dertig seconden; fouten verwijderen de oude
cache. De browser wist de vorige lijst bij vernieuwen of een fout.

Uitrol: passende tests, review en daarna een handmatige productie-uitrol.
Deze wijziging migreert geen database en verandert geen bestaande ritten.
