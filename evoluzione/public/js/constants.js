async function loadMissionsConfig() {
  const res = await fetch(new URL('./missions-config.json', import.meta.url));
  if (!res.ok) throw new Error(`missions-config load failed: ${res.status}`);
  return res.json();
}

const missionsConfigJson = await loadMissionsConfig();

/** Larghezza logica dell'area di gioco (unità mondo, px sul canvas interno). */
export const FIXED_GAME_W = 400;
/** Altezza logica dell'area di gioco (unità mondo, px sul canvas interno). */
export const FIXED_GAME_H = 720;
/** Larghezza massima del canvas in CSS (px sullo schermo). */
export const MAX_CANVAS_CSS_W = 430;

/** Fattore di interpolazione del cursore verso il tocco (per secondo, moltiplicato per dt). */
export const CURSOR_LERP = 0.55;
/** Margine interno delle celle della griglia di mira (px). */
export const AIM_CELL_PAD = 10;
/** Intervallo tra un aggiornamento e il successivo del settore di mira (ms). */
export const AIM_SECTOR_INTERVAL_MS = 8000;
/** Margine oltre i bordi dello schermo per despawn e controlli fuori campo (px). */
export const SCREEN_MARGIN = 40;
/** Distanza minima del giocatore dai bordi giocabili (px). */
export const PLAYER_BOUND_PAD = 24;
/** Raggio di palline bianche e cerchi bonus (px). */
export const HAZARD_R = 12;
/** Distanza minima tra due punti di spawn (px). */
export const SPAWN_MIN_DIST = HAZARD_R * 2 + 36;
/** Intervallo tra un aumento di livello e il successivo (ms). */
export const LEVEL_INTERVAL_MS = 15000;
/** Numero iniziale di bianchi triangolari (movimento rettilineo) a inizio partita. */
export const WHITE_START_TRIANGLES = 3;
/** Numero iniziale di bianchi quadrati (movimento a spirale) a inizio partita. */
export const WHITE_START_SQUARES = 3;
/** Numero massimo di bianchi contemporanei sul campo. */
export const WHITE_ON_FIELD_MAX = 50;

/** Rimbalzi sui bordi prima che un bonus scompaia. */
export const BONUS_WALL_BOUNCES_MAX = 4;

/** Ritardo dall'inizio partita al primo spawn del bonus rosso (ms). */
export const RED_BONUS_FIRST_SPAWN_MS = 15000;
/** Intervallo tra spawn successivi del bonus rosso (ms). */
export const RED_BONUS_SPAWN_EVERY_MS = 15000;

/** Ritardo dall'inizio partita al primo spawn del bonus blu (ms). */
export const BLUE_BONUS_FIRST_SPAWN_MS = 26000;
/** Intervallo tra spawn successivi del bonus blu (ms). */
export const BLUE_BONUS_SPAWN_EVERY_MS = 26000;

/** Ritardo dall'inizio partita al primo spawn del bonus giallo (ms). */
export const YELLOW_BONUS_FIRST_SPAWN_MS = 48000;
/** Intervallo tra spawn successivi del bonus giallo (ms). */
export const YELLOW_BONUS_SPAWN_EVERY_MS = 48000;

/** Ritardo dall'inizio partita al primo spawn del bonus verde (ms). */
export const GREEN_BONUS_FIRST_SPAWN_MS = 37000;
/** Intervallo tra spawn successivi del bonus verde (ms). */
export const GREEN_BONUS_SPAWN_EVERY_MS = 37000;

/** Ritardo dall'inizio partita al primo spawn del bonus viola (ms). */
export const PURPLE_BONUS_FIRST_SPAWN_MS = 60000;
/** Intervallo tra spawn successivi del bonus viola (ms). */
export const PURPLE_BONUS_SPAWN_EVERY_MS = 60000;

