/**
 * Area di gioco fissa (pixel logici): spawn, velocità e hitbox sono sempre in questo spazio.
 * Lo schermo fisico scala solo in presentazione (`resize`); difficoltà identica su ogni dispositivo.
 */
export const FIXED_GAME_W = 400;
export const FIXED_GAME_H = 720;
/**
 * Larghezza massima della colonna gioco + UI (px CSS), vedi #dodgeShell.
 * Su PC simula un telefono; su schermo stretto resta 100%.
 */
export const MAX_CANVAS_CSS_W = 430;

export const SLOW_DURATION_MS = 10000;
export const SHIELD_DURATION_MS = 10000;
export const CURSOR_LERP = 0.55;          // velocità di traslazione cursore
export const SLOW_FACTOR = 0.45;          // un filo meno OP
/** Spirale: omega moltiplicata da questo durante il blu (ripristino divide per questo). */
export const SLOW_OMEGA_FACTOR = 0.6;
export const AIM_CELL_PAD = 10;
/** Ogni quanto la “zona di passaggio obbligato” si aggancia alla cella 3×3 dove sei ora (tempo di gioco). */
export const AIM_SECTOR_INTERVAL_MS = 8000;
/** Margine fuori schermo prima di despawn + respawn (px). */
export const SCREEN_MARGIN = 40;
/**
 * Distanza minima del centro giocatore dai bordi (px logici).
 * Prima era ~48px e il cursore non arrivava ai bordi come gli ostacoli; ~24 ≈ rMain in drawPlayer.
 */
export const PLAYER_BOUND_PAD = 24;
/** Dimensioni “fisse” gameplay (px). */
export const HAZARD_R = 12;
/** Distanza minima tra centri alla creazione (meno blob e sovrapposizioni improbabili). */
export const SPAWN_MIN_DIST = HAZARD_R * 2 + 36;
export const LEVEL_INTERVAL_MS = 15000;
export const WHITE_START_TRIANGLES = 3;
export const WHITE_START_SQUARES = 3;
/** Massimo oggetti bianchi in campo (triangoli + quadrati). */
export const WHITE_ON_FIELD_MAX = 50;
/** Spawn bonus: intervalli fissi (ms). */
export const RED_SPAWN_INTERVAL_MS = 15000;
/** Primo bonus rosso: stesso ritardo dello spawn (tempo di gioco). */
export const FIRST_RED_DELAY_MS = 15000;
/** Ultimi ms prima della scadenza: il bonus in campo lampeggia. */
export const BONUS_EXPIRE_WARN_MS = 3000;
export const BLUE_SPAWN_INTERVAL_MS = 25000;
export const YELLOW_SPAWN_INTERVAL_MS = 50000;
export const GREEN_SPAWN_INTERVAL_MS = 40000;
/** Satellite viola: spawn ogni 60s se non c'è viola in campo e stack < 3. */
export const PURPLE_SPAWN_INTERVAL_MS = 60000;
/** Tempo di vita sul campo prima di despawn (ms). */
export const RED_BONUS_TTL_MS = 18000;
export const BLUE_BONUS_TTL_MS = 25000;
export const YELLOW_BONUS_TTL_MS = 40000;
export const GREEN_BONUS_TTL_MS = 22000;
export const PURPLE_BONUS_TTL_MS = 18000;
/** Durata effetto verde sui bianchi (riduzione hitbox + bolla visiva). */
export const GREEN_MODE_DURATION_MS = 10000;
/** Durata ogni numero del countdown d’avvio (ms). */
export const INTRO_CD_MS = 850;

export const RECORDS_KEY = 'dodge_records_v2';
export const RECORDS_KEY_LEGACY = 'dodge_records';
