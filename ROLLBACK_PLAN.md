# Piano di rollback — snapshot `pre-stats-system`

Questo progetto **Evoluzione** usa **Firebase** (Hosting, Cloud Functions, Firestore, Auth, Realtime Database dove presente).  
La documentazione originale menzionava PostgreSQL/Railway: **non applicabile** a questo codebase; per il DB dei giocatori fare riferimento a **Firestore**.

Obiettivo: ripristinare codice e dati allo stato marcato dal tag Git `pre-stats-system`, anche mesi dopo, senza ricordare il contesto.

---

## Prerequisiti

- [Firebase CLI](https://firebase.google.com/docs/cli) installata e progetto selezionato (`firebase login`, `firebase use <projectId>`).
- Accesso al repo Git e permesso di deploy.
- Copie dei backup dati (vedi sotto) **fuori** dalla sola macchina locale (cloud o disco archiviato).

---

## 1) Rollback del codice (Git)

```bash
git fetch --all --tags
git checkout pre-stats-system
```

Opzionale: branch dedicata al rollback:

```bash
git checkout -b rollback/pre-stats-system pre-stats-system
```

Per tornare allo stato precedente **senza** cambiare branch locale:

```bash
git checkout main
```

Il tag annotato va tenuto sul remoto (una tantum):

```bash
git push origin pre-stats-system
```

---

## 2) Backup dati Firebase (Fase 0 — da eseguire prima di modifiche a schema/logiche)

### Firestore (consigliato: export gestito)

Da progetto Google Cloud collegato a Firebase:

```bash
gcloud firestore export gs://TUO_BUCKET/firestore_backup_YYYYMMDD_HHMMSS
```

Salvare il path `gs://...` in un file di inventario backup insieme alla data.

### Realtime Database (se usata)

Esporta JSON dalla console o:

```bash
firebase database:get / --pretty > rtdb_backup_YYYYMMDD_HHMMSS.json
```

### Auth

Dalla console Firebase (Authentication) esporta gli utenti quando disponibile, oppure documenta UID/email critici. Per import programmatico servono i parametri hash del progetto (documentati in console).

### Verifica restore Firestore su progetto di test

Creare un progetto Firebase di staging ed eseguire import da snapshot solo dopo aver letto la documentazione ufficiale “import/export”; non distruggere produzione senza dry-run.

---

## 3) Ripristino dati (dopo aver salvato backup validi)

Procedura dipendente dal tipo di backup effettuato nella Fase 0:

1. **Firestore**: restore da snapshot/export gestito (Google Cloud), non copiando manualmente documenti salvo emergenza.
2. **Realtime Database**: import del JSON di backup con conferma in console o CLI coerente con la doc Firebase vigente al momento del restore.
3. **Auth**: solo se si dispone di export compatibile e parametri hash corretti.

Aggiornare sempre questa sezione con **path reali** del bucket e nome file dopo ogni backup.

---

## 4) Deploy servizi dopo rollback codice

Dalla cartella `evoluzione/`:

```powershell
Set-Location path\to\dodge\evoluzione
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,firestore:indexes
```

Se si usa Realtime Database:

```powershell
firebase deploy --only database
```

Ordine tipico: **rules/indexes** → **functions** → **hosting** (o come da dipendenze del tuo team).

---

## 5) Variabili d’ambiente / segreti

Le chiavi API Firebase pubbliche stanno nel client; segreti server-side vanno in **Google Cloud / Functions config**.  
Non committare mai `.env` di produzione. Salvare uno screenshot o export in password manager / file cifrato **locale**.

---

## 6) Checklist post-rollback

- [ ] Checkout sul commit/tag previsti (`git describe --tags`)
- [ ] Deploy Hosting + Functions completato senza errori
- [ ] Login utente test OK
- [ ] Classifica e salvataggio partita OK
- [ ] Profilo e API `/api/*` rispondono come previsto

---

## 7) Contatti / progetto

Annotare qui il **project ID Firebase** e l’URL Hosting di produzione dopo il deploy:

| Campo            | Valore |
|-----------------|--------|
| Firebase project | `dodge-84439` |
| Hosting URL      | `https://dodge-84439.web.app` |
| Ultimo export Firestore (GCS) | `gs://dodge-84439-firestore-backups/firestore_backup_20260508_231902` |
