# People, traffic and land value — sources and choices

What the Phase 3 model uses, where each number comes from, and which are tunables.

## Population and commuting

- **Residents and jobs** come from the service laterals: 45 m² of residential floor per resident, 15 m² of other floor per job, 70 % net-to-gross (see `city_realism.md`).
- **Commuters** = 55 % of residents, capped by the number of jobs. OECD labour-force participation is 60–70 % of the working-age population, which is 60–65 % of all residents; with employment at 90–95 % of the labour force, commuters are roughly 35–45 % of all residents. 55 % is generous and is a tunable; it only scales the trip table.
- **Destination choice**: gravity model `P(j | i) ∝ jobs_j · exp(−d_ij / λ)` on street-network distance, λ = 5 km. Negative-exponential deterrence is the standard form in four-step models (Ortúzar & Willumsen, *Modelling Transport*, ch. 5); calibrated β = 1/λ for commute trips in mid-sized cities lies around 0.1–0.3 per km. The engine's cities are compact (3–8 km across), so trips are short and the choice of λ mostly affects how often people cross the city.
- **Sampling**: 160 origins drawn with probability proportional to residents; every residential node is attached to its nearest sampled origin by street distance, so each origin carries its whole cell's commuters. Each origin spreads its commuters over 48 destinations drawn in proportion to their gravity weight. Seeded, so deterministic.

## Mode choice

- **Walk**: `P(walk) = 1 / (1 + e^((d − 1.2 km) / 0.3 km))`: about 95 % below 300 m, half at 1.2 km, 5 % beyond 2.1 km. Walking mode shares fall off steeply after about 1–1.5 km in travel surveys (NHTS; Yang & Diez-Roux 2012 report a median walk of 0.8 km).
- **Metro vs. car** among the rest: binary logit on door-to-door minutes with 0.12 per minute (a typical in-vehicle-time coefficient of 0.03–0.15 per minute in mode-choice literature; Ortúzar & Willumsen ch. 7). Metro time = walk to and from the nearest stations (within 1.2 km, 4.8 km/h) + 5 min wait + tunnel distance at 35 km/h. Car time = congested street time + 8 min for parking and the walk at both ends.
- **Metro ridership** is therefore earned; `flows()` accepts the earned share in place of the 35 % assumption of Phase 1.

## Assignment

- **Peak hour**: 25 % of the day's commute trips start in the busiest hour (AM peak shares of daily trips are 10–12 % of all trips but a larger share of commute trips; a tunable).
- **Occupancy**: 1.3 persons per car (NHTS commute occupancy ≈ 1.1–1.2; the engine's cities have no explicit carpooling, so the higher figure stands in for shared rides).
- **Capacity**: lanes = ⌊(width − 6 m) / 3.5 m⌋, never under 1; 1,800 veh/h per lane (HCM saturation flow 1,800–1,900 pc/h/ln, reduced by signals on real arterials, so this is optimistic for boulevards and about right for rings). Flows are summed over both directions against the summed capacity.
- **Delay**: BPR, `t = t₀ (1 + 0.15 (v/c)⁴)` (Bureau of Public Roads 1964; still the default volume–delay function in most planning models).
- **Free speeds**: 40 km/h boulevards, 32 rings, 25 spokes, 20 service — average signalised urban speeds rather than posted limits.
- **Equilibrium**: three all-or-nothing assignments on the congested times, averaged by the method of successive averages (weights 1/k). Three passes are far from convergence on a congested network, but these cities are built to UN-Habitat street densities and rarely congest; the iteration count is a parameter.

## Land value and zoning

- **Hansen accessibility** (Hansen 1959): `A_i = Σ_j jobs_j · exp(−d_ij / λ)`, computed at the sampled origins and attached to every node by its origin cell; reported relative to the city (0 at the least connected origin, 1 at the best).
- **Land-value index** = 0.6 · A^0.7 + 0.25 · amplitude + 0.15 · metro proximity, normalised so the best lot is 1. Accessibility as the main driver of urban land value is the bid-rent tradition (Alonso 1964; Muth); the amplitude term keeps the cymatic premise (the plate's crests are the civic centres); the metro term reflects the well-documented station premium. The weights are design choices, not estimates.
- **Market zoning**: by value rank, the top 15 % of lots core, the next 35 % mixed, the rest residential (green stays green). The share of lots where this agrees with the amplitude zoning the engine assigned is reported, not enforced: the engine builds the wave's city and says how far the market would pull it.

## Street widths

Lanes needed = ⌈peak flow / (1,800 × 0.9)⌉ against lanes provided by the preset widths. Length that needs more lanes and length with three or more spare lanes are reported, so the plan is judged by the traffic it generates rather than its width table.

## What is not modelled

Non-commute trips (shopping, school, freight), which are more than half of all urban trips; turning delays and signal timing; parking supply; route choice between equal paths (all-or-nothing on the shortest); induced demand; income, car ownership and household structure; land-value feedback on densities over time (the simulation's growth is amplitude-led, not value-led).
