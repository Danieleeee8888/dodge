# Implementazione sistema missioni e premi Plus

## Contesto

Stiamo implementando il sistema "missioni → premi Plus" per il gioco. 
Stack: Firebase/Firestore + Cloud Functions + frontend in /evoluzione/public.

Il sistema funziona così:
- Ci sono 5 missioni (una per colore) e 5 tipi di premi Plus
- Ogni missione completata assegna **3 premi** del colore corrispondente
- Il giocatore può attivare 1 sola missione alla volta
- Le missioni durano 24h dall'attivazione o fino al completamento
- La scelta del premio da attivare avviene **solo all'inizio della 
  partita**, in una schermata dedicata; **non è possibile pre-attivare 
  premi dal profilo** (la tab Premi mostra solo i contatori posseduti)
- I premi attivi modificano i bonus base del gioco
- Le run con premi attivi NON contano per progredire le missioni

Tutto il sistema deve essere costruito sopra le stats già esistenti in 
`player_stats` e `recent_games`.

## Riferimento esterno per la grafica

Per implementare l'effetto **Verde Plus** (cursore rimpicciolito invece 
dei bianchi), prendi come riferimento la versione del progetto presente in:

```
C:\Users\Daniele\Desktop\dodge - Copia
```

In quella copia c'è un'implementazione del cursore rimpicciolito che va 
riutilizzata o adattata. Apri quella cartella, identifica la logica di 
rendering del cursore in modalità ridotta, e portala nel progetto attuale 
in `evoluzione/public/`. Non rifare il lavoro da zero se è già stato fatto 
lì in modo soddisfacente.

## FASE 0 — Backup

Prima di iniziare, esegui:

1. Backup Firestore con `gcloud firestore export` su GCS (come fatto 
   per il sistema stats)
2. Tag Git `pre-missions-system` e push su remoto
3. Aggiorna `ROLLBACK_PLAN.md` con i nuovi step di rollback per questo 
   sistema (come tornare al tag, come fare restore Firestore)

Mostrami l'esito di ogni step.

## FASE 1 — Schema database

### Modifica documento `player_stats`

Aggiungi questi campi (mantieni i preesistenti):

- `active_mission` (string | null) — codice della missione attiva 
  (es. "red_plus") o null se nessuna
- `mission_started_at` (timestamp | null) — quando è stata attivata
- `mission_progress` (map) — progresso attuale, struttura dipende dal tipo:
  - per missioni "X bonus in stessa partita, in Y partite": 
    `{ qualifying_runs: 0, target_runs: 10 }`
  - per missioni cumulative: 
    `{ counter: 0, target: 100 }`
- `prizes` (map) — premi accumulati in tasca:
  ```
  {
    red_plus: 0,
    blue_plus: 0,
    yellow_plus: 0,
    green_plus: 0,
    purple_plus: 0
  }
  ```

NOTA: **non serve un campo `active_prize` persistito**. La scelta del 
premio avviene solo a inizio partita, viene passata al server via 
`POST /api/game/start`, e il server la traccia per la durata di quella 
run. Vedi Fase 3.

### Modifica `recent_games`

Aggiungi:
- `prize_used` (string | null) — quale premio era attivo per quella run, 
  null se nessuno

### Migration

Per gli utenti esistenti: aggiungi i nuovi campi con valori default 
(`active_mission=null`, `mission_progress={}`, `prizes={tutti zero}`).

Mostrami query di verifica che restituisca: utenti totali, utenti con 
`prizes` inizializzato, utenti con `active_mission` inizializzato 
(devono coincidere col totale utenti).

## FASE 2 — Backend: gestione missioni

### Endpoint: attivare una missione

`POST /api/missions/activate`

- Body: `{ mission_code: "red_plus" }` — valori validi: `red_plus`, 
  `blue_plus`, `yellow_plus`, `green_plus`, `purple_plus`
- Validazioni:
  - L'utente NON deve avere già un'altra missione attiva
  - L'utente NON deve avere già 10 premi del tipo corrispondente in tasca
- Logica:
  - Imposta `active_mission`, `mission_started_at = now()`
  - Imposta `mission_progress` con valori iniziali corretti per il tipo:
    - `red_plus`, `blue_plus`, `green_plus`, `purple_plus`: 
      `{ qualifying_runs: 0, target_runs: 10 }`
    - `yellow_plus`: `{ counter: 0, target: 100 }`
- Restituisce: missione attivata + scadenza (`started_at + 24h`)

### Endpoint: visualizzare missione attiva

