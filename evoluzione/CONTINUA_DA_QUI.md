# DODGE evoluzione — handoff per nuova sessione

## Dove lavorare

- **DODGE evoluzione (PWA + Auth + Firebase):** `C:\Users\Daniele\Desktop\dodge\evoluzione\` — **tutte le modifiche alla versione online vanno qui.**
- **Root repo:** `C:\Users\Daniele\Desktop\dodge\index.html` fa solo redirect alla webapp live (`https://dodge-84439.web.app/`).

Path assoluti consigliati per strumenti che accettano path completi: prefisso `C:\Users\Daniele\Desktop\dodge\evoluzione\`.

---

## Firebase

- **Project ID:** `dodge-84439`
- **Hosting URL:** `https://dodge-84439.web.app`
- **Piano:** Blaze (pay-as-you-go; quote no-cost generose per traffico basso)
- **Servizi attivi:** Authentication (email+password), Firestore, Realtime Database, Hosting, **Cloud Functions v2** (`api`, region `europe-west1`). **Presenza affluenza:** `app_presence/sessions` su RTDB (write da `game-engine.js`, conteggio in **GET /api/admin/overview** → KPI «Sessioni app aperte ora»); regole in `database.rules.json`.
- **API HTTP:** rewrite Hosting `/api/**` → function `api`; es. `GET /api/player/stats` (Bearer token). Fine partita: `POST /api/game/end` (stats + storico + classifica). **Missioni e premi Plus:** `GET /api/missions/current`, `POST /api/missions/activate`, `POST /api/missions/cancel`, `GET /api/prizes`, `POST /api/game/start` (imposta `pending_run_prize` su `player_stats`), poi `POST /api/game/end` con `prize_used` (server usa `pending_run_prize`), contatori missione (`green_skipped_this_run`, `max_extra_lives_simultaneous_this_run`, ecc.). **`recent_games`** include `prize_used`. **Parametri missioni** (durata finestra, soglie bonus/partite, premio al completamento): `public/js/missions-config.json`; esportati anche da `constants.js` (`MISSION_WINDOW_MS`, `getProfileMissionDefs`). Copia automatica in `functions/` alla predeploy Functions (`scripts/copy-missions-config.js`).
- **Firestore `player_stats` (oltre ai campi stats esistenti):** `active_mission`, `mission_started_at`, `mission_progress`, `prizes` (map 5 tipi 0–10), `pending_run_prize`. Nuovi utenti: default anche in `claimUsername` (`profile.js`) e in `upsertPlayerStatsIfMissing` (functions).
- **Migrazione campi missioni/premi:** `POST /api/admin/migrate-missions-fields` (Bearer admin), idempotente, dopo backup se in produzione.
- **Test premi in tasca (solo admin):** `POST /api/admin/grant-self-test-plus-prizes` oppure pulsante in `admin.html` — imposta sul proprio `player_stats` tutti i `prizes` Plus a **10/10** (per provare il picker a inizio partita; con 10/10 non si può attivare la missione di quel colore finché non consumi premi).
- **Migrazione stats storiche (solo emergenza):** `POST /api/admin/backfill-stats-from-history` con Bearer admin, dopo backup Firestore; oppure da console: `import('/js/stats-migration.js').then(m => m.runPhase1StatsMigration())`. Il pulsante è stato rimosso dall’UI admin dopo stabilizzazione in produzione.
- **Profilo in-app:** dati personali, statistiche, **Missioni** (attiva / lista / annulla), **Premi Plus** (solo contatori 0–10 e testo effetti). Scelta premio **solo** a inizio partita (overlay in `index.html`); effetti run in `game-engine.js` (incluso Verde Plus = cursore rimpicciolito).
- **Profilo pubblico** (`profile.html` + `profile-public.js`): statistiche e premi legacy in anteprima; **non** espone ancora i contatori `prizes` della nuova tasca (API pubblica `GET /api/player/stats/:userId` resta `publicStatsShape` senza inventario premi).
- **Backup Firestore:** snapshot gestito es. `gs://dodge-84439-firestore-backups/firestore_backup_20260508_231902` — inventario anche in `ROLLBACK_PLAN.md` (root repo).

Oggetto `firebaseConfig` dell’app web: `public/js/firebase-init.js` (unica fonte nel repo).

---

## Struttura (`evoluzione/`)

