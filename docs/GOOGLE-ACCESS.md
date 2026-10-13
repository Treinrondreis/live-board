# Google-login en browsergoedkeuring voor Seinhuis

Deze wijziging voegt Google-login naast het bestaande eigenaaraccount toe. Bestaande wachtwoorden, Authenticator, landenregels en herstelcodes worden niet gemigreerd of verwijderd.

## Vooraf toegestane accounts

| Account | Rol | Toegang |
| --- | --- | --- |
| hildebrand@treinreiziger.nl | Beheerder | Alle bestaande beheeronderdelen en toegangsbeheer |
| reservations@treinrondreis.nl | Beheerder | Alle bestaande beheeronderdelen en toegangsbeheer |
| tickets@treinrondreis.nl | Gebruiker | Boekjesmaker en FloRA |
| florentina.niculae@treinrondreis.nl | Gebruiker | Boekjesmaker en FloRA |

Een toegestaan account heeft nog geen goedgekeurde browser. De eerste Google-login bindt het geverifieerde Workspace-adres aan Googles vaste `sub`. Een ander Google-account met hetzelfde adres neemt die binding niet over. Alleen Google Workspace-identiteiten met een passend `hd` en geverifieerd e-mailadres worden geaccepteerd. De twee verschillende Workspace-domeinen vereisen een OAuth-app die beide organisaties toelaat.

## Google en Railway instellen

1. Maak een OAuth-client van type **Web application** in Google Cloud voor Seinhuis. Gebruik een consentconfiguratie die accounts uit beide organisaties toelaat. In testmodus voeg je alle vier accounts als testgebruikers toe. Workspace-beleid kan daarnaast beheerderstoestemming vereisen.
2. Registreer exact deze redirect-URI: `https://treinbord.up.railway.app/seinhuis/google/callback`.
3. Zet via de beveiligde Railway-instellingen `SEINHUIS_GOOGLE_CLIENT_ID` en `SEINHUIS_GOOGLE_CLIENT_SECRET`. Stuur het secret niet via chat en commit het niet. `SEINHUIS_PUBLIC_ORIGIN` is standaard `https://treinbord.up.railway.app`; bij een ander domein moet de geregistreerde redirect ook worden aangepast.
4. De login vraagt uitsluitend `openid email`. Er worden geen Gmail-/Drive-rechten en geen refresh tokens opgeslagen. De bestaande Gmail-koppeling van FloRA blijft afzonderlijk.
5. Publiceer de gecontroleerde wijziging. Zonder clientinstellingen toont het nieuwe scherm dat Google-login nog wordt ingericht; de oude ingang blijft werken.

## Eerste beheerder en overstap

1. Log in via de bestaande eigenaarlogin met wachtwoord en Authenticator.
2. Open `/seinhuis/toegang`, kies **Beheerdersaccount koppelen**, vul een verse Authenticator-code in en selecteer één van de twee toegestane beheerdersaccounts bij Google.
3. Alleen deze expliciete, browsergebonden koppelactie keurt de eerste beheerdersbrowser automatisch goed. Een gewone Google-login van een beheerder doet dat niet.
4. Controleer het overzicht en de apps. Laat het tweede beheerdersaccount via Google aanmelden en keur diens browser goed vanuit het eerste account.
5. Laat Tickets en Florentina aanmelden en keur hun aanvragen goed. Zij zien alleen Boekjesmaker en FloRA.

Een succesvolle overgang naar een goedgekeurde Google-sessie sluit de bestaande eigenaarssessie in die browser. Het bestaande account kan nog steeds via de oude ingang opnieuw inloggen. Bewaar Authenticator en herstelcodes. Herstelcodes geven nog steeds beperkte toegang voor landenherstel; ze vervangen geen verloren Authenticator. Definitieve lock-out gebruikt de bestaande hostingprocedure `admin-recovery.mjs`.

## Sessies, intrekken en locaties

- Browsergoedkeuring verloopt niet na 30 dagen. De database bewaart de goedkeuring totdat een beheerder haar intrekt. De browser krijgt een beveiligde cookie van maximaal 400 dagen, opnieuw geplaatst bij Google-login; browsers mogen cookies eerder verwijderen.
- Een Google-sessie verloopt na 30 dagen. Daarna volgt opnieuw de Google-accountkeuze, zonder nieuwe browsergoedkeuring. Google bepaalt zelf of extra verificatie nodig is.
- Iedere beschermde aanvraag controleert account, browsergoedkeuring en sessie in de database. Een ingetrokken browser blijft ingetrokken na Google-login. Accountblokkade beëindigt alle Google-sessies en trekt alle bijbehorende browsers in; het account opnieuw toestaan keurt die browsers niet automatisch goed.
- Voor goedkeuren, intrekken en blokkeren is een Google-bevestiging van minder dan 10 minuten oud nodig. Met de oude eigenaarlogin is een verse TOTP-code vereist. Een recente OAuth-bevestiging garandeert niet dat Google daarbij opnieuw een wachtwoord of tweede factor vroeg: beveilig de Google-accounts met sterke tweestapsverificatie/passkeys.
- Goedkeuring beheren geldt voor een browsercookie, niet voor een cryptografisch vastgesteld fysiek apparaat. Cookies wissen of een andere browser gebruiken kan een nieuwe aanvraag opleveren. Een gestolen sessie plus apparaatcookie blijft een risico; gebruik persoonlijke, vergrendelde computers.
- Google-toegang gebruikt account- en browsergoedkeuring in plaats van de bestaande landenblokkade. Locatie is informatief, zodat reizen niet opnieuw de oude blokkade veroorzaakt. De oude login behoudt de oude landenregels.
- Het overzicht toont browser/user-agent, laatste activiteit, IP-adres en geschatte stad/land. Browserinformatie is door de client opgegeven; IP-locatie is onnauwkeurig. Activiteit wordt maximaal eenmaal per minuut bijgewerkt. Alleen beheerders zien het overzicht; maximaal 500 toegangsacties blijven in het logboek.
- Intrekken verhindert nieuwe aanvragen. Reeds geladen of gedownloade gegevens en al gestarte acties worden niet teruggehaald. Uitloggen bij Google beëindigt niet automatisch de Seinhuis-sessie.

## Validatie

`google-login.test.mjs` controleert echte RSA-handtekeningen, issuer, client, nonce, tijdslimieten en Workspace-identiteit. `google-access.test.mjs` gebruikt echte SQLite-persistentie voor onboarding, rollen, CSRF, browserbinding, state-hergebruik, sessieverloop, intrekken, blokkeren en een blokkade tijdens de Google-netwerkaanvraag. `test-google-access-browser.mjs` controleert het scherm en de bediening met API-fixtures op desktop en mobiel. Een volledige Google-login met de productieclient moet na configuratie nog worden getest; fixtures bevestigen geen live OAuth-configuratie.
