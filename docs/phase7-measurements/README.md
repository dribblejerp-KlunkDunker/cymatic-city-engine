# Phase 7 measurements

The throwaway scripts behind the numbers in `docs/PHASE7-SPEC.md`, kept so the numbers can be reproduced.
They are prototypes, not engine code: they use the platform's `Math` and coarse grids, so their last digits
are not the engine's. Run from anywhere: `node docs/phase7-measurements/<name>.mjs`.

| Script | What it measures | Time |
|---|---|---|
| `bands.mjs` | Ley energy against demand, which structural rules bind, depth bands, the octave below | ~1 min |
| `gravity-and-graphs.mjs` | What gravity 0.5 and 2 change; nexus counts and line graphs; the octave below against metro stations | ~1 min |
| `antinodes.mjs` | Every antinode, a Gabriel graph over them, how much demand must travel | ~1 min |
| `ley-flow.mjs` | Ley supply over demand at 600 W/m² and the loads on the lines | ~1 min |
