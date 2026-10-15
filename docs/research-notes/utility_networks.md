# City Utility Network Design Rules (for procedural sizing and routing)

Method note: values below are from fetched primary or regulatory text unless marked "unsourced". Several requested numbers (electrical per-capita load, substation spacing, station spacing, tank storage, sewer depth limits) could not be confirmed from fetched sources and sit in Gaps. Metric conversions are mine (1 ft = 0.3048 m, 1 gal = 3.785 L).

## 1. Gravity sewers

### Takeaway
The Ten-States-style slope table you proposed is confirmed exactly (200 mm = 0.40%, 250 = 0.28%, 300 = 0.22%, 375 = 0.15%, 450 = 0.12%, 600 = 0.08%). Min velocity is 0.61 m/s flowing full with n = 0.013; manholes at most 120 m apart for small pipes; cover at least ~0.9 m in standards that specify it.

### Cited Findings
- Minimum slope (% = ft per 100 ft), Illinois code derived from Ten States Standards: 8 in (200 mm) 0.40; 10 in (250) 0.28; 12 in (300) 0.22; 14 in (350) 0.17; 15 in (375) 0.15; 16 in (400) 0.14; 18 in (450) 0.12; 21 in (525) 0.10; 24 in (600) 0.08; 27 in 0.067; 30 in (750) 0.058; 33 in 0.050; 36 in (900) 0.046; 42 in (1050) 0.036. Steeper slopes are preferred. — [Illinois 35 IAC 370.320](https://ilga.gov/ftp/JCAR/AdminCode/035/035003700C03200R.html)
- Michigan rule gives the same series for small sizes (4 in 1.20%, 6 in 0.60%, 8 in 0.40%, 10 in 0.28%, 12 in 0.22%, 14 in 0.17%). — [Mich. Admin. Code R 325.3331](https://www.law.cornell.edu/regulations/michigan/Mich-Admin-Code-R-325-3331)
- Minimum mean velocity 2.0 ft/s (0.61 m/s) flowing full, computed with Manning n = 0.013; above 15 ft/s (4.6 m/s) erosion/shock protection is required. — [Illinois 370.320](https://ilga.gov/ftp/JCAR/AdminCode/035/035003700C03200R.html); [Utah R317-3-2](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R317-3-2)
- Minimum cover 3 ft (0.9 m) unless structurally protected; also deep enough to prevent freezing. — [Illinois 370.320](https://ilga.gov/ftp/JCAR/AdminCode/035/035003700C03200R.html)
- Other cover figures: 750 mm PVC, 500 mm concrete, 1.0 m under vehicle traffic (Saanich, BC). — [Saanich Schedule H](https://www.saanich.ca/assets/Community/Documents/essewerdrain.pdf)
- Manhole spacing: max 400 ft (120 m) for sewers 15 in or smaller; 500 ft (150 m) for 18-30 in; up to 600 ft (180 m) with adequate cleaning equipment; also at every change in grade, size or alignment and at line ends over 150 ft (46 m). — [Utah R317-3-2](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R317-3-2)
- Saanich variant: 120 m for 200-375 mm; 180 m for 400-1200 mm; 300 m above 1200 mm. — [Saanich](https://www.saanich.ca/assets/Community/Documents/essewerdrain.pdf)
- Flow: Utah (Ten-States-derived) 100 gpcd (about 380 L/cap/d) annual average including infiltration/inflow; design peak 400 gpcd (about 1500 L/cap/d) for laterals and collectors, 250 gpcd for interceptors/outfalls. — [Utah R317-3-2](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R317-3-2)
- Saanich: 360 L/cap/d residential, 2.25-2.75 persons per unit, Harmon peaking, infiltration at least 0.13 L/s/ha. — [Saanich](https://www.saanich.ca/assets/Community/Documents/essewerdrain.pdf)
- Manning n: 0.013 concrete (standards default), 0.018 on curved sewers (Utah); 0.011 PVC (Saanich); 0.009 PVC recommended from field data, and 0.013 is called unconservative for concrete and clay. — [Utah](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R317-3-2); [Saanich](https://www.saanich.ca/assets/Community/Documents/essewerdrain.pdf); [Uni-Bell](https://www.uni-bell.org/portals/0/ResourceFile/manning-s-n-for-pvc-gravity-sewer-pipe.pdf)
- Flatter slopes: flow depth at least 30% of diameter at average design flow; drop manhole when incoming invert is 24 in (0.6 m) or more above outgoing. — [Utah](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R317-3-2)
- Saanich minimum slopes: 0.6% for the upstream reach serving 25 people or fewer, 2.0% for service connections. — [Saanich](https://www.saanich.ca/assets/Community/Documents/essewerdrain.pdf)

### Inferences
- Engine rule: S_min(D) ≈ 0.40% x (200 mm / D)^1.1 reproduces the table to within roughly 10% (my fit; check against the table before use). Simpler: look up the table and interpolate.
- Wastewater is about 80-90% of water use (unsourced rule of thumb) but the standards above adopt about 360-380 L/cap/d including I/I, so size from the standard, not from the water figure.
- Peak/average ratio is about 4 for small laterals (400/100 gpcd) and falls toward 2.5 for interceptors (250/100); Harmon is the standard continuous form (PF = 1 + 14/(4+sqrt(P)), P in thousands). The Saanich text as fetched appears to omit the square root; treat the Harmon form as standard knowledge, not confirmed from that page.
- Full-flow capacity Q = (1/n) A R^(2/3) S^(1/2); size so peak flow fills the pipe to about 0.5-0.75 D.

### Gaps
- Maximum practical depth before lift station (the 6-10 m figure): no source found. Treat as an engine tunable (unsourced engineering convention).
- Population per treatment plant scale: not found.
- Ten States Standards document itself was not fetched; state codes derived from it were used.

## 2. Water distribution

### Takeaway
Municipal design uses about 300 L/cap/d average, max-day 1.8x and peak-hour 3.0x, pressure 275-690 kPa static (28-70 m head), at least 140 kPa residual under fire flow, 150 mm minimum main in residential streets, 2 m cover in cold climates.

### Cited Findings
- Vaughan (Ontario) criteria: 300 L/cap/d average (residential and employment), 347/317 in the dense core; max-day factor 1.8 (2.5 core); peak-hour factor 3.0 (4.0 core). — [Vaughan Design Criteria, Apr 2026](https://www.vaughan.ca/sites/default/files/2026-04/Section%201.5%20-%20Design%20Criteria%20-%20April%204%2C%202026.pdf)
- Same: minimum 275 kPa static at peak hour; minimum 140 kPa residual under fire flow plus max-day or peak-hour demand; maximum 690 kPa static; cover at least 2.0 m (2.1 m under road centreline); services 2.0 m (1.5 m if insulated); minimum main 150 mm residential, 300 mm industrial. — [Vaughan](https://www.vaughan.ca/sites/default/files/2026-04/Section%201.5%20-%20Design%20Criteria%20-%20April%204%2C%202026.pdf)
- Fire flow by land use: single/semi-detached 7,000 L/min (117 L/s); townhouses 9,000 L/min (150 L/s); apartments 19,000 L/min (317 L/s); institutional 15,000 L/min (250 L/s); industrial/commercial 25,000 L/min (417 L/s). — [Vaughan](https://www.vaughan.ca/sites/default/files/2026-04/Section%201.5%20-%20Design%20Criteria%20-%20April%204%2C%202026.pdf)
- WHO service levels (Howard and Bartram 2003): basic access (100-1000 m away) average under 20 L/c/d; intermediate (one tap on plot) about 50; optimal (multiple taps, continuous) 100 and above, possibly up to 300; 7.5 L/c/d is the bare drinking/food minimum. — [WHO/Howard and Bartram](https://www.arctic.gov/uploads/assets/watersan6-water-quantity.pdf)
- US household: a family of four uses about 400 gal/day, about 100 gal/person/day (about 380 L/cap/d, my division); homes use over half of publicly supplied water. — [EPA WaterSense](https://19january2017snapshot.epa.gov/www3/watersense/pubs/supply.html)

### Inferences
- Engine defaults: residential indoor 150-200 L/cap/d; total urban (with commercial, industrial, losses) about 300 L/cap/d; max-day 1.8, peak-hour 3.0 (Vaughan); pressure target 30-50 m head (about 300-500 kPa), clamp 14-70 m.
- Pressure head 275-690 kPa equals 28-70 m on Earth; that range sets pressure-zone height band (about 40 m of elevation per zone, since 690-275 kPa is about 42 m). Zone boundaries follow elevation contours; add a PRV or booster at each boundary.
- Main size ladder: 150 mm local (needs only about 1 L/s per hydrant-adjacent house), 200-300 mm collectors, 400+ mm trunk; size so peak-plus-fire flow stays under about 2 m/s.
- Looped grid in dense areas (fire-flow redundancy), branched dead-ends at cul-de-sacs only (unsourced best practice).

### Gaps
- Design velocity limits (0.6-2 m/s): the Vaughan page gave no limit; no other source retrieved.
- Elevated tank height and storage (about 1 day demand), service area per tank: no source retrieved.
- UN/UN-Habitat total urban per capita figures: fetches failed; only WHO and EPA found.

## 3. Electrical distribution

### Takeaway
Primary distribution is about 4-35 kV fed from substations at 69-115 kV; a feeder is planned at roughly 12 MVA (13.8 kV), about 20 MVA (22-25 kV), 30-37 MVA (34.5 kV). Per-capita loading, substation MVA and spacing were not obtainable.

### Cited Findings
- Primary voltages roughly 4-35 kV; common levels 33, 24.9, 22, 13.8/12.47, 11 kV; substations often fed from 69-115 kV. — [EEPower primary distribution](https://eepower.com/technical-articles/primary-distribution-systemspart-1-design-of-feeders-and-laterals/)
- Feeder capacity: about 4 MVA at 4.16 kV, 12-15 MVA at 12.47/13.8 kV, about 20 MVA at 22-24.9 kV, 30-37 MVA at 34.5 kV; practical limit about 600 A. — [EEPower](https://eepower.com/technical-articles/primary-distribution-systemspart-1-design-of-feeders-and-laterals/)
- Average US three-phase feeder about 10.8 miles (17 km); rural 24.9 kV circuits 40-50 miles. Secondary voltage drop budget about 2-3% feeder, 5% total. — [EEPower](https://eepower.com/technical-articles/primary-distribution-systemspart-1-design-of-feeders-and-laterals/)

### Inferences
- Urban feeders are much shorter than the 17 km average (that figure is rural-skewed); a 3-5 km urban limit at 11 kV is plausible from 600 A and 2-5% drop but is not confirmed by a source here.
- Feeder MVA divided by per-capita peak gives people per feeder; e.g. 12 MVA / 1 kW per person is about 12,000 people (per-capita value unsourced; see Gaps).

### Gaps
- City average/peak kW per person, substation MVA ratings (e.g. 2 x 40 MVA), customers per substation, urban substation spacing, underground cable depth: searches returned no extractable figures (fetches of master plans failed). Typical-knowledge placeholders (unsourced): city average about 0.5-1 kW/person, peak about 1-2 kW/person; cable depth about 0.6-1.2 m; transmission 110-400 kV. Verify before use.

## 4. Metro and transit tunnels

### Takeaway
Heavy rail carries 12,000-48,000 passengers/hour/direction (25-32 trains/h); bored single-bore double-track tunnels are about 9.5 m, twin single-track about 6.3 m each; Singapore shows 25-28 m depth; cut-and-cover stations about 120 m x 12-14 m.

### Cited Findings
- Heavy rail: about 25 trains/h (short trains) to 32 trains/h (long trains); about 12,000 to 48,000 p/h/dir. — [TCRP Report 165 ch.3 (TCQSM 3rd ed.)](https://onlinepubs.trb.org/onlinepubs/tcrp/tcrp_rpt_165ch-03.pdf)
- Typical line about 36,000 p/h/dir; Hong Kong MTR 75,000-85,000; headways 90-120 s; 6-12 car trains. — [Wikipedia: Rapid transit](https://en.wikipedia.org/wiki/Rapid_transit)
- Barcelona study: 12 m bored tunnel (up to four tracks, two levels); 9.5 m single double-track bore (70.9 m²); two 6.3 m single-track bores (31.2 m² each); cover-to-diameter 1.5-5 in rock, 0.6-1 D under river deposits; at least 2 m of rock above shield under a motorway. — [ISSMGE paper](https://www.issmge.org/uploads/publications/6/11/2005_105.pdf)
- Same paper: cut-and-cover station boxes 120 x 14 m (twin 6.3 m option) or 120 x 12 m (single 9.5 m option); 26 m diameter shaft-type station. — [ISSMGE paper](https://www.issmge.org/uploads/publications/6/11/2005_105.pdf)
- Singapore Downtown Line TBM tunnels about 25-28 m below ground. — [Geocase Histories Journal](https://www.geocasehistoriesjournal.org/issues/volume-3-3/case-histories-of-bored-tunnelling-below-buildings-in-singapore/pdf)
- Deepest stations: Hongyancun 116 m, Arsenalna 105.5 m. — [Wikipedia: Rapid transit](https://en.wikipedia.org/wiki/Rapid_transit)

### Inferences
- Platform length about 120 m implies a 6-car train of 20 m cars; 150-180 m for 8-9 cars (derived; platform length itself not sourced beyond the 120 m station box).
- Engine: tunnel crown depth = max(1.0-1.5 D, clearance above utilities + 2 m); typical axis 15-30 m in dense downtown.

### Gaps
- Station spacing (urban about 1 km): no source retrieved; keep as an unsourced tunable (0.8-1.2 km urban, 2-3 km suburban).
- Cut-and-cover depth (about 10 m) not sourced.

## 5. Utility tunnels (utilidors / common utility ducts)

### Takeaway
Real corridors are of multi-compartment box or bored sections; Chinese published example is 12.7 x 2.2 m (five compartments); depths range from 0.5-2 m (shallow) to 2-80 m cover (deep); cost about CA$12M/km (Hengqin).

### Cited Findings
- Beijing Zhongguancun: 12.7 m x 2.2 m section, five compartments, 1.9 km ring, carrying gas, telecom, water, reclaimed water, electricity, heating; located as third underground layer below traffic tunnel and metro/commercial layer. — [CSCE 2019 paper](https://legacy.csce.ca/elf/apps/CONFERENCEVIEWER/conferences/2019/pdfs/PaperPDFversion_25_0422102711.pdf)
- Lengths: Beijing 1958 1.08 km; Shanghai Zhangyang Rd 11.5 km (1994); Hengqin 33.4 km (2013, about CA$400M, about CA$12M/km); Europe more than 50 projects about 400 km (1940-2011); China 2,005 km under construction in 147 cities by end 2016. — [CSCE 2019](https://legacy.csce.ca/elf/apps/CONFERENCEVIEWER/conferences/2019/pdfs/PaperPDFversion_25_0422102711.pdf)
- Depth classes: flush 0 m, shallow 0.5-2 m cover, deep 2-80 m. Hengqin: 1-3 compartments, 2 m cover under a green belt; carries electricity, telecom, water, grey water, cooling, garbage vacuum. — [CSCE 2019](https://legacy.csce.ca/elf/apps/CONFERENCEVIEWER/conferences/2019/pdfs/PaperPDFversion_25_0422102711.pdf)
- Tokyo: use began 1923 after the Kanto earthquake, law in 1963; Tokyo Azabu-Hibiya duct exists. — [CSCE 2019](https://legacy.csce.ca/elf/apps/CONFERENCEVIEWER/conferences/2019/pdfs/PaperPDFversion_25_0422102711.pdf); [Wikipedia: Utility tunnel](https://en.wikipedia.org/wiki/Utility_tunnel)
- Alaska frost line often more than 5.5 m (18 ft), a driver for utilidors; Qatar Lusail 14-15 km; Chicago freight tunnels about 40 ft (12 m) deep; Dartford and Cologne/Copenhagen examples carry HV lines and district heating. — [Wikipedia: Utility tunnel](https://en.wikipedia.org/wiki/Utility_tunnel)
- Korean review: domestic ducts are cut-and-cover box sections; overseas bored via shield TBM; pipe/tray clearances are tabulated but not machine-readable. — [KoreaScience](https://koreascience.kr/article/JAKO201809454740586.do)
- Singapore passed a Common Services Tunnels Bill 18 March 2018 (no dimensions found). — [CSCE 2019](https://legacy.csce.ca/elf/apps/CONFERENCEVIEWER/conferences/2019/pdfs/PaperPDFversion_25_0422102711.pdf)

### Inferences
- Tunnel carries pressurised mains, power, telecom, district heat/cool; gravity sewers are usually kept out (slope constraint) though large ducts sometimes include them (unsourced).
- Placement rule: trunk streets in dense districts, cut-and-cover at 2-8 m; one compartment per utility class; width = sum of compartments.

### Gaps
- A 3 x 3 m typical cross-section, Helsinki and Singapore specifics, access/ventilation spacing: not found.

## 6. Building foundations and tunnel clearance

### Takeaway
Towers of 800 m use about 50 m piles under a 3.7 m raft; typical low-to-mid-rise pile toes of 9-18 m; tunnel-to-pile clearances in real practice 2.6-10 m, with 4.5-9 m common.

### Cited Findings
- Burj Khalifa (818 m): 192 bored piles about 1.5 m diameter and about 50 m long, under a raft about 3.7 m thick. — [GeoPrac](https://geoprac.net/2010/page/25/)
- Singapore Downtown Line: pile foundations 4.5 m and 8.7 m from the two tunnels at Lavender St (piles 9-18 m); a hotel pile toe 2.6 m from the tunnels (piles 12-18 m); bored piles 5 m (industrial) and 9 m (housing) from tunnels; shallow footings 19-20 m above tunnels; raft with 2 basements about 10 m above. — [Geocase Histories Journal](https://www.geocasehistoriesjournal.org/issues/volume-3-3/case-histories-of-bored-tunnelling-below-buildings-in-singapore/pdf)
- Museum: micropiles about 4 m, bored piles about 10 m, diaphragm walls about 16 m above tunnels, with a 2 m raft. — [Geocase Histories Journal](https://www.geocasehistoriesjournal.org/issues/volume-3-3/case-histories-of-bored-tunnelling-below-buildings-in-singapore/pdf)

### Inferences
- Engine: pile length about 10-18 m for mid-rise; scales to about 50 m for supertall (height-to-pile roughly 16:1 at Burj Khalifa); basements 1 level per about 3 m, 2-4 levels in downtown towers.
- Clearance rule: keep tunnel crown at least 1 tunnel diameter (about 6-10 m) below pile toes, never less than about 3-5 m; reroute or deepen if a footprint pile zone is crossed (derived from the Singapore cases; mitigation such as grouting is used at less).

### Gaps
- No general code rule of thumb on tunnel-to-foundation clearance or depth-vs-height formula found; the numbers above are case-based.

## 7. Gravity scaling

### Takeaway
Physics confirmed: velocity-based self-cleansing slope scales as 1/g and pressure head scales as 1/g; but a tractive-force criterion for self-cleansing is nearly independent of g, so the answer depends on the design criterion.

### Cited Findings
- Standards express the self-cleansing rule as a velocity (0.61 m/s) at a given roughness. — [Illinois 370.320](https://ilga.gov/ftp/JCAR/AdminCode/035/035003700C03200R.html)

### Inferences
- Darcy-Weisbach: V = sqrt(8 g R S / f). For fixed V, S = f V² / (8 g R) so S ∝ 1/g (e.g. Mars g = 3.71 m/s² needs about 2.6x steeper slope; Moon 1.62 needs about 6x). Manning's n is an empirical Earth-calibrated constant (n = R^(1/6) sqrt(f/(8g))), so it must be rescaled by sqrt(9.81/g) if you keep V = R^(2/3) S^(1/2) / n.
- Tractive force: wall shear τ = ρ g R S; critical shear for sediment τ_c = θ (ρs - ρ) g d. Both scale with g, so S_min = θ (ρs/ρ - 1) d / R is g-independent. Use velocity rule for "legacy-standard" feel, tractive rule for physical realism; flows themselves are slower in low g (V ∝ sqrt(g) at fixed slope) so pipes must be larger for the same flow at the same slope.
- Pressure: P = ρ g h, so a required pressure (140-690 kPa) corresponds to head h = P / (ρ g): 28-70 m on Earth, 75-190 m on Mars (g = 3.71), about 170-420 m on the Moon. Elevated tanks must be taller (or use pumped pressure) in low g, and pressure-zone height bands widen by 1/g. Pump power for the same lift head scales with g, but for the same pressure rise it does not.
- Not g-dependent: Joukowsky water-hammer (ΔP = ρ a ΔV), electrical rules, rail capacity, tunnel diameters. Overburden stress (ρ g z) and lining loads scale with g, so tunnels can be shallower-loaded in low g; foundations: building loads and soil strength both scale with g, so required pile depth is roughly g-independent for friction-dominated soils (cohesion terms do not scale) (my reasoning, unsourced).

### Gaps
- No source specifically addressing sewer or water design under non-Earth gravity; this section is derivation only.
