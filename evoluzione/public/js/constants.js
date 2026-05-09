export const FIXED_GAME_W = 400;
export const FIXED_GAME_H = 720;
export const MAX_CANVAS_CSS_W = 430;

export const CURSOR_LERP = 0.55;
export const AIM_CELL_PAD = 10;
export const AIM_SECTOR_INTERVAL_MS = 8000;
export const SCREEN_MARGIN = 40;
export const PLAYER_BOUND_PAD = 24;
export const HAZARD_R = 12;
export const SPAWN_MIN_DIST = HAZARD_R * 2 + 36;
export const LEVEL_INTERVAL_MS = 15000;
export const WHITE_START_TRIANGLES = 3;
export const WHITE_START_SQUARES = 3;
export const WHITE_ON_FIELD_MAX = 50;

export const BONUS_WALL_BOUNCES_MAX = 4;

export const RED_BONUS_FIRST_SPAWN_MS = 15000;
export const RED_BONUS_SPAWN_EVERY_MS = 15000;

export const BLUE_BONUS_FIRST_SPAWN_MS = 26000;
export const BLUE_BONUS_SPAWN_EVERY_MS = 26000;

export const YELLOW_BONUS_FIRST_SPAWN_MS = 48000;
export const YELLOW_BONUS_SPAWN_EVERY_MS = 48000;

export const GREEN_BONUS_FIRST_SPAWN_MS = 37000;
export const GREEN_BONUS_SPAWN_EVERY_MS = 37000;

export const PURPLE_BONUS_FIRST_SPAWN_MS = 60000;
export const PURPLE_BONUS_SPAWN_EVERY_MS = 60000;

export const SHIELD_DURATION_MS = 10000;
export const SLOW_DURATION_MS = 10000;
export const SLOW_FACTOR = 0.45;
export const SLOW_OMEGA_FACTOR = 0.6;

export const GREEN_MODE_DURATION_MS = 10000;

export const INTRO_CD_MS = 850;

/**
 * Numeri effettivi in partita quando è attivo un premio Plus (run corrente).
 * Rosso: durata scudo al pickup. Blu/Giallo/Viola: intervallo tra uno spawn e il successivo (dopo il primo).
 * Verde: durata «cursore piccolo» al pickup del bonus verde (effetto alternativo al verde classico).
 */
export const PLUS_PRIZE_RED_SHIELD_DURATION_MS = 13000;
export const PLUS_PRIZE_BLUE_SPAWN_EVERY_MS = 22000;
export const PLUS_PRIZE_YELLOW_SPAWN_EVERY_MS = 40000;
export const PLUS_PRIZE_PURPLE_SPAWN_EVERY_MS = 50000;
export const PLUS_PRIZE_GREEN_PLAYER_DURATION_MS = GREEN_MODE_DURATION_MS;

/**
 * Testi effetto dei premi Plus (profilo, griglia premi).
 */
export const PLUS_PRIZE_EFFECT_LABEL = Object.freeze({
  red_plus: 'Scudo prolungato',
  blue_plus: 'Blu più frequente',
  yellow_plus: 'Giallo più frequente',
  green_plus: 'Cursore piccolo',
  purple_plus: 'Viola più frequente',
});