`GET /api/missions/current`
- Restituisce: missione attiva + progresso + tempo rimanente
- Se non attiva, restituisce `{ active: null }`

### Endpoint: annullare una missione

`POST /api/missions/cancel`
- Resetta `active_mission`, `mission_started_at`, `mission_progress` a 
  valori vuoti/null
- Da usare quando il giocatore vuole liberare lo slot per attivarne 
  un'altra

### Endpoint: lista premi posseduti

`GET /api/prizes`
- Restituisce: counts dei 5 tipi di premi in tasca

NOTA: non c'è più un endpoint `POST /api/prizes/activate` separato. La 
selezione del premio avviene solo all'inizio della partita tramite 
`POST /api/game/start` (vedi sotto).

### Logica scadenza missioni

In `POST /api/game/end` (esistente), all'inizio:
- Se `active_mission != null` e `now() - mission_started_at > 24h`:
  - Resetta `active_mission`, `mission_started_at`, `mission_progress`
  - Continua normalmente (la run di adesso non conta per nessuna missione)

Aggiungi anche un check on-demand all'apertura del profilo 
(`GET /api/missions/current`) che faccia lo stesso reset se scaduta.

## FASE 3 — Backend: integrazione missioni con fine partita

Modifica `POST /api/game/end` per gestire il progresso missioni e il 
consumo premi.

### Payload aggiuntivo da gestire

Il client deve inviare nel payload (in aggiunta a quanto già invia):

