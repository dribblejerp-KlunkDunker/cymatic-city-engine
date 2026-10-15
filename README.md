# Cymatic City Engine

Turns a drive frequency into a 3D settlement whose plan is the standing-wave (Chladni) pattern of a vibrating plate at that frequency, then makes it buildable with planning and structural rules.

## Pipeline

1. **Modes** (`enumerateModes`). Disk membrane: `J_m(j_mn r) cos(mθ)`, `f ∝ j_mn`. Square Chladni plate: `cos(nπx)cos(mπy) ± cos(mπx)cos(nπy)` on `[0,1]²` (zero edge slope), `f ∝ m² + n²`. Sphere: real spherical harmonics `Y_l^m`, `f ∝ √(l(l+1))`, one azimuthal order per degree (symmetry-broken sphere). Each mode carries its norm `∫φ² dA` and its value at the drive point.
2. **Driven response** (`drivenResponse`). `α_k = φ̂_k(drive) / (f_k² − f² + i f_k f / Q)` in the orthonormal basis; the pattern is taken at the phase holding the most motion. `sharpness` reports how much of the motion is a clean standing pattern.
3. **Streets** (`buildRoads`). Nodal lines (S = 0) → boulevards. Contour rings on |S| levels and gradient streets toward each antinode (Chen et al. 2008 tensor-field idea) fill in until street density reaches about 18 km/km² (UN-Habitat). Perimeter wall on flat plates.
4. **Lots and buildings**. Amplitude sets zone (core / mixed / residential / green) and height; the wave's sign splits alternating districts; the strongest antinode of each district gets a landmark. Every footprint clears every road edge, stays inside its lot's no-overlap radius, and sits within walking reach of a street.
5. **Structure**. Height ≤ σ/(ρ·g·3) for the material; slenderness ≤ 1:10 (city) scaled by g^-1/3; buildings over six floors need a 14 m lift core; megastructures are terraced so no exposed face exceeds 1:8; on a sphere the megastructure is a shell under ¼ of the radius.
6. **Checks**. Each layout reports measured street share, street density, open space, residents/ha, tallest vs. material limit, most slender building, farthest building from a street, closest approach to a road, terrace steps and pattern sharpness.

Same inputs and seed give byte-identical output. The seed changes buildings, never streets.

## Use

```js
import { generateCity, toOBJ, toJSON } from './src/cymatic-engine.js';
const city = generateCity({ frequency: 432, plate: 'circle', preset: 'city', seed: 1 });
// plate: circle | square | sphere     preset: town | city | megastructure | alien
// optional: Q, gravity (g), material (masonry | concrete | steel | biocomposite),
//           fundamentalHz (lowest mode), driveOffset (0–0.95), azimuthal (sphere m), inverse (build on sand lines)
```

`npm test` runs the suite (physics against reference values, analytic nodal sets, brute-force road and overlap checks, structural limits, export validity). `npm run build` writes `dist/cymatic-city.html` (artifact page) and `dist/cymatic-city-standalone.html`.

## What the frequency means

The standing-wave patterns are real physics. Turning them into a city is a design choice. There is no evidence that particular frequencies (432 Hz, Solfeggio tones, the Schumann resonance) make a place healthier or more harmonious; the engine treats every frequency alike.
