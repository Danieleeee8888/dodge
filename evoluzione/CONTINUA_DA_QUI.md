# DODGE evoluzione — handoff per nuova sessione

## Dove lavorare

- **Gioco originale (GitHub Pages):** `C:\Users\Daniele\Desktop\dodge\` — `index.html`, `css/`, `js/` (non mischiare con Firebase).
- **DODGE evoluzione (PWA + Auth + Firebase):** `C:\Users\Daniele\Desktop\dodge\evoluzione\` — **tutte le modifiche alla versione online vanno qui.**

Path assoluti consigliati per strumenti che accettano path completi: prefisso `C:\Users\Daniele\Desktop\dodge\evoluzione\`.

---

## Firebase

- **Project ID:** `dodge-84439`
- **Hosting URL:** `https://dodge-84439.web.app`
- **Piano:** Spark (gratis, senza carta di credito)
- **Servizi attivi:** Authentication (email+password), Firestore, Realtime Database, Hosting

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
│       └── game-engine.js
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
- **Home:** titolo **DODGE**, margine sotto titolo per il nome utente (rimossi i tre span fantasma); **GIOCA** **più grande** al centro rispetto a CO‑OP / 1‑VS‑1. **Cinque pallini bonus** come nel gioco (diametro da canvas / `HAZARD_R`, senza glow), **lampeggio** `menuDotBreath`, posizione **fissa ~47% altezza viewport** con tagline sotto; coerente con **schermata caricamento auth**. Barra bassa: audio | classifica gialla | profilo blu su nero; dopo login **`scheduleViewportSync`** + evento **`pageshow`** ricalcolano `visualViewport` (PWA); in **standalone** piccolo **nudge** su `--chrome-bar-bottom` se `safe-area` è bassa.
- **Caricamento auth:** `#authLoading` con la **stessa riga pallini** classi `menu-bonus-dot` e posizione centrale come la home.
- **Classifica da home** (`view-leaderboard`): solo **⌂** viola **centrato** in basso; **nessun** audio. **Profilo:** solo **⌂** viola centrato; **nessun** audio. **Come si gioca:** **audio** sinistra + **indietro** (‹) destra.
- **Death screen:** solo **⌂** viola centrato in basso (**nessun** audio), **stesse dimensioni** degli altri ⌂ (52–54px scala UI); tap ovunque per riprovare.
- **Modalità guest offline:** da `auth.html` è disponibile il pulsante `Provalo offline`; entra nel gioco senza account, mostra il tempo nel game over per screenshot, **nessun salvataggio** su Firestore. **Classifica globale** dall’icona **gialla** in basso al centro sulla home; schermata **Profilo** mostra copy ospite + pulsante opzionale «Accedi o registrati» (senza «ESCI» verso login come unico gesto).
- **Classifica:** `applyOptimisticScore` + `renderRecordsInto` subito dopo la morte; `saveScore` legge il **nome visualizzato** da `users/{uid}` (non dalla sessione) e scrive `displayName` su `scores` / `leaderboard`; merge con storico `scores` + refresh in background. Layout righe: posizione + nome a sinistra, tempo a destra allineato.
- **Formato tempo UI:** ovunque nel gioco/classifica/profilo il timer è in `mm:ss:000` (millisecondi a 3 cifre, minuti senza limite ore).
- **Profilo:** username account (fisso), **nome visualizzato** (modificabile, max 24 caratteri, compare in classifica), miglior tempo personale (`bestTime`).
- PWA: manifest, service worker, icone.
- Target: **mobile** (PC browser secondario).

---

## Architettura navigazione (`game-engine.js`)

- `showScreenView(name)` → `'home'|'leaderboard'|'profile'|'howto'|'death'`; imposta `uiChromeScreen` e `syncAudioChromeVisibility()` (audio nascosto in **playing**, **leaderboard**, **profilo**, **death**). Mostra/nasconde `#homeCornerBtn` in vista **death**.
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