```
evoluzione/
├── public/
│   ├── auth.html
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── icons/           (icon-192.png, icon-512.png)
│   ├── css/style.css
│   └── js/
│       ├── firebase-init.js
│       ├── auth.js
│       ├── profile.js
│       ├── leaderboard.js
│       ├── constants.js
│       ├── missions-config.json
│       ├── admin.js
│       ├── profile-public.js
│       ├── viewport-ui-scale.js   (--ui-scale + gap visual viewport, condiviso gioco / profilo pubblico / admin)
│       └── game-engine.js
│   ├── admin.html
│   ├── profile.html
├── functions/           (Cloud Functions v2: `api`)
├── generate-icons.js    (opzionale: rigenera icone PNG)
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── database.rules.json
└── .firebaserc
```

---

## Stato attuale

- `auth.html`: registrazione, verifica email, login, reset password.
- `auth.html`: registrazione, verifica email, login email/password, accesso Google, reset password.
- `index.html` + `game-engine.js`: gioco con auth guard e home screen.
- **Home:** **DODGE** + nome in fascia alta (logo abbassato verso i pallini); pallini + tagline solo sulla zona **`home-howto-hitbox`** (tap → **`view-howto`**, non tutta la fascia); due **`home-modes-spacer`** (`flex:1`) centrano la riga modalità tra fine tagline e area pulsanti tondi; ordine pulsanti **CO‑OP | GIOCA | 1‑VS‑1** (GIOCA centro, più alto). **Basso:** audio | classifica | **profilo** (icona tonda **viola**).
- **Caricamento auth:** `#authLoading` con la **stessa riga pallini** classi `menu-bonus-dot` e posizione centrale come la home.
- **Classifica da home** (`view-leaderboard`): solo **⌂ blu centrato** in basso; **nessun** audio. **Profilo:** idem. **Come si gioca** (`view-howto`): solo **⌂ blu centrato** (come classifica); **nessun** audio. **Profilo pubblico** (`profile.html`): stesso stile del ⌂ in-app; **`--ui-scale`** da `viewport-ui-scale.js`. **`admin.html`:** stesse classi del profilo pubblico — `<html class="page-scroll-root">`, `<body class="page-scroll-body">`, `<main class="screen-view screen-view--sub admin-page" style="display:flex;">`. Le classi `admin-html`/`admin-body`/`admin-view` sono state **rimosse** insieme al gate inline e all'overlay `admin-auth-blocking` (causavano stati ambigui per il touch-handler iniziale). Barra inferiore `position: fixed` nera, **⌂ a sinistra, profilo a destra**; il padding-bottom per la barra è applicato via `.admin-page.screen-view--sub` (analogo a `.profile-public-page.screen-view--sub`). **SW** bumpato (`dodge-v20`) per invalidare cache PWA.
- **Death screen:** solo **⌂ blu centrato** in basso (**nessun** audio), **stesse dimensioni** degli altri ⌂ (52–54px scala UI); tap ovunque per riprovare.
- **Modalità guest offline:** da `auth.html` è disponibile il pulsante `Provalo offline`; entra nel gioco senza account, mostra il tempo nel game over per screenshot, **nessun salvataggio** su Firestore. **Classifica globale** dall’icona **gialla** in basso al centro sulla home; schermata **Profilo** mostra copy ospite + pulsante opzionale «Accedi o registrati» (senza «ESCI» verso login come unico gesto).
- **Classifica:** due tab **Generale** (TOP 15, miglior tempo assoluto; pallino colore del **Premio Plus** usato in quel record se presente) e **Pura** (TOP 15 solo run **senza** premio Plus). Firestore: `leaderboard` / `scores` (+ campo opzionale `prize_used`), `leaderboard_pure` scritta solo dal backend. La pura ricostruisce da `orderBy(ms)` + filtro client `isPureScoreRow` (i vecchi score senza campo devono contare come puri; non usare `where prize_used == null` da solo). `applyOptimisticScore` passa anche il premio della run; `saveScore` (fallback) conta come pura.
- **Formato tempo UI:** ovunque nel gioco/classifica/profilo il timer è in `mm:ss:000` (millisecondi a 3 cifre, minuti senza limite ore).
- **Profilo:** username account (fisso), **nome visualizzato** (modificabile, max 24 caratteri, compare in classifica), miglior tempo personale (`bestTime`); pannelli **Missioni** e **Premi Plus** collegati alle API sopra. **Copy missioni/premi:** sotto «Inizia partita» nell’overlay premio e nel pannello Missioni è indicato che le run **con** premio Plus non contano per le missioni (solo «Gioca puro»).
- PWA: manifest, service worker, icone.
- Target: **mobile** (PC browser secondario).

