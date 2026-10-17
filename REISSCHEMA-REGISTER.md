# Centraal reisschemaregister in FloRA

De treinenpagina toont een afzonderlijke lijst met ritten uit actuele reisschema’s.
Die lijst vervangt geen ticketbewijs en markeert een reis niet automatisch als
dienstregeling gecontroleerd. De bestaande zoekbalk filtert beide bronnen.
Bij een onbereikbare dienst wordt geen oude registerkopie getoond.

Serverinstellingen, uitsluitend op de eigen Railway-dienst:

- `REISSCHEMA_REGISTER_URL`: privé-URL van de registerdienst met interne poort.
- `REGISTER_FLORA_TOKEN`: aparte sleutel voor lezen en controles toevoegen.

Gebruik nooit de builder- of databasebeheersleutel op Live Board. Sleutels blijven
server-side en worden niet meegestuurd naar browser-JavaScript, Git of CI.
Ontbreken beide instellingen, dan blijft het onderdeel expliciet niet aangesloten.

De bestaande FloRA-login beschermt `/seinhuis/flora/api/register`. Voor
`POST /seinhuis/flora/api/register/check` gelden bovendien de bestaande
Origin-, JSON- en X-Flora-controles. Deze route accepteert controlebewijs,
versie-ID en een stabiele request-ID; de centrale dienst bepaalt de actor.
De koppeling kent geen route om schema’s te vervangen of Sanity te wijzigen.
Er wordt geen automatische controle gestart en geen bericht verzonden.

De lijst wordt maximaal dertig seconden in procesgeheugen bewaard. De
client leest alle pagina’s, begrenst antwoorden en weigert redirects.
Een actieve schemaversie is iets anders dan een recent gecontroleerde rit.

Uitrol: eerst tests en review, daarna de aparte sleutel veilig invoeren en
de instellingen handmatig activeren. Deze PR activeert geen productie-instellingen.

