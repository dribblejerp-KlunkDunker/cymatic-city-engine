# Multi-frequency chords — physics and design choices

What happens on a plate driven by two or three tones at once, and how the engine turns that into a city with eras.

## The physics

- **Linear superposition.** A thin plate or membrane is (to first order) a linear system, so its response to a sum of drive tones is the sum of its responses to each tone: displacement `u(x, t) = Σ_v w_v · Re[Φ_v(x) e^{iω_v t}]`, where Φ_v is the driven modal response at ω_v (the engine's `drivenResponse` for each voice, each normalised to its own peak before weighting).
- **Commensurate vs. incommensurate.** If the frequencies share a common period (an octave 2:1, a fifth 3:2 with phase locked) the motion is periodic and the plate has a fixed shape at every instant of that period; the "snapshot" Σ w_v S_v at the instant the voices align is one of those shapes. If they do not (any irrational ratio, or in practice any two independent oscillators), the relative phase drifts and no fixed shape exists; what is stationary is the **time-averaged** motion, whose mean-square is additive: `⟨u²⟩ = ½ Σ_v w_v² |Φ_v|²` (cross terms average out). Sand on a Chladni plate responds to the time-averaged motion, so under two incommensurate tones it gathers where **both** voices are quiet — the nodal lines of a two-tone figure are the intersections of the two nodal sets, not a new set of lines (Waller 1961; the classic two-tone Chladni demonstrations show a sand pattern that blurs into the common minima).
- **What the engine does.** Amplitude `A = √Σ (w_v A_v)²` — the time-averaged motion, scaled so its peak is 1. The signed field keeps the sign of the in-phase snapshot Σ w_v S_v (clipped to the envelope A where the snapshot would exceed it), which gives the chord a district structure (sign splits) and a shape for relief terrain; it is a snapshot, honestly labelled as such. Pattern sharpness is the weighted mean of the voices'.

## From physics to plan

Since the sand of a two-tone plate would settle only on the intersection points, a city built literally on it would have no boulevards. The engine instead reads a chord as a **sequence of eras**, which is what the roadmap asked for and what cities are.

- **Territories.** Each voice lays its own streets on its own nodal lines (boulevards), amplitude contours (rings) and gradients (spokes), but only in its **territory**: where its weighted *envelope* is within 15 % of the strongest voice's. The envelope is the local maximum of the voice's amplitude within half its own nodal spacing, i.e. how strongly the voice vibrates in that neighbourhood; a voice's sand lines, where its own amplitude is zero, still belong to it wherever the lobes on either side are its. The 15 % band lets neighbouring voices' networks overlap slightly, so they cross and join.
- **Budget.** A voice's spoke budget is the UN-Habitat street length times its share of the plate, so a faint voice lays little: a chord with a voice at weight 0.01–0.1, first or second, is the loud voice's city within 1 %. A chord paves about as much as its loudest voice alone, not the sum of its voices. Each stretch of the perimeter wall belongs to the voice that shapes it there, and seeds that voice's spokes.
- **Density.** The time-averaged amplitude of several voices leaves few still places, so a chord city has less green and more people than either voice alone (about +40–50 % residents on a two-voice city, green share falling from about 11 % to 2 %). That is the physics of the amplitude, not a bug.
- **Fragments.** Clipping a voice's lines at its territory's edge can leave short pieces touching no other street; disconnected fragments under 100 m are dropped.
- **Lots.** A lot belongs to the voice that moves the plate most right under it (`building.era`, pointwise `w·A`). The composite amplitude sets zoning and heights, so lots where several voices move the plate rise highest.
- **Growth.** The first voice is the old city: `simulate()` settles all its lots before the second voice breaks ground. The old city's routes prefer its own streets (later voices' streets count five times their length); where its lobes are separated by another voice's territory, the routes between them must run along that voice's sand lines, and those street segments open with the route. In the keyframes such a street is credited to the voice that laid it (`era`, the old city) and keeps whose lines it follows (`follows`); every other later-voice street waits for its voice. Clipping to territories cuts the old city into lobes, so these joining streets are a large part of its network (a third to a half of voice 2's eventual street length exists before voice 2 breaks ground).

Musical intervals: the "+ fifth / fourth / third / octave" buttons multiply the first voice by 3/2, 4/3, 5/4 and 2, folding down an octave when the plate's modelled range cannot reach the result, and refusing an interval that lands on a voice already in the chord.

## Limits

- Two or three voices only; with more, territories shrink to slivers and the plan fragments.
- Voices within 1 % of each other are refused: they drive the same modes and would lay the same streets twice.
- On an arcology every voice's boulevards are open canyons, so a chord cuts more of the structure away (a two-voice circular megastructure keeps about half the cells of its first voice alone). The checks still pass; the structure is simply more open.
- The composite amplitude is the plate's time-averaged motion; the composite sign is a snapshot. Neither is "the pattern you would photograph" for incommensurate tones — that would be the intersection points — and the engine says so in the sand-figure caption.
- Eras are a settlement order, not a history of demolition: era-2 streets that cross era-1 lots simply take their lots away at generation time, as the lot grid fits around all roads at once.
- Weights set the territories and the amplitude mix; only their ratios matter, and they are not sound-pressure levels.
- Fragment removal joins streets within 1 m, the street graph is stricter at crossings, so a few pieces under 100 m can still need a short service connector; larger islands of a voice's streets are likewise joined by connectors.

Sources: Waller, M. D. *Chladni Figures: A Study in Symmetry* (1961); Rossing & Fletcher, *Principles of Vibration and Sound*, ch. 3 (linear superposition, modal response); Rayleigh, *The Theory of Sound*, §§ 190–200 (plates and membranes).
