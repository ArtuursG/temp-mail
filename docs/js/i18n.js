// Minimal i18n: flat key dictionaries, {placeholder} interpolation, and a
// helper that fills [data-i18n] / [data-i18n-title] / [data-i18n-ph] in the DOM.

const DICTS = {
  en: {
    "brand.tagline": "Disposable mail terminal",
    "nav.inbox": "Inbox",
    "nav.about": "What is temp mail",

    "status.starting": "Booting",
    "status.generating": "Requesting address",
    "status.live": "Live",
    "status.liveNoMail": "Live - no mail yet",
    "status.liveUnread": "Live - {n} unread",
    "status.syncing": "Checking for mail",
    "status.error": "Link error",
    "status.createFail": "Address request failed",

    "meta.session": "{provider} - session ok",
    "meta.opening": "opening session",

    "addr.deliverTo": "Deliver mail to",
    "addr.copy": "Copy",
    "addr.copied": "Copied",

    "expiry.label": "Expires",
    "expiry.note": "Session dies with the clock",
    "expiry.expired": "Expired - burn and get a fresh one",

    "toolbar.refresh": "Refresh",
    "toolbar.refreshing": "Checking",
    "toolbar.new": "New address",
    "toolbar.burn": "Burn it",
    "toolbar.source": "Source",
    "toolbar.poll": "auto-poll {n}s",
    "toolbar.syncing": "syncing",

    "list.header": "Sender / subject",
    "list.held": "{n} held",
    "list.emptyTitle": "Nothing held",
    "list.emptyTitleGen": "Opening session",
    "list.emptyBody": "Paste the address anywhere that demands one. Mail lands here within seconds.",
    "list.emptyBodyGen": "Asking the provider for a fresh address.",

    "reader.placeholder": "Pick a message to read it",
    "reader.placeholderEmpty": "Nothing to read yet",
    "reader.from": "From",
    "reader.to": "To",
    "reader.blocked": "Remote images and scripts blocked - rendered in an isolated frame",
    "reader.noSubject": "(no subject)",
    "reader.emptyBody": "(empty message)",
    "reader.loading": "Loading",
    "reader.error": "Could not load: {error}",

    "code.title": "One-time code",
    "code.copy": "Copy code",
    "code.copied": "Copied",

    "att.save": "Save",

    "notify.on": "Alerts on",
    "notify.off": "Alerts off",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "lang.label": "Language",

    "about.kicker": "01 - Basics",
    "about.title": "What is a disposable temporary email?",
    "about.p1": "A disposable email - also called temp mail - is a short-lived inbox you hand out instead of your real address. It is generated instantly, shows new mail as it arrives, and is wiped when the inbox expires. No signup, no account, no payment.",
    "about.p2": "Use it anywhere a form demands your email: signups, downloads, free trials, forum comments. The confirmation lands in the temporary inbox; spam, newsletters, retargeting and phishing never reach your real one.",

    "about.f1t": "Runs in your browser",
    "about.f1b": "The client talks straight to public disposable-mail APIs. Nothing is stored on a server of ours - only the address sits in this browser.",
    "about.f2t": "Random by default",
    "about.f2b": "Every address is generated at random. Nothing to name, nothing to remember. Switch the source and a fresh inbox appears.",

    "about.g1t": "Instant",
    "about.g1b": "Address ready in one click. Zero signup, zero setup.",
    "about.g2t": "Receive-only",
    "about.g2b": "Temp inboxes take mail in. They cannot send - and neither can this page.",
    "about.g3t": "Auto-refresh",
    "about.g3b": "The inbox polls every few seconds; new mail shows up on its own.",
    "about.g4t": "One click",
    "about.g4b": "Need another? Press New address and a fresh random inbox appears.",

    "about.retentionT": "How long messages are kept",
    "about.retentionB": "Set by the source, not by us: Mail.gw keeps mail 7 days, Guerrilla Mail 1 hour. After that the address and its messages are gone and cannot be recovered.",
    "about.avoidT": "Do not use it for",
    "about.avoidB": "Banking, payments, identity, work, healthcare, government, or any login you need to keep. If losing the inbox would lock you out, use a permanent address.",
    "about.privacyT": "Anonymity limits",
    "about.privacyB": "No signup, but not full anonymity. Upstream providers may log technical data such as IP and browser info, some sites block known disposable domains, and anyone using this browser can read the inbox.",

    "about.cta": "Get an address",
    "about.ctaNote": "No signup - kept {retention}",

    "about.faqTitle": "Common questions",
    "faq.q1": "How long does an address last?",
    "faq.a1": "Mail.gw keeps mail 7 days, Guerrilla Mail 1 hour. After that the address and messages are removed and cannot be restored.",
    "faq.q2": "I did not get my verification code - what now?",
    "faq.a2": "Wait a minute and let the inbox refresh, then check the address is pasted exactly. If the site rejects disposable domains, switch source or use a permanent inbox.",
    "faq.q3": "Which services block temporary email?",
    "faq.a3": "It changes constantly and depends on each site's domain policy. This client cannot bypass a provider's block - generate a fresh address or use a real inbox.",
    "faq.q4": "Is it anonymous?",
    "faq.a4": "Partly. No registration, but IP and browser data may be processed upstream, and the inbox is visible to anyone on this browser.",
    "faq.q5": "Can I send mail from here?",
    "faq.a5": "No. Temporary inboxes are receive-only.",
    "faq.q6": "Where is my mail stored?",
    "faq.a6": "On the source you picked (Mail.gw or Guerrilla Mail). Only the address and session token live in this browser.",

    "foot.copy": "2026 Tempmail",
    "foot.terms": "Terms",
    "foot.privacy": "Privacy",
    "foot.line1": "Static client - public disposable-mail APIs",
    "foot.line2": "Never use a temporary address for anything private",
    "dur.1h": "1 hour",
    "dur.7d": "7 days",
    "theme.toggle": "Toggle theme",
    "status.expired": "Address expired - get a fresh one",
    "lifetime.label": "Lifetime",
    "lifetime.10m": "10 min",
    "lifetime.30m": "30 min",
    "lifetime.1h": "1 hour",
    "lifetime.max": "Max",
    "status.throttled": "Provider rate limit - slowing down",
    "toolbar.throttled": "throttled - retrying slower",
    "addr.edit": "Edit",
    "addr.set": "Set",
    "addr.cancel": "Cancel",
    "addr.pickName": "Pick a name",
    "reader.delete": "Delete",
    "reader.backToList": "Messages",
  },

  lv: {
    "brand.tagline": "Vienreizējā pasta terminālis",
    "nav.inbox": "Iesūtne",
    "nav.about": "Kas ir pagaidu pasts",

    "status.starting": "Startē",
    "status.generating": "Pieprasa adresi",
    "status.live": "Tiešraidē",
    "status.liveNoMail": "Tiešraidē - vēstuļu vēl nav",
    "status.liveUnread": "Tiešraidē - {n} nelasītas",
    "status.syncing": "Pārbauda pastu",
    "status.error": "Savienojuma kļūda",
    "status.createFail": "Adreses pieprasījums neizdevās",

    "meta.session": "{provider} - sesija ok",
    "meta.opening": "atver sesiju",

    "addr.deliverTo": "Piegādāt pastu uz",
    "addr.copy": "Kopēt",
    "addr.copied": "Nokopēts",

    "expiry.label": "Beidzas",
    "expiry.note": "Sesija mirst līdz ar pulksteni",
    "expiry.expired": "Beigusies - sadedzini un ņem jaunu",

    "toolbar.refresh": "Atsvaidzināt",
    "toolbar.refreshing": "Pārbauda",
    "toolbar.new": "Jauna adrese",
    "toolbar.burn": "Sadedzināt",
    "toolbar.source": "Avots",
    "toolbar.poll": "auto-aptauja {n}s",
    "toolbar.syncing": "sinhronizē",

    "list.header": "Sūtītājs / temats",
    "list.held": "{n} glabājas",
    "list.emptyTitle": "Nekas neglabājas",
    "list.emptyTitleGen": "Atver sesiju",
    "list.emptyBody": "Iekopē adresi jebkur, kur to prasa. Pasts nonāks šeit dažu sekunžu laikā.",
    "list.emptyBodyGen": "Prasa providerim jaunu adresi.",

    "reader.placeholder": "Izvēlies vēstuli, lai to lasītu",
    "reader.placeholderEmpty": "Vēl nav ko lasīt",
    "reader.from": "No",
    "reader.to": "Uz",
    "reader.blocked": "Attālie attēli un skripti bloķēti - attēlots izolētā rāmī",
    "reader.noSubject": "(bez temata)",
    "reader.emptyBody": "(tukša vēstule)",
    "reader.loading": "Ielādē",
    "reader.error": "Neizdevās ielādēt: {error}",

    "code.title": "Vienreizējs kods",
    "code.copy": "Kopēt kodu",
    "code.copied": "Nokopēts",

    "att.save": "Saglabāt",

    "notify.on": "Paziņojumi ieslēgti",
    "notify.off": "Paziņojumi izslēgti",
    "theme.light": "Gaišā",
    "theme.dark": "Tumšā",
    "lang.label": "Valoda",

    "about.kicker": "01 - Pamati",
    "about.title": "Kas ir vienreizējs pagaidu e-pasts?",
    "about.p1": "Vienreizējs e-pasts - jeb pagaidu pasts - ir īslaicīga iesūtne, ko iedod īstās adreses vietā. Tā tiek izveidota uzreiz, rāda jaunās vēstules līdzko tās pienāk, un tiek izdzēsta, kad iesūtne beidzas. Bez reģistrācijas, bez konta, bez maksas.",
    "about.p2": "Lieto to jebkur, kur forma prasa e-pastu: reģistrācijas, lejupielādes, izmēģinājumi, forumu komentāri. Apstiprinājums nonāk pagaidu iesūtnē; mēstules, jaunumi, reklāmas un pikšķerēšana tavu īsto nekad nesasniedz.",

    "about.f1t": "Darbojas tavā pārlūkā",
    "about.f1b": "Klients sazinās tieši ar publiskiem vienreizējā pasta API. Nekas netiek glabāts mūsu serverī - tikai adrese paliek šajā pārlūkā.",
    "about.f2t": "Pēc noklusējuma nejauša",
    "about.f2b": "Katra adrese tiek ģenerēta nejauši. Nekas nav jānosauc, nekas nav jāatceras. Nomaini avotu un parādās jauna iesūtne.",

    "about.g1t": "Uzreiz",
    "about.g1b": "Adrese gatava vienā klikšķī. Bez reģistrācijas, bez iestatīšanas.",
    "about.g2t": "Tikai saņemšanai",
    "about.g2b": "Pagaidu iesūtnes pastu tikai saņem. Sūtīt nevar - arī šī lapa nevar.",
    "about.g3t": "Auto-atsvaidze",
    "about.g3b": "Iesūtne aptaujā ik pāris sekundes; jaunais pasts parādās pats.",
    "about.g4t": "Viens klikšķis",
    "about.g4b": "Vajag vēl vienu? Nospied Jauna adrese un parādās jauna nejauša iesūtne.",

    "about.retentionT": "Cik ilgi vēstules glabājas",
    "about.retentionB": "Nosaka avots, ne mēs: Mail.gw glabā pastu 7 dienas, Guerrilla Mail 1 stundu. Pēc tam adrese un vēstules ir zudušas un nav atgūstamas.",
    "about.avoidT": "Kam nelietot",
    "about.avoidB": "Bankām, maksājumiem, identitātei, darbam, veselībai, valsts pakalpojumiem vai jebkuram kontam, kas jāpatur. Ja iesūtnes zaudēšana tevi izslēgtu, lieto pastāvīgu adresi.",
    "about.privacyT": "Anonimitātes robežas",
    "about.privacyB": "Bez reģistrācijas, bet ne pilnīga anonimitāte. Avoti var reģistrēt tehniskus datus, piem. IP un pārlūka info, dažas vietnes bloķē zināmus domēnus, un iesūtni redz jebkurš šajā pārlūkā.",

    "about.cta": "Iegūt adresi",
    "about.ctaNote": "Bez reģistrācijas - glabājas {retention}",

    "about.faqTitle": "Biežākie jautājumi",
    "faq.q1": "Cik ilgi adrese pastāv?",
    "faq.a1": "Mail.gw glabā pastu 7 dienas, Guerrilla Mail 1 stundu. Pēc tam adrese un vēstules tiek dzēstas un nav atjaunojamas.",
    "faq.q2": "Nesaņēmu verifikācijas kodu - ko darīt?",
    "faq.a2": "Pagaidi minūti un ļauj iesūtnei atsvaidzināties, tad pārbaudi, vai adrese iekopēta precīzi. Ja vietne noraida vienreizējos domēnus, maini avotu vai lieto pastāvīgu iesūtni.",
    "faq.q3": "Kuri pakalpojumi bloķē pagaidu pastu?",
    "faq.a3": "Tas nemitīgi mainās un atkarīgs no katras vietnes domēnu politikas. Šis klients nevar apiet bloķēšanu - izveido jaunu adresi vai lieto īstu iesūtni.",
    "faq.q4": "Vai tas ir anonīmi?",
    "faq.a4": "Daļēji. Reģistrācijas nav, bet IP un pārlūka datus var apstrādāt avota pusē, un iesūtni redz jebkurš šajā pārlūkā.",
    "faq.q5": "Vai no šejienes var sūtīt pastu?",
    "faq.a5": "Nē. Pagaidu iesūtnes ir tikai saņemšanai.",
    "faq.q6": "Kur glabājas manas vēstules?",
    "faq.a6": "Izvēlētajā avotā (Mail.gw vai Guerrilla Mail). Šajā pārlūkā glabājas tikai adrese un sesijas marķieris.",

    "foot.copy": "2026 Tempmail",
    "foot.terms": "Noteikumi",
    "foot.privacy": "Privātums",
    "foot.line1": "Statisks klients - publiskie vienreizējā pasta API",
    "foot.line2": "Nekad nelieto pagaidu adresi neko privātam",
    "dur.1h": "1 stunda",
    "dur.7d": "7 dienas",
    "theme.toggle": "Mainīt tēmu",
    "status.expired": "Adrese beigusies - ņem jaunu",
    "lifetime.label": "Ilgums",
    "lifetime.10m": "10 min",
    "lifetime.30m": "30 min",
    "lifetime.1h": "1 stunda",
    "lifetime.max": "Maks.",
    "status.throttled": "Avota ātruma limits - palēninu",
    "toolbar.throttled": "palēnināts - mēģina retāk",
    "addr.edit": "Rediģēt",
    "addr.set": "Iestatīt",
    "addr.cancel": "Atcelt",
    "addr.pickName": "Izvēlies vārdu",
    "reader.delete": "Dzēst",
    "reader.backToList": "Vēstules",
  },

  de: {
    "brand.tagline": "Wegwerf-Mail-Terminal",
    "nav.inbox": "Posteingang",
    "nav.about": "Was ist Temp-Mail",

    "status.starting": "Startet",
    "status.generating": "Adresse wird angefordert",
    "status.live": "Live",
    "status.liveNoMail": "Live - noch keine Mail",
    "status.liveUnread": "Live - {n} ungelesen",
    "status.syncing": "Prüfe auf Mail",
    "status.error": "Verbindungsfehler",
    "status.createFail": "Adressanfrage fehlgeschlagen",

    "meta.session": "{provider} - Sitzung ok",
    "meta.opening": "Sitzung wird geöffnet",

    "addr.deliverTo": "Mail zustellen an",
    "addr.copy": "Kopieren",
    "addr.copied": "Kopiert",

    "expiry.label": "Läuft ab",
    "expiry.note": "Die Sitzung endet mit der Uhr",
    "expiry.expired": "Abgelaufen - verbrennen und neu holen",

    "toolbar.refresh": "Aktualisieren",
    "toolbar.refreshing": "Prüfe",
    "toolbar.new": "Neue Adresse",
    "toolbar.burn": "Verbrennen",
    "toolbar.source": "Quelle",
    "toolbar.poll": "Auto-Abruf {n}s",
    "toolbar.syncing": "synchronisiere",

    "list.header": "Absender / Betreff",
    "list.held": "{n} gehalten",
    "list.emptyTitle": "Nichts gehalten",
    "list.emptyTitleGen": "Sitzung wird geöffnet",
    "list.emptyBody": "Füge die Adresse überall ein, wo eine verlangt wird. Mail landet in Sekunden hier.",
    "list.emptyBodyGen": "Fordere eine frische Adresse an.",

    "reader.placeholder": "Wähle eine Nachricht zum Lesen",
    "reader.placeholderEmpty": "Noch nichts zu lesen",
    "reader.from": "Von",
    "reader.to": "An",
    "reader.blocked": "Externe Bilder und Skripte blockiert - in isoliertem Frame dargestellt",
    "reader.noSubject": "(kein Betreff)",
    "reader.emptyBody": "(leere Nachricht)",
    "reader.loading": "Lädt",
    "reader.error": "Konnte nicht laden: {error}",

    "code.title": "Einmalcode",
    "code.copy": "Code kopieren",
    "code.copied": "Kopiert",

    "att.save": "Speichern",

    "notify.on": "Hinweise an",
    "notify.off": "Hinweise aus",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "lang.label": "Sprache",

    "about.kicker": "01 - Grundlagen",
    "about.title": "Was ist eine Wegwerf-Mail?",
    "about.p1": "Eine Wegwerf-Mail - auch Temp-Mail - ist ein kurzlebiger Posteingang, den du statt deiner echten Adresse angibst. Er wird sofort erzeugt, zeigt neue Mail beim Eintreffen und wird gelöscht, wenn er abläuft. Keine Anmeldung, kein Konto, keine Zahlung.",
    "about.p2": "Nutze ihn überall, wo ein Formular deine Mail verlangt: Anmeldungen, Downloads, Testphasen, Forenkommentare. Die Bestätigung landet im temporären Eingang; Spam, Newsletter, Retargeting und Phishing erreichen deinen echten nie.",

    "about.f1t": "Läuft im Browser",
    "about.f1b": "Der Client spricht direkt mit öffentlichen Wegwerf-Mail-APIs. Auf keinem Server von uns wird etwas gespeichert - nur die Adresse liegt in diesem Browser.",
    "about.f2t": "Standardmäßig zufällig",
    "about.f2b": "Jede Adresse wird zufällig erzeugt. Nichts zu benennen, nichts zu merken. Quelle wechseln und ein neuer Eingang erscheint.",

    "about.g1t": "Sofort",
    "about.g1b": "Adresse in einem Klick bereit. Keine Anmeldung, kein Setup.",
    "about.g2t": "Nur Empfang",
    "about.g2b": "Temp-Eingänge nehmen Mail an. Senden können sie nicht - diese Seite auch nicht.",
    "about.g3t": "Auto-Refresh",
    "about.g3b": "Der Eingang fragt alle paar Sekunden ab; neue Mail erscheint von selbst.",
    "about.g4t": "Ein Klick",
    "about.g4b": "Noch eine? Neue Adresse drücken und ein frischer Zufallseingang erscheint.",

    "about.retentionT": "Wie lange Nachrichten bleiben",
    "about.retentionB": "Von der Quelle bestimmt, nicht von uns: Mail.gw hält Mail 7 Tage, Guerrilla Mail 1 Stunde. Danach sind Adresse und Nachrichten weg und nicht wiederherstellbar.",
    "about.avoidT": "Nicht verwenden für",
    "about.avoidB": "Banking, Zahlungen, Identität, Arbeit, Gesundheit, Behörden oder Logins, die du behalten musst. Wenn der Verlust dich aussperren würde, nimm eine feste Adresse.",
    "about.privacyT": "Grenzen der Anonymität",
    "about.privacyB": "Keine Anmeldung, aber keine volle Anonymität. Quellen können technische Daten wie IP und Browser-Infos protokollieren, manche Seiten blockieren bekannte Wegwerf-Domains, und jeder an diesem Browser kann den Eingang lesen.",

    "about.cta": "Adresse holen",
    "about.ctaNote": "Keine Anmeldung - {retention} aufbewahrt",

    "about.faqTitle": "Häufige Fragen",
    "faq.q1": "Wie lange hält eine Adresse?",
    "faq.a1": "Mail.gw hält Mail 7 Tage, Guerrilla Mail 1 Stunde. Danach werden Adresse und Nachrichten entfernt und lassen sich nicht wiederherstellen.",
    "faq.q2": "Ich habe keinen Code bekommen - was nun?",
    "faq.a2": "Warte eine Minute und lass den Eingang aktualisieren, prüfe dann die Adresse genau. Lehnt die Seite Wegwerf-Domains ab, wechsle die Quelle oder nimm einen festen Eingang.",
    "faq.q3": "Welche Dienste blockieren Temp-Mail?",
    "faq.a3": "Das ändert sich ständig und hängt von der Domain-Politik jeder Seite ab. Dieser Client kann eine Sperre nicht umgehen - erzeuge eine neue Adresse oder nimm einen echten Eingang.",
    "faq.q4": "Ist es anonym?",
    "faq.a4": "Teilweise. Keine Registrierung, aber IP- und Browser-Daten können quellseitig verarbeitet werden, und der Eingang ist für jeden an diesem Browser sichtbar.",
    "faq.q5": "Kann ich von hier senden?",
    "faq.a5": "Nein. Temporäre Eingänge sind nur zum Empfangen.",
    "faq.q6": "Wo wird meine Mail gespeichert?",
    "faq.a6": "Bei der gewählten Quelle (Mail.gw oder Guerrilla Mail). Nur Adresse und Sitzungs-Token liegen in diesem Browser.",

    "foot.copy": "2026 Tempmail",
    "foot.terms": "AGB",
    "foot.privacy": "Datenschutz",
    "foot.line1": "Statischer Client - öffentliche Wegwerf-Mail-APIs",
    "foot.line2": "Nutze eine temporäre Adresse nie für Privates",
    "dur.1h": "1 Stunde",
    "dur.7d": "7 Tage",
    "theme.toggle": "Thema wechseln",
    "status.expired": "Adresse abgelaufen - hol eine neue",
    "lifetime.label": "Dauer",
    "lifetime.10m": "10 Min",
    "lifetime.30m": "30 Min",
    "lifetime.1h": "1 Stunde",
    "lifetime.max": "Max",
    "status.throttled": "Anbieter-Limit - langsamer",
    "toolbar.throttled": "gedrosselt - langsamerer Versuch",
    "addr.edit": "Bearbeiten",
    "addr.set": "Setzen",
    "addr.cancel": "Abbrechen",
    "addr.pickName": "Namen wählen",
    "reader.delete": "Löschen",
    "reader.backToList": "Nachrichten",
  },

  es: {
    "brand.tagline": "Terminal de correo desechable",
    "nav.inbox": "Bandeja",
    "nav.about": "Qué es el correo temporal",

    "status.starting": "Arrancando",
    "status.generating": "Solicitando dirección",
    "status.live": "En vivo",
    "status.liveNoMail": "En vivo - sin correo aún",
    "status.liveUnread": "En vivo - {n} sin leer",
    "status.syncing": "Comprobando correo",
    "status.error": "Error de conexión",
    "status.createFail": "Falló la solicitud de dirección",

    "meta.session": "{provider} - sesión ok",
    "meta.opening": "abriendo sesión",

    "addr.deliverTo": "Entregar correo a",
    "addr.copy": "Copiar",
    "addr.copied": "Copiado",

    "expiry.label": "Caduca",
    "expiry.note": "La sesión muere con el reloj",
    "expiry.expired": "Caducada - quémala y obtén otra",

    "toolbar.refresh": "Actualizar",
    "toolbar.refreshing": "Comprobando",
    "toolbar.new": "Nueva dirección",
    "toolbar.burn": "Quemarla",
    "toolbar.source": "Fuente",
    "toolbar.poll": "sondeo automático {n}s",
    "toolbar.syncing": "sincronizando",

    "list.header": "Remitente / asunto",
    "list.held": "{n} retenidos",
    "list.emptyTitle": "Nada retenido",
    "list.emptyTitleGen": "Abriendo sesión",
    "list.emptyBody": "Pega la dirección donde te la pidan. El correo llega aquí en segundos.",
    "list.emptyBodyGen": "Pidiendo una dirección nueva.",

    "reader.placeholder": "Elige un mensaje para leerlo",
    "reader.placeholderEmpty": "Nada que leer aún",
    "reader.from": "De",
    "reader.to": "Para",
    "reader.blocked": "Imágenes y scripts remotos bloqueados - mostrado en un marco aislado",
    "reader.noSubject": "(sin asunto)",
    "reader.emptyBody": "(mensaje vacío)",
    "reader.loading": "Cargando",
    "reader.error": "No se pudo cargar: {error}",

    "code.title": "Código de un solo uso",
    "code.copy": "Copiar código",
    "code.copied": "Copiado",

    "att.save": "Guardar",

    "notify.on": "Avisos activados",
    "notify.off": "Avisos desactivados",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "lang.label": "Idioma",

    "about.kicker": "01 - Conceptos",
    "about.title": "¿Qué es un correo temporal desechable?",
    "about.p1": "Un correo desechable - también llamado temp mail - es una bandeja efímera que das en lugar de tu dirección real. Se genera al instante, muestra el correo nuevo al llegar y se borra cuando caduca. Sin registro, sin cuenta, sin pago.",
    "about.p2": "Úsalo donde un formulario pida tu correo: registros, descargas, pruebas gratuitas, comentarios de foro. La confirmación llega a la bandeja temporal; el spam, los boletines, el retargeting y el phishing nunca llegan a la real.",

    "about.f1t": "Funciona en tu navegador",
    "about.f1b": "El cliente habla directamente con APIs públicas de correo desechable. Nada se guarda en un servidor nuestro - solo la dirección queda en este navegador.",
    "about.f2t": "Aleatorio por defecto",
    "about.f2b": "Cada dirección se genera al azar. Nada que nombrar, nada que recordar. Cambia la fuente y aparece una bandeja nueva.",

    "about.g1t": "Instantáneo",
    "about.g1b": "Dirección lista en un clic. Cero registro, cero configuración.",
    "about.g2t": "Solo recepción",
    "about.g2b": "Las bandejas temporales reciben correo. No pueden enviar - esta página tampoco.",
    "about.g3t": "Auto-actualización",
    "about.g3b": "La bandeja sondea cada pocos segundos; el correo nuevo aparece solo.",
    "about.g4t": "Un clic",
    "about.g4b": "¿Necesitas otra? Pulsa Nueva dirección y aparece una bandeja aleatoria nueva.",

    "about.retentionT": "Cuánto se guardan los mensajes",
    "about.retentionB": "Lo fija la fuente, no nosotros: Mail.gw guarda el correo 7 días, Guerrilla Mail 1 hora. Después la dirección y los mensajes desaparecen y no se recuperan.",
    "about.avoidT": "No la uses para",
    "about.avoidB": "Banca, pagos, identidad, trabajo, salud, administración o cualquier acceso que necesites conservar. Si perder la bandeja te dejaría fuera, usa una dirección permanente.",
    "about.privacyT": "Límites del anonimato",
    "about.privacyB": "Sin registro, pero no anonimato total. Las fuentes pueden registrar datos técnicos como IP e información del navegador, algunos sitios bloquean dominios desechables conocidos, y cualquiera en este navegador puede leer la bandeja.",

    "about.cta": "Obtener dirección",
    "about.ctaNote": "Sin registro - guardado {retention}",

    "about.faqTitle": "Preguntas frecuentes",
    "faq.q1": "¿Cuánto dura una dirección?",
    "faq.a1": "Mail.gw guarda el correo 7 días, Guerrilla Mail 1 hora. Después la dirección y los mensajes se eliminan y no se pueden restaurar.",
    "faq.q2": "No recibí el código de verificación - ¿ahora qué?",
    "faq.a2": "Espera un minuto y deja que la bandeja se actualice, luego comprueba que la dirección esté pegada exacta. Si el sitio rechaza dominios desechables, cambia de fuente o usa una bandeja permanente.",
    "faq.q3": "¿Qué servicios bloquean el correo temporal?",
    "faq.a3": "Cambia constantemente y depende de la política de dominios de cada sitio. Este cliente no puede saltarse un bloqueo - genera una dirección nueva o usa una bandeja real.",
    "faq.q4": "¿Es anónimo?",
    "faq.a4": "En parte. Sin registro, pero los datos de IP y navegador pueden procesarse en origen, y la bandeja la ve cualquiera en este navegador.",
    "faq.q5": "¿Puedo enviar correo desde aquí?",
    "faq.a5": "No. Las bandejas temporales son solo de recepción.",
    "faq.q6": "¿Dónde se guarda mi correo?",
    "faq.a6": "En la fuente que elijas (Mail.gw o Guerrilla Mail). Solo la dirección y el token de sesión viven en este navegador.",

    "foot.copy": "2026 Tempmail",
    "foot.terms": "Términos",
    "foot.privacy": "Privacidad",
    "foot.line1": "Cliente estático - APIs públicas de correo desechable",
    "foot.line2": "Nunca uses una dirección temporal para nada privado",
    "dur.1h": "1 hora",
    "dur.7d": "7 días",
    "theme.toggle": "Cambiar tema",
    "status.expired": "Dirección caducada - obtén otra",
    "lifetime.label": "Duración",
    "lifetime.10m": "10 min",
    "lifetime.30m": "30 min",
    "lifetime.1h": "1 hora",
    "lifetime.max": "Máx",
    "status.throttled": "Límite del proveedor - ralentizando",
    "toolbar.throttled": "limitado - reintento más lento",
    "addr.edit": "Editar",
    "addr.set": "Fijar",
    "addr.cancel": "Cancelar",
    "addr.pickName": "Elige un nombre",
    "reader.delete": "Eliminar",
    "reader.backToList": "Mensajes",
  },
};

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "lv", label: "Latviešu" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

const LANG_KEY = "tempmail:lang";
let current = "en";
const listeners = new Set();

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function t(key, vars) {
  const dict = DICTS[current] || DICTS.en;
  const val = dict[key] ?? DICTS.en[key] ?? key;
  return interpolate(val, vars);
}

export function getLang() {
  return current;
}

export function setLang(code) {
  if (!DICTS[code]) code = "en";
  current = code;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = code;
  applyStaticTranslations();
  listeners.forEach((fn) => fn(code));
}

export function onLangChange(fn) {
  listeners.add(fn);
}

/** Fill elements that carry data-i18n / data-i18n-title / data-i18n-ph. */
export function applyStaticTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

export function initLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  setLang(stored || (DICTS[nav] ? nav : "en"));
}