---

## Architettura navigazione (`game-engine.js`)

- `showScreenView(name)` → `'home'|'leaderboard'|'profile'|'howto'|'death'`; imposta `uiChromeScreen` e `syncAudioChromeVisibility()` (audio nascosto in **playing**, **leaderboard**, **profilo**, **howto**, **death**). Mostra/nasconde `#homeCornerBtn` in vista **death**.
- `hideScreen()` → usato da `startGame` (nasconde anche il pulsante HOME angolo).
- `bindHomeNav()` → da `onAuthStateChanged`
- `isControlTarget(el)` → evita `startGame` con home visibile (non death); include `#audioCornerBtn`, `#homeCornerBtn`.
- Avvio fullscreen: tentativo automatico all’avvio (e retry su prima interazione) per esperienza più “app-like”; pulsante fullscreen rimosso.
- Avvio da browser non installato: nudge installazione (`#installNudge`) mostrato ad ogni apertura; su Android appare solo quando arriva `beforeinstallprompt` (evita falsi positivi in standalone), su iOS mostra istruzioni “Condividi → Aggiungi a Home”.
- `records-block` / `records-block-lb` → classifiche
- `leaderboard.js`: `fetchBothLeaderboards()` carica generale + pura; `fetchLeaderboard('general'|'pure')`; `saveScore` aggiorna `users`/`scores`/`leaderboard`. Cache separate per tab.

---

## Prossime tappe

### TAPPA 4 — Multiplayer 1vs1

- Stanza con codice (host / guest)
- Matchmaking random
- Sync cursori (Realtime Database)
- Cursori bianco / arancione
- Best of 3, sudden death
- UI vittoria/sconfitta
- Sblocco pulsante CO-OP quando previsto

### TAPPA 5 — Sicurezza e polish

- Rate limiting Firestore
- Anti-cheat lato server
- Test sicurezza
- Grafica / UX

---

## Decisioni di design

- Username unico, 3–20 caratteri, `[a-zA-Z0-9_]` (fisso dopo registrazione)
- **Nome visualizzato** (`displayName` su `users`): stesso valore dello username alla registrazione, poi editabile in profilo; in classifica e negli score salvati si usa quello (privacy).
- 1vs1: stesso campo; bonus al primo contatto
- Bonus (testo help allineato al gioco): **rosso** = scudo a tempo; **viola** = vita extra (satelliti); blu/giallo/verde come in `COME SI GIOCA`.
- Bonus giallo/verde/blu: effetti globali per entrambi (dove applicabile in futuro 1vs1)
- Co-op, ads, GDPR/banner: rimandati
- Distribuzione: link → browser → “Aggiungi a Home” (PWA)
- Lingua UI: italiano

---

## Comandi utili

```powershell
cd C:\Users\Daniele\Desktop\dodge\evoluzione
firebase deploy --only functions
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only database
```

Dopo un rollout che tocca **solo** `functions/index.js`, serve almeno `firebase deploy --only functions` (e hosting se cambia `public/`).

Test statico locale (HTTP, come in produzione): dalla cartella `public`, avvia un server sulla porta scelta e apri `/index.html` dalla root del server.

---

## Note

- La cartella `.firebase/` è cache CLI: ignorata da git (vedi `.gitignore` nella root del repo).
- Il vecchio percorso sotto `.claude/worktrees/.../evoluzione` è stato **svuotato/rimosso**; la sorgente canonica è solo `dodge\evoluzione\`.
- **Workflow correzioni UX / fuori roadmap:** aggiornare questo file quando cambiano flussi o copy visibili all’utente, poi **commit + push** su `main` così il repo resta allineato.
- **Deploy Firebase Hosting:** dopo modifiche a `public/`, l’agente esegue `firebase deploy --only hosting` da questa cartella così **https://dodge-84439.web.app** mostra subito le novità (a meno che non chiedi di saltarlo).
- **Cache / PWA:** `public/sw.js` usa **rete prima** per HTML/JS/CSS (`fetch` con `cache: 'no-store'`) e precache per offline; il deploy non richiede decine di minuti. Se un client restasse incastrato, incrementare la costante `CACHE` in cima a `sw.js` e ridistribuire.
