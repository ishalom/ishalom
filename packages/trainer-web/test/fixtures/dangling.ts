/**
 * A module that imports a name the bundle cannot supply.
 *
 * Only the bundler's own guard reads this. It exists so the check that would
 * have caught the `Shoe as Composition` bug is itself tested, rather than being
 * a line of code everyone assumes works.
 */

import { thisDoesNotExist } from '../../src/i18n.ts';

export const value = thisDoesNotExist;