- `prize_used`: string | null — quale premio era attivo (copiato da 
  `active_prize` all'inizio della run)
- Tracking specifico per missioni:
  - `red_collected_this_run`: int (già presente in `bonuses_collected.red`)
  - `blue_collected_this_run`: int (già presente in `bonuses_collected.blue`)
  - `green_collected_this_run`: int (già presente in `bonuses_collected.green`)
  - `purple_collected_this_run`: int (già presente in `bonuses_collected.purple`)
  - `whites_killed_by_yellow_this_run`: int (NUOVO se non presente)
  - `green_skipped_this_run`: int (NUOVO — verdi che entrano in campo e 
    scompaiono senza essere raccolti)
  - `max_extra_lives_simultaneous_this_run`: int (NUOVO — il MAX numero 
    di vite extra possedute contemporaneamente in qualsiasi momento 
    della run)

### Logica server-side

Dentro la transazione:

1. Aggiorna stats globali (come oggi)
2. Inserisci `recent_games` con `prize_used` (NUOVO campo, valore preso 
   dal `pending_run_prize` salvato da `/api/game/start`, o dal payload 
   inviato dal client — scegli il metodo più affidabile)
3. Se `prize_used != null`:
   - Decrementa di 1 il counter del premio in `prizes.[prize_code]`
   - Resetta `pending_run_prize` a null
   - **NON aggiornare il progresso missioni** (regola d'oro)
4. Se `prize_used == null` E `active_mission != null`:
   - Verifica se la run qualifica per la missione attiva:
     - `red_plus`: `red_collected_this_run >= 6` → `qualifying_runs += 1`
     - `blue_plus`: `blue_collected_this_run >= 5` → `qualifying_runs += 1`
     - `green_plus`: `green_skipped_this_run >= 2` → `qualifying_runs += 1`
     - `purple_plus`: `max_extra_lives_simultaneous_this_run >= 2` → `qualifying_runs += 1`
     - `yellow_plus`: `counter += whites_killed_by_yellow_this_run`
   - Se la missione è completata:
     - Verifica cap: `prizes.[mission_code] + 3 <= 10`?
       - Se sì: assegna **3 premi**
       - Se no: assegna fino al cap (es. se hai 8, ne assegna solo 2 
         per arrivare a 10) e includi un warning nella response
     - Resetta `active_mission`, `mission_started_at`, `mission_progress`

### Endpoint per il client all'inizio run

`POST /api/game/start`

- Body: `{ prize_code: "red_plus" }` oppure `{ prize_code: null }` per 
  giocare puro
- Validazioni:
  - Se `prize_code != null`: l'utente deve avere almeno 1 premio del 
    tipo richiesto in `prizes.[prize_code]`
- Logica:
  - **NON decrementa ancora il premio** (verrà decrementato a fine run)
  - Salva temporaneamente la scelta in modo che `POST /api/game/end` 
    possa recuperarla. Soluzioni possibili:
    - Restituire un token/session_id che il client passerà a `/api/game/end`
    - Oppure salvare in un campo temporaneo `pending_run_prize` su 
      `player_stats` (più semplice)
- Restituisce: il `prize_code` confermato (o null), così il client lo 
  usa per applicare gli effetti durante la run

## FASE 4 — Game engine: applicazione effetti premi attivi

Modifica `evoluzione/public/js/game-engine.js` (e file correlati) per 
applicare gli effetti dei premi quando attivi.

### All'inizio di ogni run

Dopo che il giocatore ha confermato la scelta nella schermata pre-partita, 
chiama `POST /api/game/start` con il `prize_code` selezionato (o null). 
La response conferma il prize. Salva in una variabile locale 
`currentRunPrize` (string | null).

### Effetti dei premi attivi

In base a `currentRunPrize`, modifica le costanti del gioco SOLO per 
quella run (non globalmente, le costanti originali devono restare 
intatte per le altre run):

| Prize | Modifica |
|---|---|
| `red_plus` | `SHIELD_DURATION_MS = 13000` (era 10000) |
| `blue_plus` | `BLUE_BONUS_SPAWN_EVERY_MS = 22000` (era 26000) |
| `yellow_plus` | `YELLOW_BONUS_SPAWN_EVERY_MS = 40000` (era 48000) |
| `purple_plus` | `PURPLE_BONUS_SPAWN_EVERY_MS = 50000` (era 60000) |
| `green_plus` | Comportamento del verde alterato: per 10s rimpicciolisce il CURSORE del player invece dei bianchi. **Riferimento implementazione**: vedi `C:\Users\Daniele\Desktop\dodge - Copia` per la logica del cursore ridotto da riusare/adattare |

### Tracking nuovi contatori durante la run

Aggiungi tracking di:

- `whites_killed_by_yellow_this_run`: incrementa quando un giallo elimina 
  un bianco
- `green_skipped_this_run`: incrementa quando un verde scompare dal campo 
  (4 rimbalzi raggiunti, o esce dallo schermo) SENZA essere raccolto dal 
  player
- `max_extra_lives_simultaneous_this_run`: tieni un valore corrente 
  (vite extra possedute ora) e un max raggiunto, aggiorna il max ogni 
  volta che il valore corrente sale

### Invio a fine run

Includi tutti i nuovi contatori nel payload di `POST /api/game/end`, 
insieme a `prize_used = currentRunPrize`.

## FASE 5 — Frontend: tab Missioni nel profilo

Sostituisci il placeholder "In arrivo" della tab/sezione Missioni con la 
UI vera.

### Layout

**Card "Missione attiva"** (se presente):
- Nome missione (es. "Rosso Plus")
- Descrizione (es. "Raccogli 6 rossi nella stessa partita, in 10 partite")
- Barra progresso (es. 4/10 oppure 67/100)
- Tempo rimanente (countdown alle 24h, formato hh:mm:ss)
- Bottone "Annulla missione" (chiama `POST /api/missions/cancel`, mostra 
  conferma "Sicuro? Perderai i progressi.")

**Lista "Missioni disponibili"** (sotto, le 5 missioni):
- Card per ogni missione:
  - Nome, descrizione, ricompensa (es. "3 Rosso Plus")
  - Bottone "Attiva" (disabilitato se: missione già attiva o cap premi 
    raggiunto a 10)
  - Tooltip che spiega perché disabilitato

### UI vincoli

- Solo 1 missione attiva visibile in primo piano
- Le altre 4 sono visualmente "non disponibili" finché c'è una missione 
  attiva (grigie con bottone disabilitato)

## FASE 6 — Frontend: tab Premi nel profilo (solo visualizzazione)

La tab Premi è **solo una vetrina/contatore**. Non permette nessuna 
azione: niente "Attiva", niente selezione. Mostra solo cosa hai in 
tasca.

### Design grafico delle icone premio

Ogni premio ha un'icona simbolo che richiama il bonus in partita ma con 
un dettaglio distintivo:

> **Pallino colorato (come il bonus in partita) + cerchio dello stesso 
> colore intorno, in stile "orbita", molto vicino al pallino centrale.**

Esempio: il Rosso Plus ha un pallino rosso al centro e un cerchio 
sottile rosso (anello/ring) che lo circonda a distanza minima, come un 
satellite in orbita stretta. Stesso schema per gli altri 4 colori.

L'anello deve essere chiaramente visibile ma non ingombrante. Usa il 
colore del bonus base con eventualmente luminosità/opacità leggermente 
diversa per dare profondità.

### Layout

Griglia con 5 card colorate (una per colore). Ogni card mostra:

- Icona premio (pallino + anello) in evidenza
- Nome (es. "Rosso Plus")
- Effetto (es. "Scudo dura 13s")
- Counter premi posseduti (es. "3/10")

**Nessun bottone, nessuna selezione.** La scelta del premio da usare 
avviene esclusivamente nella schermata pre-partita (Fase 7).

Una breve nota testuale in cima alla tab può ricordare al giocatore: 
"Potrai scegliere un premio da attivare all'inizio di ogni partita, se 
ne possiedi almeno uno."

## FASE 7 — Frontend: schermata di scelta premio pre-partita

Quando il giocatore preme "Gioca" (avvia una nuova partita):

### Caso 1: il giocatore HA almeno 1 premio in tasca

Prima del countdown 3-2-1, mostra una schermata di scelta premio:

- Titolo: "Vuoi attivare un premio per questa run?"
- Mostra le 5 icone premio (con lo stesso design pallino+anello della tab 
  Premi)
- Per ogni colore con counter > 0: icona attivabile con badge che mostra 
  il numero posseduto (es. "×3")
- Per ogni colore con counter == 0: icona grigia non cliccabile
- Opzione "Gioca puro" (nessun premio attivato) sempre disponibile, ben 
  in evidenza come scelta neutra
- Cliccando un'icona la selezioni; la scelta è singola (cliccando 
  un'altra deselezioni la precedente)
- Bottone "Inizia partita" → conferma scelta:
  - Chiama `POST /api/game/start` con `{ prize_code: "..." }` o 
    `{ prize_code: null }`
  - Riceve conferma
  - Avvia countdown 3-2-1

### Caso 2: il giocatore NON ha premi in tasca

Salta la schermata di scelta. Chiama comunque `POST /api/game/start` 
con `{ prize_code: null }` (per coerenza server-side) e vai direttamente 
al countdown 3-2-1. Esperienza identica a quella attuale, nessuna 
interruzione.

### Indicatore in-game

Durante la run, se il `prize_code` di questa run è non-null, mostra un 
piccolo indicatore in un angolo dello schermo (es. icona pallino+anello 
del colore attivo + testo "Plus" piccolo) per ricordare al giocatore 
quale premio è attivo.

## FASE 8 — Test

1. Attiva una missione → verifica che `active_mission` sia impostato
2. Tenta di attivarne un'altra senza aver finito la prima → ricevi errore 
   (slot occupato)
3. Annulla la missione attiva → verifica reset progressi
4. Gioca una run senza premio attivo, soddisfa la condizione missione 
   → verifica progresso incrementato
5. Gioca una run CON premio attivo → verifica che progresso NON sia 
   incrementato e che il premio sia stato consumato (counter -1)
6. Completa una missione → verifica assegnazione **3 premi** e reset 
   missione
7. Riempi a 10 premi di un colore → tenta attivazione missione corrispondente 
   → ricevi errore (cap raggiunto)
8. Lascia scadere una missione (>24h, simula manualmente con date 
   modificate) → verifica reset automatico al prossimo `/api/game/end` o 
   `/api/missions/current`
9. Verifica il `green_plus`: durante la run con verde_plus attivo, 
   controlla che sia il cursore a rimpicciolirsi e non i bianchi
10. Verifica visivamente che gli effetti siano applicati correttamente per 
    tutti e 5 i premi (durata scudo, frequenza spawn dei colori)
11. Verifica la schermata pre-partita: con e senza premi in tasca, 
    comportamento corretto in entrambi i casi
12. Verifica che le icone premi (pallino + anello orbitale) siano 
    visivamente coerenti tra tab Premi e schermata pre-partita

## Ordine di implementazione

0. Backup
1. Schema database + migration
2. Backend missioni (attivazione, lettura, scadenza, annullamento)
3. Backend integrazione fine partita
4. Game engine effetti premi + tracking nuovi contatori (incluso adattamento 
   verde dal progetto `dodge - Copia`)
5. Frontend tab Missioni
6. Frontend tab Premi (con icone pallino+anello)
7. Frontend schermata pre-partita + indicatore in-game
8. Test

Procedi una fase alla volta e mostrami l'esito di ognuna prima di 
passare alla successiva. Per le fasi 1-3 (backend) mostra anche query 
di verifica Firestore. Per la fase 4 (game engine) conferma di aver 
ispezionato la cartella `C:\Users\Daniele\Desktop\dodge - Copia` e 
descrivi cosa hai trovato lì che hai riadattato.
