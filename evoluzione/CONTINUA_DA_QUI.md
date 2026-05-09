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
- **Servizi attivi:** Authentication (email+password), Firestore, Realtime Database, Hosting, **Cloud Functions v2** (`api`, region `europe-west1`)
- **API HTTP:** rewrite Hosting `/api/**` → function `api`; es. `GET /api/player/stats` (Bearer token). Fine partita: `POST /api/game/end` (stats + storico + classifica allineata al vecchio `saveScore`).
- **Migrazione stats storiche (solo emergenza):** `POST /api/admin/backfill-stats-from-history` con Bearer admin, dopo backup Firestore; oppure da console: `import('/js/stats-migration.js').then(m => m.runPhase1StatsMigration())`. Il pulsante è stato rimosso dall’UI admin dopo stabilizzazione in produzione.
- **Profilo in-app:** layout a quattro pannelli verticali (dati personali, statistiche, premi e missioni in anteprima non interattiva) in `public/index.html` + classi `.profile-layout` / `.profile-panel` in `style.css`.
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
- **Classifica:** `applyOptimisticScore` + `renderRecordsInto` subito dopo la morte; `saveScore` legge il **nome visualizzato** da `users/{uid}` (non dalla sessione) e scrive `displayName` su `scores` / `leaderboard`; merge con storico `scores` + refresh in background. Layout righe: posizione + nome a sinistra, tempo a destra allineato.
- **Formato tempo UI:** ovunque nel gioco/classifica/profilo il timer è in `mm:ss:000` (millisecondi a 3 cifre, minuti senza limite ore).
- **Profilo:** username account (fisso), **nome visualizzato** (modificabile, max 24 caratteri, compare in classifica), miglior tempo personale (`bestTime`).
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
- `leaderboard.js`: `saveScore(uid, ms)` aggiorna `users`, append `scores`, eventualmente `setDoc` su `leaderboard/{uid}`; `fetchLeaderboard` unisce `leaderboard` + `scores` e risolve i nomi.

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
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only database
```

Test statico locale (HTTP, come in produzione): dalla cartella `public`, avvia un server sulla porta scelta e apri `/index.html` dalla root del server.

---

## Note

- La cartella `.firebase/` è cache CLI: ignorata da git (vedi `.gitignore` nella root del repo).
- Il vecchio percorso sotto `.claude/worktrees/.../evoluzione` è stato **svuotato/rimosso**; la sorgente canonica è solo `dodge\evoluzione\`.
- **Workflow correzioni UX / fuori roadmap:** aggiornare questo file quando cambiano flussi o copy visibili all’utente, poi **commit + push** su `main` così il repo resta allineato.
- **Deploy Firebase Hosting:** dopo modifiche a `public/`, l’agente esegue `firebase deploy --only hosting` da questa cartella così **https://dodge-84439.web.app** mostra subito le novità (a meno che non chiedi di saltarlo).
- **Cache / PWA:** `public/sw.js` usa **rete prima** per HTML/JS/CSS (`fetch` con `cache: 'no-store'`) e precache per offline; il deploy non richiede decine di minuti. Se un client restasse incastrato, incrementare la costante `CACHE` in cima a `sw.js` e ridistribuire.
