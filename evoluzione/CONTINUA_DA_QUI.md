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
- **Servizi attivi:** Authentication (email+password), Firestore, Realtime Database, Hosting, **Cloud Functions v2** (`api`, region `europe-west1`). **Presenza affluenza:** `app_presence/sessions` su RTDB (write da `game-engine.js`); regole in `database.rules.json`. *(Il KPI «sessioni aperte» non è più in panoramica admin; overview KPI parte solo da `scores`.)*
- **API HTTP:** rewrite Hosting `/api/**` → function `api`; es. `GET /api/player/stats` (Bearer token). Fine partita: `POST /api/game/end` (stats + storico + classifica). **Missioni e premi Plus:** `GET /api/missions/current`, `POST /api/missions/activate`, `POST /api/missions/cancel`, `GET /api/prizes`, `POST /api/game/start` (imposta `pending_run_prize` su `player_stats`), poi `POST /api/game/end` con `prize_used` (server usa `pending_run_prize`), contatori missione (`green_skipped_this_run`, `max_extra_lives_simultaneous_this_run`, ecc.). **`recent_games`** include `prize_used`. **Parametri missioni** (durata finestra, soglie bonus/partite, premio al completamento): `public/js/missions-config.json`; esportati anche da `constants.js` (`MISSION_WINDOW_MS`, `getProfileMissionDefs`). Copia automatica in `functions/` alla predeploy Functions (`scripts/copy-missions-config.js`).
- **Firestore `player_stats` (oltre ai campi stats esistenti):** `active_mission`, `mission_started_at`, `mission_progress`, `prizes` (map 5 tipi 0–10), `pending_run_prize`. Nuovi utenti: creato solo lato server (`upsertPlayerStatsIfMissing` in Functions, es. `GET /api/player/stats` / `game/start`); `claimUsername` scrive solo `users` + `usernames`.
- **Migrazione campi missioni/premi:** `POST /api/admin/migrate-missions-fields` (Bearer admin), idempotente, dopo backup se in produzione.
- **Allinea classifica al profilo (solo admin):** `POST /api/admin/sync-leaderboard-from-user-profile` body `{ "target_uid": "<uid>", "force_ms"?: number }` — senza `force_ms` copia `users.bestTime` (ms); **con `force_ms`** aggiorna anche `users.bestTime`, poi `leaderboard` + `leaderboard_pure`, rimuove `prize_used` sulla generale, aggiorna `player_stats.best_time_seconds` se esiste, **elimina** da `scores` le righe con `ms` maggiore. CLI: `functions/tools/fix-player-leaderboard-from-profile.js` (dal profilo) o `functions/tools/set-canonical-best-ms.js <needle|--> --uid= … <ms> [--apply]`.
- **Test premi in tasca (solo admin):** `POST /api/admin/grant-self-test-plus-prizes` oppure pulsante in `admin.html` — imposta sul proprio `player_stats` tutti i `prizes` Plus a **10/10** (per provare il picker a inizio partita; con 10/10 non si può attivare la missione di quel colore finché non consumi premi).
- **Migrazione stats storiche (solo emergenza):** `POST /api/admin/backfill-stats-from-history` con Bearer admin, dopo backup Firestore; oppure da console: `import('/js/stats-migration.js').then(m => m.runPhase1StatsMigration())`. Il pulsante è stato rimosso dall’UI admin dopo stabilizzazione in produzione.
- **Admin overview:** KPI e distribuzione soglie (con percentuali sul totale partite archivio) solo dalla collezione **`scores`** (`ms`, `createdAt`) in `GET /api/admin/overview`; finestre 24h/7gg solo su documenti con data creazione leggibile. **Elenco giocatori** (`GET /api/admin/players`): solo documenti `users` Firestore (non il totale Auth). **Utenti orfani:** `POST /api/admin/scan-fix-orphaned-users` (`dry_run` default `true`) confronta Auth con `users`; in admin, overview → «Scansiona utenti orfani» / «Crea profili mancanti».
- **Profilo Auth:** `ensureProfileForUser` in `profile.js` (Google + recovery in `game-engine.js`); registrazione email con rollback Auth se `claimUsername` fallisce. **Nome in classifica:** regole Firestore consentono `update` client su `leaderboard/{uid}` e `leaderboard_pure/{uid}` solo per `displayName` + `updatedAt` (ms/uid immutabili).
- **Profilo in-app:** dati personali, statistiche, **Missioni** (attiva / lista / annulla), **Premi Plus** (solo contatori 0–10 e testo effetti). Scelta premio **solo** a inizio partita (overlay in `index.html`); effetti run in `game-engine.js` (incluso Verde Plus = cursore rimpicciolito).
- **Profilo pubblico** (`profile.html` + `profile-public.js` + moduli condivisi `profile-best-display.js`, `profile-kpi-display.js`, `profile-threshold-display.js`): layout allineato al tab **Stats** in-app (card miglior tempo, KPI, soglie totale/serie/record, bonus raccolti). Le API `GET /api/player/stats` e `GET /api/player/stats/:userId` includono **`best_general_ms`**, **`best_pure_ms`**, **`best_general_prize_used`** e, via `publicStatsShape`, morti per tipo + contatori soglia/streak (`runs_over_*`, `current_streak_over_*`, `best_streak_over_*`) oltre a `collected`. UI profilo (in-app + pubblico): una riga **Miglior tempo** se coincide col puro; se diverso, seconda riga **Miglior tempo puro** e il tempo generale evidenziato col **colore del premio** se noto. **`users.bestTime_prize_used`:** scritto da `POST /api/game/end` quando migliora il PB (delete se run senza Plus); **cancellato** da sync canonico admin / tool `set-canonical-best-ms`.
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
│       ├── profile-best-display.js   (miglior tempo / puro profilo)
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
- **Home:** **DODGE** + nome in fascia alta (logo abbassato verso i pallini); pallini + tagline decorativi (**`home-howto-hitbox`**, senza tap); due **`home-modes-spacer`** (`flex:1`) centrano la riga modalità tra fine tagline e area pulsanti tondi; ordine pulsanti **CO‑OP | Resisti! | 1‑VS‑1** (centro più alto). Link **`come si gioca`** (`#btn-home-howto`) fisso sopra la classifica. **Basso:** audio | classifica | **profilo** (icona tonda **viola**).
- **Caricamento auth:** `#authLoading` con la **stessa riga pallini** classi `menu-bonus-dot` e posizione centrale come la home.
- **Classifica da home** (`view-leaderboard`): solo **⌂ blu centrato** in basso; **nessun** audio. **Profilo:** idem. **Come si gioca** (`view-howto`): solo **⌂ blu centrato** (come classifica); **nessun** audio. **Profilo pubblico** (`profile.html`): stesso stile del ⌂ in-app; **`--ui-scale`** da `viewport-ui-scale.js`. **`admin.html`:** stesse classi del profilo pubblico — `<html class="page-scroll-root">`, `<body class="page-scroll-body">`, `<main class="screen-view screen-view--sub admin-page" style="display:flex;">`. Le classi `admin-html`/`admin-body`/`admin-view` sono state **rimosse** insieme al gate inline e all'overlay `admin-auth-blocking` (causavano stati ambigui per il touch-handler iniziale). Barra inferiore `position: fixed` nera, **⌂ a sinistra, profilo a destra**; il padding-bottom per la barra è applicato via `.admin-page.screen-view--sub` (analogo a `.profile-public-page.screen-view--sub`). **SW** bumpato (`dodge-v20`) per invalidare cache PWA.
- **Death screen:** solo **⌂ blu centrato** in basso (**nessun** audio), **stesse dimensioni** degli altri ⌂ (52–54px scala UI); tap ovunque per riprovare. Al contatto la scena sul canvas **si ferma sul frame** (niente schermata nera); poi reveal unico con **TOP 5** (Generale/Pura), **Serie attuale** e **missione attiva** (run Plus non avanzano le missioni). Serie: `GET /api/player/stats` o fallback pubblico `GET /api/player/stats/:uid` (come `profile.html`). Ospite / email non verificata: nessun estratto cloud.
- **Modalità guest offline:** da `auth.html` è disponibile il pulsante `Provalo offline`; entra nel gioco senza account, mostra il tempo nel game over per screenshot, **nessun salvataggio** su Firestore. **Classifica globale** dall’icona **gialla** in basso al centro sulla home; schermata **Profilo** mostra copy ospite + pulsante opzionale «Accedi o registrati» (senza «ESCI» verso login come unico gesto).
- **Classifica:** due tab **Generale** (TOP 15, miglior tempo assoluto; pallino colore del **Premio Plus** usato in quel record; codice sconosciuto → pallino grigio) e **Pura** (TOP 15 solo run **senza** premio Plus). Vista classifica: solo tab + lista record (nessun testo esplicativo sotto i tab). Firestore: `leaderboard` / `scores` (+ campo opzionale `prize_used`), `leaderboard_pure` scritta solo dal backend. La pura unisce `leaderboard_pure` + `scores` puri con scansione ampia (`FALLBACK_SCAN_LIMIT` in `leaderboard.js`, es. 2500 righe) perché molte run Plus in cima a `scores` non «taglino fuori» tempi puri alti. **`isPureScoreRow`:** conta come pura anche `prize_used === false` o `0` (legacy). Diagnostica produzione: da `evoluzione/functions` eseguire `node tools/diag-leaderboard-gap.js bartolomeo` con credenziali Admin (`GOOGLE_APPLICATION_CREDENTIALS` o ADC `gcloud auth application-default login`). `applyOptimisticScore` passa anche il premio della run. **Salvataggio partita**: il client genera un `run_id` (UUID) in `postGameStartApi` e lo invia sia a `/api/game/start` che a `/api/game/end`. Il backend usa `pending_run_id` / `last_completed_run_id` su `player_stats` per garantire idempotenza (chiamata duplicata → `{ok:true, duplicate:true}`) e accoppiamento (mismatch → `409 run_id_mismatch`). Il client (`callGameEnd` in `game-engine.js`) ritenta solo su 5xx/rete con backoff 500/1000/2000ms, mai sui 4xx. **Nessun fallback client-side**: `saveScore` e l'endpoint `/api/game/publish-best-from-profile` sono stati **rimossi**; le firestore rules bloccano la scrittura di `bestTime`/`bestTime_prize_used`/`gamesPlayed` da client (fonte di verità: solo backend Admin SDK).
- **Formato tempo UI:** ovunque nel gioco/classifica/profilo il timer è in `mm:ss:000` (millisecondi a 3 cifre, minuti senza limite ore).
- **Profilo:** username account (fisso), **nome visualizzato** (modificabile, max 24 caratteri, compare in classifica), statistiche con **miglior tempo** vs **miglior tempo puro** (vedi API sopra); pannelli **Missioni** e **Premi Plus** collegati alle API sopra. **Copy missioni/premi:** sotto «Tenta col premio» nell’overlay premio e nel pannello Missioni è indicato che le run **con** premio Plus non contano per le missioni (solo «Gioca puro»).
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
- `leaderboard.js`: `fetchBothLeaderboards()` carica generale + pura; `fetchLeaderboard('general'|'pure')`; `applyOptimisticScore` aggiorna la cache locale per feedback immediato. Le scritture vere su `users`/`scores`/`leaderboard` passano **solo** dal backend via `/api/game/end`. Cache separate per tab.

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
