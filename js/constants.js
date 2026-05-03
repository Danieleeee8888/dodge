/**
 * Cache bust: stesso `?v=` in index.html (CSS + game.js) e in game.js su questo import.
 * Al prossimo deploy che deve invalidare la cache, incrementa ovunque (es. 20260504).
 *
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

export const CURSOR_LERP = 0.55;          // velocità di traslazione cursore
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

// =============================================================================
// Bonus (cerchi colorati): spawn, vita sul campo (rimbalzi), effetti dopo raccolta
// =============================================================================

/**
 * Contatti bordo cumulativi prima che il bonus sparisca da solo.
 * Dopo il 3° contatto lampeggia; al 4° contatto “puf” e rimozione (stesso per tutti i colori).
 */
export const BONUS_WALL_BOUNCES_MAX = 4;

/** Rosso: primo spawn a questo tempo di gioco (ms, rispetta la pausa). */
export const RED_BONUS_FIRST_SPAWN_MS = 15000;
/** Rosso: ogni quanto dopo il primo (ms dall’ultimo spawn, clock reale). */
export const RED_BONUS_SPAWN_EVERY_MS = 15000;

/** Blu: primo spawn dopo questo tempo dall’inizio partita (ms, clock reale). */
export const BLUE_BONUS_FIRST_SPAWN_MS = 26000;
/** Blu: spawn successivi ogni quanto (ms dall’ultimo spawn). */
export const BLUE_BONUS_SPAWN_EVERY_MS = 26000;

export const YELLOW_BONUS_FIRST_SPAWN_MS = 48000;
export const YELLOW_BONUS_SPAWN_EVERY_MS = 48000;

export const GREEN_BONUS_FIRST_SPAWN_MS = 37000;
export const GREEN_BONUS_SPAWN_EVERY_MS = 37000;

/** Viola: primo tentativo di spawn dopo questo tempo dall’inizio partita (ms). */
export const PURPLE_BONUS_FIRST_SPAWN_MS = 60000;
/** Viola: dopo uno spawn riuscito, prossimo slot non prima di questi ms. */
export const PURPLE_BONUS_SPAWN_EVERY_MS = 60000;

/** Durata scudo dopo raccolta bonus rosso (ms). */
export const SHIELD_DURATION_MS = 10000;
/** Durata rallentamento dopo raccolta bonus blu (ms). */
export const SLOW_DURATION_MS = 10000;
/** Moltiplicatore velocità bianchi durante il blu (ripristino divide per questo). */
export const SLOW_FACTOR = 0.45;
/** Spirale: omega moltiplicata da questo durante il blu (ripristino divide per questo). */
export const SLOW_OMEGA_FACTOR = 0.6;

/** Durata effetto “rimpicciolisci” sui bianchi dopo raccolta bonus verde (ms). */
export const GREEN_MODE_DURATION_MS = 10000;

/** Durata ogni numero del countdown d’avvio (ms). */
export const INTRO_CD_MS = 850;

export const RECORDS_KEY = 'dodge_records_v2';
export const RECORDS_KEY_LEGACY = 'dodge_records';
