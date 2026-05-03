/** Area di gioco fissa (pixel logici). Stessa difficoltà per tutti: zoom/desktop non ridimensionano ostacoli. */
export const FIXED_GAME_W = 400;
export const FIXED_GAME_H = 720;

export const SLOW_DURATION_MS = 10000;
export const SHIELD_DURATION_MS = 15000;
export const CURSOR_LERP = 0.55;          // velocità di traslazione cursore
export const SLOW_FACTOR = 0.45;          // un filo meno OP
/** Spirale: omega moltiplicata da questo durante il blu (ripristino divide per questo). */
export const SLOW_OMEGA_FACTOR = 0.6;
export const AIM_CELL_PAD = 10;
/** Ogni quanto la “zona di passaggio obbligato” si aggancia alla cella 3×3 dove sei ora (tempo di gioco). */
export const AIM_SECTOR_INTERVAL_MS = 8000;
/** Margine fuori schermo prima di despawn + respawn (px). */
export const SCREEN_MARGIN = 40;
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
export const BLUE_SPAWN_INTERVAL_MS = 35000;
export const YELLOW_SPAWN_INTERVAL_MS = 57000;
export const GREEN_SPAWN_INTERVAL_MS = 22000;
/** 2ª vita: spawn ogni 47s se non hai già il bonus né un viola in campo. */
export const PURPLE_SPAWN_INTERVAL_MS = 47000;
/** Tempo di vita sul campo prima di despawn (ms). */
export const RED_BONUS_TTL_MS = 15000;
export const BLUE_BONUS_TTL_MS = 30000;
export const YELLOW_BONUS_TTL_MS = 45000;
export const GREEN_BONUS_TTL_MS = 20000;
export const PURPLE_BONUS_TTL_MS = 22000;
/** Dopo aver preso il verde: toccare i bianchi li elimina (senza morire). */
export const ERASE_MODE_DURATION_MS = 5000;
/** Durata ogni numero del countdown d’avvio (ms). */
export const INTRO_CD_MS = 850;

export const RECORDS_KEY = 'dodge_records_v2';
export const RECORDS_KEY_LEGACY = 'dodge_records';