/** Durata dello scudo dopo il pickup del bonus rosso (ms). */
export const SHIELD_DURATION_MS = 10000;
/** Durata del rallentamento dopo il pickup del bonus blu (ms). */
export const SLOW_DURATION_MS = 10000;
/** Moltiplicatore di velocità lineare durante il rallentamento (0–1). */
export const SLOW_FACTOR = 0.45;
/** Moltiplicatore di velocità angolare durante il rallentamento (0–1). */
export const SLOW_OMEGA_FACTOR = 0.6;

/** Durata della modalità verde classica dopo il pickup (ms). */
export const GREEN_MODE_DURATION_MS = 10000;

/** Durata di ogni fase del countdown intro / ripresa (ms). */
export const INTRO_CD_MS = 850;

/** Durata scudo in partita con premio Rosso Plus attivo (ms). */
export const PLUS_PRIZE_RED_SHIELD_DURATION_MS = 13000;
/** Intervallo tra spawn del bonus blu con premio Blu Plus attivo (ms). */
export const PLUS_PRIZE_BLUE_SPAWN_EVERY_MS = 22000;
/** Ritardo al primo spawn blu con premio Blu Plus; coincide con l'intervallo (ms). */
export const PLUS_PRIZE_BLUE_FIRST_SPAWN_MS = PLUS_PRIZE_BLUE_SPAWN_EVERY_MS;
/** Intervallo tra spawn del bonus giallo con premio Giallo Plus attivo (ms). */
export const PLUS_PRIZE_YELLOW_SPAWN_EVERY_MS = 40000;
/** Ritardo al primo spawn giallo con premio Giallo Plus; coincide con l'intervallo (ms). */
export const PLUS_PRIZE_YELLOW_FIRST_SPAWN_MS = PLUS_PRIZE_YELLOW_SPAWN_EVERY_MS;
/** Intervallo tra spawn del bonus viola con premio Viola Plus attivo (ms). */
export const PLUS_PRIZE_PURPLE_SPAWN_EVERY_MS = 50000;
/** Ritardo al primo spawn viola con premio Viola Plus; coincide con l'intervallo (ms). */
export const PLUS_PRIZE_PURPLE_FIRST_SPAWN_MS = PLUS_PRIZE_PURPLE_SPAWN_EVERY_MS;
/** Durata modalità «cursore piccolo» con premio Verde Plus attivo (ms). */
export const PLUS_PRIZE_GREEN_PLAYER_DURATION_MS = GREEN_MODE_DURATION_MS;

/** Etichette effetto dei premi Plus (profilo, griglia premi). */
export const PLUS_PRIZE_EFFECT_LABEL = Object.freeze({
  red_plus: 'Scudo prolungato',
  blue_plus: 'Blu più frequente',
  yellow_plus: 'Giallo più frequente',
  green_plus: 'Cursore piccolo',
  purple_plus: 'Viola più frequente',
});

/** Finestra temporale missione (ms). Modifica `missions-config.json`. */
export const MISSION_WINDOW_MS = missionsConfigJson.MISSION_WINDOW_MS;
/** Oggetto esposto per lettura (titoli, soglie). Stesso file copiato nelle Functions al deploy. */
export const MISSIONS_CONFIG = missionsConfigJson;

export function fillMissionDescriptionTemplate(missionRow) {
  const tpl = missionRow.description_template || '';
  return tpl.replace(/\{(\w+)\}/g, (_, k) =>
    (missionRow[k] != null ? String(missionRow[k]) : `{${k}}`));
}

/** Righe profilo / picker: testi da `missions-config.json` + etichette effetto premio. */
export function getProfileMissionDefs(effectLabelByCode) {
  const { missions } = missionsConfigJson;
  return Object.keys(missions).map((code) => {
    const m = missions[code];
    return {
      code,
      title: m.title,
      desc: fillMissionDescriptionTemplate(m),
      reward: m.reward_label,
      effect: effectLabelByCode[code] || '',
    };
  });
}
