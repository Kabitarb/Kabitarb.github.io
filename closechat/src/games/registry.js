import * as ttt from './ttt.js';
import * as ludo from './ludo.js';
import * as pool from './pool.js';
import * as connect4 from './connect4.js';
import * as seabattle from './seabattle.js';
import * as checkers from './checkers.js';
import * as dots from './dots.js';
import * as cuppong from './cuppong.js';
import * as duel2048 from './duel2048.js';
import * as wordrace from './wordrace.js';

const MODULES = { pool, connect4, seabattle, checkers, dots, cuppong, duel2048, wordrace, ttt, ludo };
export const GAMES = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, m.meta]));
export const ENGINES = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, m.engine]));
export const VIEWS = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, m.view]));
export const GAME_ORDER = Object.keys(MODULES);
