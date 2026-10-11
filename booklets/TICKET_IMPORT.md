# Tickets uit e-mail

In een persoonlijk boekje: Tickets uit e-mail → zoek op Treinrondreis-nummer of
NS-referentie/DNR. De bestaande FloRA-koppeling leest alleen de mailbox
reservations@treinrondreis.nl; er worden geen mails gewijzigd of verstuurd.

Bij een Treinrondreis-nummer worden leveranciersboekingsnummers en gelabelde
DNR/NS-vermeldingen uit Sanity gebruikt als extra zoektermen. Daarmee kunnen
NS-mails met een fout in ons eigen nummer toch worden gevonden. Kandidaten,
referenties, maildatum en boekingsnaam blijven zichtbaar voor controle.

Per DNR is de nieuwste bevestigingsmail voorgeselecteerd. Optieboekingen zijn
uitgesloten. Een annuleringsmail of mail zonder PDF-knoppen activeert geen oude
mail als vervanging. Oudere mails kunnen bewust worden gekozen. Mails zonder
herkende referentie zijn niet automatisch geselecteerd.

Alle ondersteunde NS-PDF-knoppen uit gekozen mails worden achter elkaar opgehaald.
Bij een fout wordt niets aan het boekje toegevoegd; de fout is zichtbaar. Daarna
kunnen losse PDF-pagina's worden verwijderd en verplaatst. Alleen deze selectie
wordt als eenmalig hoofdstuk Treintickets toegevoegd. Het boekje moet nog worden
opgeslagen. De import is een vaste kopie, geen automatische vervanging bij export.

Een A4-ticket kan op A5 liggend worden geplaatst met behoud van de complete pagina.
Dit verkleint het ticket; de interface vraagt de leesbaarheid en barcode op een
proefdruk te controleren. Originele assets blijven onveranderd. PDF's worden niet
gerasterd. Duplicaten uit dezelfde mail geven een waarschuwing.

Beveiliging: bestaande Seinhuis-authenticatie en oorsprongcontrole voor zoek- en
download-API's. Ticketlinks blijven op de server; de browser krijgt tijdelijke
willekeurige selectiesleutels. Downloads mogen uitsluitend het bestaande
NS-ticketendpoint www.bene-system.com/hp/pdfservice gebruiken, ook na redirects.
Maximaal één download tegelijk, 10 MB per PDF, dertig PDF's en honderd pagina's
per import. Geen nieuwe database, betaalde dienst of Google-scope.

De eerste partij is NS International. De mailbron en pagina-samenstelling staan
apart, zodat later aanvullende leveranciers kunnen worden aangesloten. Voeg
daarvoor per partij expliciete referentieherkenning en toegestane downloadhosts
toe; accepteer geen willekeurige links uit mails.
