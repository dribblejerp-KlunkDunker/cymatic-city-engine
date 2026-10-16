# Simulation Standards: Constants for Turning a Procedural City into a Running Simulation

Legend: **[S]** = sourced this session (link given). **[U]** = unsourced: from standard engineering convention or training knowledge, or constructed by me, and not verified against a document. Treat [U] as a tunable default. Several primary standards (AWWA M32, TCQSM, EPRI, IEEE 1366, ASCE) are paywalled or unreadable, so many "obvious" numbers remain [U].

## 1. Diurnal demand profiles

### Takeaway
No readable source gave hourly multiplier tables, only qualitative shape and a few peak factors. The 24-hour table below is a constructed default (sums of Gaussians, normalised to mean 1.0) that matches the sourced shape facts. Every table value is [U].

### Cited Findings
- Residential water use is two-peaked: lowest 00:00-05:00, morning peak 06:00-09:00, medium midday, evening peak from about 18:00. Weekend morning peaks are higher and later. — [Water Supply, IWA (Dubai)](https://iwa.silverchair.com/ws/article-pdf/21/3/1144/1099514/ws021031144.pdf)
- Peaking factors fall as the number of households rises. They also depend on the averaging interval. — [Stellenbosch thesis abstract](https://scholar.sun.ac.za/handle/10019.1/100354)
- A rail HST planning study uses a peak hour of 12% of daily boardings (inter-regional) and 17% (local, small station), with a 1.2 directional peaking factor for local trips. — [FRA Appendix B](https://railroads.dot.gov/sites/fra.dot.gov/files/fra_net/334/14_Appendix_B_Transit_Analysis.pdf)
- The EPRI Load Shape Library has "unknown confidence and precision"; NREL EULP/ResStock is the open, calibrated alternative (hourly data per building type and county, open on AWS). — [DOE/NREL ResStock slides](https://www.energy.gov/sites/default/files/2023-06/bto-peer-2023-15132-resstock-nrel-present.pdf), [NREL EULP](https://www.nrel.gov/buildings/end-use-load-profiles)

### Constructed hourly factors (all [U]; index 0 = 00:00-01:00; demand arrays have mean 1.0)
- Water (res.), peak 1.88 at 07:00: `0.53,0.49,0.49,0.51,0.62,0.98,1.55,1.88,1.61,1.14,0.91,0.93,0.97,0.92,0.82,0.78,0.88,1.13,1.40,1.52,1.39,1.11,0.82,0.62`
- Sewage flow (lag ~1.5-2 h, damped), peak 1.70 at 09:00: `0.73,0.58,0.49,0.46,0.48,0.59,0.86,1.29,1.66,1.70,1.43,1.12,0.99,0.97,0.95,0.89,0.84,0.87,1.02,1.22,1.36,1.36,1.20,0.96`
- Electricity, residential, peak 1.75 at 19:00: `0.74,0.67,0.65,0.65,0.68,0.76,0.88,0.96,0.92,0.84,0.80,0.80,0.82,0.84,0.89,1.00,1.19,1.45,1.67,1.75,1.64,1.39,1.11,0.88`
- Electricity, commercial, peak 1.71 at 13:00: `0.55,0.54,0.55,0.57,0.60,0.66,0.75,0.87,1.03,1.21,1.40,1.56,1.67,1.71,1.67,1.56,1.40,1.21,1.03,0.87,0.75,0.66,0.60,0.57`
- Rail boardings, % of daily total (sums to 100; busiest hour 11.8% at 08:00): `0,0,0,0,0.3,1.4,4.1,9.1,11.8,7.3,4.1,3.8,4.4,4.1,3.8,4.5,6.8,10.0,9.5,5.4,3.6,2.7,2.3,1.1`

Generator, if you prefer formulas: `f(h)=base + Σ a_i·exp(-d(h,μ_i)²/2σ_i²)`, then divide by the 24-hour mean. Parameters (all [U]):
- Water: base 0.35; peaks (a, μ, σ) = (1.0, 7.5, 1.4), (0.75, 19.5, 2.0), (0.35, 12.5, 2.0).
- Sewage: base 0.35; peaks (1.0, 9.0, 1.7), (0.75, 21.0, 2.3), (0.4, 14, 2.2).
- Residential electricity: base 0.55; peaks (0.25, 7.5, 1.5), (0.95, 19.5, 2.3), (0.15, 13, 3).
- Commercial electricity: base 0.45; one peak (1.0, 13.5, 3.8).

### Inferences

### Gaps
- No readable AWWA M32/M22, EPRI or transit-agency hourly table was found. A direct download of NREL EULP county-level load shapes (or an agency GTFS/APC dataset) would replace the electricity and rail columns.

## 2. Water hydraulics

### Takeaway
Use Hazen-Williams with the C table below and pressure bands of 20 psi minimum, 35-40 psi normal minimum, about 80 psi maximum. The SI constant 10.67 was not confirmed from a fetched page, but is the standard SI conversion (see check below).

### Cited Findings
- Design C factors: cast iron new 130; cast iron 10 yr 107-113; 20 yr 89-100; cement-lined ductile iron 140; PVC 150; polyethylene 140; FRP 150; asbestos-cement 140; concrete 100-140; steel 90-120; copper 130-140; galvanized 120. — [Wikipedia: Hazen-Williams](https://en.wikipedia.org/wiki/Hazen%E2%80%93Williams_equation)
- Unlined cast/ductile iron C=100, cement-lined 120 (NFPA 13 convention, conservative). US customary form P = 4.52·Q^1.85 / (C^1.85·d^4.87), psi per ft, Q in gpm, d in inches. — [Building Code Resource Library](https://www.buildingcoderesourcelibrary.com/The-Hazen-Williams-Formula.pdf)
- Ten States Standards summary: maintain at least 20 psi at all points under all flow conditions; normal working pressure 60-80 psi with a floor of 35 psi. — [WSB summary](https://www.wsbeng.com/summary-of-10-states-standards-for-drinking-water-distribution-piping-design/)

### Constants table
| Item | Value | Tag |
|---|---|---|
| Head loss (SI) | h_f = 10.67·L·Q^1.852 / (C^1.852·D^4.87); L, D in m, Q in m³/s, h_f in m | [U] (constant not seen in fetched pages; US form [S] above converts to it) |
| Pressure (m head → kPa) | p = 9.81·h kPa per m | physics |
| C by material | See cited list; sim default: new DI 140, aged iron 100 (age factor C = 140 − 1.0·age yr, floor 80 [U]), PVC 150 | [S] values, aging rule [U] |
| Min residual, fire flow | 20 psi = 140 kPa | [S] |
| Min normal pressure | 35 psi = 241 kPa (40 psi = 276 kPa common) | [S] for 35 |
| Typical normal range | 60-80 psi = 414-552 kPa | [S] |
| Max pressure | ~80 psi = 552 kPa (above this, PRVs) | [S] (80 as upper normal) / [U] as hard max |
| Velocity limit | 1.5 m/s normal, 3 m/s max | [U] |

### Inferences

### Gaps
- No fetched source gave the SI Hazen-Williams 10.67 constant, a fire-flow pressure rule beyond 20 psi, or AWWA M32 content.

## 3. Electrical distribution

### Takeaway
Single-core Al XLPE 11 kV cables have AC resistance of about 0.41 / 0.21 / 0.13 Ω/km for 95 / 185 / 300 mm² and ratings of about 245 / 355 / 455 A in ground. Reactance was not legible, so a typical 0.10-0.12 Ω/km is [U].

### Cited Findings
- Single-core 11 kV XLPE Al, AC resistance at 90 °C: 95 mm² 0.411 Ω/km; 185 mm² 0.211; 300 mm² 0.130. Rating laid direct (trefoil, 15 °C ground, 0.8 m depth, 1.2 K·m/W): 245 / 355 / 455 A. — [BS6622/BS7835 11 kV Al datasheet](https://www.powerandcables.com/wp-content/uploads/2017/03/11kV-MV-Cables-BS6622-BS7835-Single-Core-XLPE-AWA-Stranded-Aluminium-Conductors.pdf)
- Three-phase drop (line-to-line): ΔV = √3·I·(R cos φ + X sin φ), with R, X over the length. — [EEPower](https://eepower.com/technical-articles/distribution-transformerspart-6-voltage-drops-quality-standards/)
- ANSI C84.1 Range A: service voltage ±5%; Range B: +5.8% / −13.3% (limited periods). EN 50160: 95% of 10-minute values within ±10%, all within +10/−15%. — same source

### Constants table
| Item | Value | Tag |
|---|---|---|
| R (Al, 90 °C) 95/185/300 mm² | 0.411 / 0.211 / 0.130 Ω/km | [S] |
| Ampacity in ground, same sizes | 245 / 355 / 455 A | [S] |
| X (11 kV XLPE, trefoil) | 0.10-0.12 Ω/km, all sizes | [U] |
| Power factor | 0.95 lagging residential, 0.9 commercial | [U] |
| Customer voltage band | ±5% (Range A) | [S] |
| Feeder share of drop budget | 3-5% MV feeder; remainder to LV and transformer | [U] |
| Transformer rating | Continuous 100% nameplate; plan at ≤ 80% normal loading | [U] |
| N-1 transformer | Remaining units carry full load at ≤ 100-120% for emergency hours | [U] |

Worked check: 185 mm² Al, 5 km, 200 A, pf 0.95 (sin φ = 0.312), X = 0.11: R·L = 1.055 Ω, X·L = 0.55 Ω; ΔV = 1.732·200·(1.055·0.95 + 0.55·0.312) = 1.732·200·1.174 ≈ 407 V ≈ 3.7% of 11 kV, inside a 5% feeder limit. This is arithmetic from the table, not from a source.

### Inferences

### Gaps
- Reactance figures were not readable; IEEE 141 and utility planning limits were not accessed.

## 4. Sewers under partial flow

### Takeaway
Partial-flow ratios follow directly from circular-pipe geometry plus Manning's equation, so the table below is exact computation, not an estimate. Peak capacity occurs at d/D ≈ 0.94 (about 1.076 × Q_full), and peak velocity at d/D ≈ 0.81 (about 1.14 × V_full).

### Cited Findings
- Partial-flow relations for circular and other shapes are published as curves, with ratios to full flow. — [ACPA DD16](https://old.concretepipe.org/wp-content/uploads/2014/09/DD_16.pdf) (curves only; one readable point: V/V_full = 0.81 at d/D = 0.33)

### Computed hydraulic elements (circular pipe, constant n; computed here from geometry, θ = 2·acos(1−2y))
| d/D | A/A_full | R/R_full | V/V_full | Q/Q_full |
|---|---|---|---|---|
| 0.1 | 0.052 | 0.254 | 0.401 | 0.021 |
| 0.2 | 0.142 | 0.482 | 0.615 | 0.088 |
| 0.3 | 0.252 | 0.684 | 0.776 | 0.196 |
| 0.4 | 0.374 | 0.857 | 0.902 | 0.337 |
| 0.5 | 0.500 | 1.000 | 1.000 | 0.500 |
| 0.6 | 0.626 | 1.111 | 1.072 | 0.672 |
| 0.7 | 0.748 | 1.185 | 1.120 | 0.837 |
| 0.8 | 0.858 | 1.217 | 1.140 | 0.977 |
| 0.9 | 0.948 | 1.192 | 1.124 | 1.066 |
| 1.0 | 1.000 | 1.000 | 1.000 | 1.000 |

Formulas: A = D²(θ − sin θ)/8, P = Dθ/2, V = (1/n)·R^(2/3)·S^(1/2), Q = V·A. Full-pipe: Q_full = (0.3117/n)·D^(8/3)·S^(1/2) (SI, D in m) [U]. Use n ≈ 0.013 for concrete/PVC-ish pipe, 0.011-0.013 range [U].

| Sewer rule | Value | Tag |
|---|---|---|
| Design depth | d/D ≤ 0.5-0.75 at peak design flow | [U] |
| Minimum self-cleansing velocity | 0.6-0.75 m/s at partial flow | [U] |
| Max velocity | 3-5 m/s | [U] |
| Wastewater return | 80% of water use | [U] |
| Peak/average dry-weather | Use the sewage column above (peak ~1.7) | [U] |
| Surcharge | Q demand > ~1.07·Q_full or d/D ≥ 1: pipe pressurises; flag flooding if HGL reaches ground | [U], peak ratio computed |

### Inferences
- Sewage should be a lagged, smoothed copy of water use: lag about 1.5 h (brief says 1-2 h, [U]).

### Gaps
- No published ASCE/EPA design depth or surcharge threshold was retrieved.

## 5. Metro capacity and trip distribution

### Takeaway
Line capacity = trains/hour × (cars × per-car capacity), derated by a design load factor. TCQSM text was not retrievable, so loading standards are [U]. Gravity exponents: literature range 0.5-3, with intra-city estimates often about 0.5-1 for power-law forms.

### Cited Findings
- Intra-city mobility gravity fits are power-law, T_ij/(T_i T_j) ∝ r_ij^(−γ). For Chicago γ ≈ 0.53 (low R² 0.17); the exponent varies from about 0.1 (low-traffic cell pairs) to about 0.94 (high-traffic pairs). Gravity-model exponents generally cited between 0.5 and 3. — [Multiple gravity laws for human mobility within cities](https://arxiv.org/html/2305.15665v2)

### Constants table
| Item | Value | Tag |
|---|---|---|
| Car capacity (metro, 3 m wide) | ~40 seated + standees at 4 /m² ≈ 180-200 crush/car | [U] |
| Train | 6-8 cars, so ~1 000-1 500 design passengers | [U] |
| Min headway | 90-120 s, so 30-40 trains/h; 24 tph common practical | [U] |
| Line capacity | 24-30 tph × 1 200 ≈ 30 000-36 000 pphpd | [U] |
| Peak-hour peak-direction load | 60-100% of capacity in busy systems | [U] |
| Crowding thresholds | ≤ 2 standees/m² comfortable; 4 /m² busy; 6 /m² crush (planning), 8 /m² physical | [U] |
| Peak-hour share of daily | 10-15% (12% sourced for HST) | [S]/[U] |
| Directional split in peak | 60-65% in peak direction | [U] |

Gravity model: T_ij = k · P_i · A_j · f(d_ij), balanced so Σ_j T_ij = O_i (production-constrained). Deterrence forms:
- Power: f = d^(−γ), γ ≈ 1.0-2.0 for commuting in simulation use [U]; empirical 0.5 for a mixed city flow set [S].
- Exponential: f = exp(−β·d), β ≈ 0.1-0.3 per km, mean commute 6-12 km [U].

### Inferences

### Gaps
- TCQSM (TCRP 165) loading standards, load factors and line-capacity formulas could not be fetched (the NAP page returned unrelated content). All crowding values above are [U].

## 6. Urban growth and building lifecycle

### Takeaway
Building lifespan is best modelled as a Weibull distribution with rising hazard. The one sourced calibration (urban China residential) is a short-lived extreme; Western stock lives longer, so set the scale accordingly.

### Cited Findings
- Urban Chinese residential stock: Weibull shape 1.47, scale 37.64, mean life 34.1 yr, SD 23.5 yr; demolition ≈ 32% of new construction 2006-2010. A shape above 1 means demolition hazard rises with age. — [Cambridge EPRG working paper](https://www.jbs.cam.ac.uk/wp-content/uploads/2023/12/eprg-wp1923.pdf), [repository](https://www.repository.cam.ac.uk/handle/1810/295360)
- Other models: fixed demolition rate 0.5%/yr (3CSEP-HEB); 1/30 of stock per year (about 3.3%, Yu et al.); prior normal-distribution studies use mean 30-50 yr; Japan average under 30 yr (lognormal). — same source
- Global built-up density fell 2.0%/yr (±0.4) over 1990-2000 in a 120-city sample; US tracts 1.9%/yr 1910-2000; 30-city historical sample peaked about 1890 then fell to one third. 2000 average densities: land-rich developed 28, other developed 70, developing 135 persons/ha. Developing-country urban population doubling in 30 years implies built-up area tripling (about 3.7%/yr area vs about 2.3%/yr population, my arithmetic). — [Lincoln Institute: Persistent Decline in Urban Densities](https://www.lincolninst.edu/publications/working-papers/persistent-decline-urban-densities)

### Constants table
| Item | Value | Tag |
|---|---|---|
| Weibull lifetime, Chinese residential | k = 1.47, λ = 37.64 yr | [S] |
| Residential lifetime, general | mean 50-100 yr (e.g. k = 2, λ = 80) | [U] |
| Commercial / office | mean 30-60 yr | [U] |
| Towers | 40-70 yr (shorter economic life than structural life) | [U] |
| Annual demolition/replacement | 0.5-1.5% of stock | 0.5% [S] (one model); range [U] |
| Replacement trigger | land value/improvement-value ratio > ~1.5-2, i.e. redevelopment when FAR potential > existing × 1.5 | [U] |
| Population growth, fast | 3-5%/yr; slow 0-1%/yr; mature 1-2% | [U] |
| Built-up area growth | ≈ 1.5-1.6 × population growth rate in developing cities | [S] derived |
| Density change in expanding cities | −1 to −2%/yr average density | [S] |
| FAR vs accessibility | FAR ∝ (accessibility index)^α, α ≈ 0.5-1 | [U] |
| Radial expansion | transit-era city: about 1-2 km/decade at the edge; auto-era about 2-4 km/decade | [U] |

Radius from area: r = √(A/π). With area growing 3.7%/yr, radius grows about 1.85%/yr, so a 10 km city gains about 1.9 km per decade [S-derived]. That agrees with the [U] transit-era figure.

### Inferences
- Use the hazard form h(t) = (k/λ)(t/λ)^(k−1) per building and sample demolition each tick; this gives a rising replacement rate as the stock ages without tuning a flat percentage.

### Gaps
- No readable source for commercial/tower lifespans, km/decade expansion in transit-era cities (Angel's Atlas of Urban Expansion was not fetched), or city-specific growth rates.

## 7. Resilience metrics

### Takeaway
Use SAIDI/SAIFI/CAIDI for power (IEEE 1366 definitions), an N-1 contingency sweep for every network, and fraction-of-demand-served-after-failure as the common cross-network index.

### Cited Findings
- SAIDI is average cumulative outage duration per customer served, in minutes or hours. Benchmarks: North America median about 1.5 h (IEEE 1366 reference); US EIA average about 2.0 h, rising to 3.5-8 h with major events. World Bank 2019 SAIDI hours: Switzerland/Germany 0.2, UK 0.3, US 1.2, Romania 2.1. — [Wikipedia: SAIDI](https://en.wikipedia.org/wiki/SAIDI)

### Definitions and targets
| Metric | Formula | Target | Tag |
|---|---|---|---|
| SAIDI | Σ(customers interrupted × duration) / total customers | 60-120 min/yr healthy; > 200 poor | formula [U]; 90 min median [S] |
| SAIFI | Σ(customers interrupted) / total customers | ~1.0 interruptions/yr | [U] |
| CAIDI | SAIDI / SAIFI | ~60-90 min | [U] |
| N-1 | System meets demand with any single element out (line, transformer, pump, trunk main), with no overloads or voltage violations | Pass/fail per element | [U] |
| FDS (fraction of demand served) | Σ served demand after removing element i / Σ demand | Report min and mean over i | [U] |
| Water reliability | Share of nodes with p ≥ 140 kPa after a single main break; supply-demand ratio | ≥ 95% mean | [U] |

### Inferences
- Run N-1 as: remove element i, re-solve flows, count overloaded edges and under-pressure or under-voltage nodes, compute FDS_i; resilience score = mean(FDS_i) and worst-case min(FDS_i).

### Gaps
- IEEE 1366 text, AWWA water reliability indices, and standard N-1 definitions from NERC/ENTSO-E were not fetched; definitions here are conventional.
