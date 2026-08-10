// Character portrait — Gillian Seed. Uses the shared makePlaneAScene helper
// (plane A + optional plane B). Every byte from disc — see
// port/build/scenes.ts entry 'portrait_gillian' for exact offsets.

import { makePlaneAScene } from './_plane_a.ts';
export const portraitGillian = makePlaneAScene('portrait_gillian', [23760]);
