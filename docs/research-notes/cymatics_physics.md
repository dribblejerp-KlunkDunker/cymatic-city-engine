# Cymatics physics: how a driving frequency determines the standing-wave pattern (membrane, plate, sphere)

Provenance legend used below:
- "[Source](URL)" = taken from that page via fetch/search.
- **[COMPUTED]** = I computed it in this session (Python 3, scipy 1.18.1 `jn_zeros`/`jv`/`jnp_zeros`; own free-edge characteristic-equation root finder; own Ritz code with free-free beam functions). Not quoted from a source. Cross-checks are stated where done.
- **[DERIVED]** = elementary derivation by me, not found in a fetched source.
- **[RECALLED]** = from background knowledge, not verified in this session. Treat as unverified.

---

## 1. Circular membrane modes and Bessel zeros

### Takeaway
An ideal clamped circular membrane has modes u = J_m(j_{m,n} r/R) cos(mθ) with f_{m,n} = j_{m,n} c/(2πR), a LINEAR frequency–wavenumber law (f ∝ k). The zeros below were computed to 10 decimals and are consistent with DLMF's definition/interlacing. Note: I could not retrieve DLMF's numeric table through the fetch tool, so the numeric table is [COMPUTED] with scipy (double precision); it also agrees with the McMahon asymptotic formula to the expected accuracy (checked).

### Cited Findings
- DLMF §10.21: positive zeros of J_ν and J_{ν+1} interlace: j_{ν,1} < j_{ν+1,1} < j_{ν,2} < j_{ν+1,2} < ... (eq. 10.21.2); also j'_{0,1}=0 and j'_{0,m}=j_{1,m−1}. — [DLMF 10.21](https://dlmf.nist.gov/10.21)
- Wave-equation membrane model used by a Chladni-plate paper: (1/c²)∂²u/∂t² = ∂²u/∂x²+∂²u/∂y², c² = τ/ρ (τ = tension per length, ρ = areal density); square-membrane frequencies ω_mn = (πc/a)√(m²+n²) (a = half-side in that paper's [−1,1]² scaling). — [Dalessi et al., SN Applied Sciences 2021](https://www.math.uwaterloo.ca/~sdalessi/SN-AppliedSciences2021.pdf)
- Wikipedia's circular-membrane page lists the solution as Bessel in r × sine/cosine in θ × oscillation in time, with roots of J_m from the boundary condition (formulas stripped in my fetch; confirms structure only). — [Wikipedia: Vibrations of a circular membrane](https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane)

### Formulas (standard; [DERIVED]/[RECALLED] — separation of variables of ∇²u + k²u = 0, u(R)=0)
- u_{m,n}(r,θ,t) = J_m(j_{m,n} r/R) · cos(mθ + φ₀) · cos(ω t),  k_{m,n} = j_{m,n}/R,  ω = c k.
- f_{m,n} = j_{m,n} c /(2πR), c = sqrt(T/σ) (T tension N/m, σ areal density kg/m²).
- m = number of nodal diameters (m=0: none), n = number of nodal circles INCLUDING the boundary (so n−1 interior circles). For m ≥ 1 there are two degenerate shapes (cos mθ and sin mθ); any rotation φ₀ is valid, a drive at an off-center point picks the combination.
- Nodal radii for mode (m,n): r_i = R · j_{m,i}/j_{m,n}, i = 1..n−1 (interior circles) [DERIVED]; nodal diameters at θ = (π/2 + kπ − mφ₀... ) i.e. cos(mθ+φ₀)=0 → θ = (π/2 + kπ − φ₀)/m, k=0..2m−1.
- Free-edge (Neumann) membrane: replace j_{m,n} by zeros of J'_m: j'_{0,n}: 3.831706, 7.015587, 10.173468 (j'_{0,0}=0 constant mode); j'_{1,n}: 1.841184, 5.331443, 8.536316; j'_{2,n}: 3.054237, 6.706133, 9.969468; j'_{3,n}: 4.201189, 8.015237, 11.345924. **[COMPUTED]**
- McMahon large-zero formula **[RECALLED; numerically verified here]**: j_{ν,s} ≈ β − (μ−1)/(8β) − 4(μ−1)(7μ−31)/(3(8β)³), β = (s + ν/2 − 1/4)π, μ = 4ν². Checks: ν=0,s=4: 11.7915334 vs exact 11.7915344; ν=1,s=1: 3.83188 vs 3.83171; ν=5,s=4: 18.9819 vs 18.9801 (poorer for large ν, small s). DLMF §10.21(vi) is the cited home of this expansion (page body not retrievable via fetch).

### Table: j_{m,n} (zeros of J_m), **[COMPUTED]**, 10 decimals
| m \ n | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 0 | 2.4048255577 | 5.5200781103 | 8.6537279129 | 11.7915344390 |
| 1 | 3.8317059702 | 7.0155866698 | 10.1734681351 | 13.3236919363 |
| 2 | 5.1356223018 | 8.4172441404 | 11.6198411721 | 14.7959517824 |
| 3 | 6.3801618959 | 9.7610231300 | 13.0152007217 | 16.2234661603 |
| 4 | 7.5883424345 | 11.0647094885 | 14.3725366716 | 17.6159660498 |
| 5 | 8.7714838160 | 12.3386041975 | 15.7001740797 | 18.9801338752 |

(Well-known literature value j_{0,1} = 2.404825557695773 matches to all digits shown.)

### Reference function values **[COMPUTED]**
- J0(1) = 0.765197686558
- J1(1) = 0.440050585745
- J2(2) = 0.352834028616
- J0(5) = −0.177596771314

### Mode ordering by frequency (ratio to fundamental, and an absolute test case) **[COMPUTED]**
Test case: R = 0.1 m, c = 100 m/s → f_{0,1} = j_{0,1}c/(2πR) = 382.74 Hz (coefficient 0.382740 c/R).
| rank | (m,n) | j | f/f₀₁ | f (Hz) |
|---|---|---|---|---|
| 1 | (0,1) | 2.404826 | 1.0000 | 382.74 |
| 2 | (1,1) | 3.831706 | 1.5933 | 609.83 |
| 3 | (2,1) | 5.135622 | 2.1355 | 817.36 |
| 4 | (0,2) | 5.520078 | 2.2954 | 878.55 |
| 5 | (3,1) | 6.380162 | 2.6531 | 1015.43 |
| 6 | (1,2) | 7.015587 | 2.9173 | 1116.57 |
| 7 | (4,1) | 7.588342 | 3.1555 | 1207.72 |
| 8 | (2,2) | 8.417244 | 3.5001 | 1339.65 |
| 9 | (0,3) | 8.653728 | 3.5985 | 1377.28 |
| 10 | (5,1) | 8.771484 | 3.6475 | 1396.03 |
| 11 | (3,2) | 9.761023 | 4.0589 | 1553.52 |
| 12 | (1,3) | 10.173468 | 4.2304 | 1619.16 |
| 13 | (4,2) | 11.064709 | 4.6010 | 1761.00 |
| 14 | (2,3) | 11.619841 | 4.8319 | 1849.36 |
| 15 | (0,4) | 11.791534 | 4.9033 | 1876.68 |
| 16 | (5,2) | 12.338604 | 5.1308 | 1963.75 |

Inversion (drive frequency → mode): the mode set is {(m,n): |f − f_{m,n}| small}; with f_{m,n} ∝ j_{m,n}, the density of modes grows linearly with f (Weyl: N(k) ≈ A k²/(4π) → modes per unit k ∝ k).

### Inferences
- Membrane modes are not harmonically related (ratios 1, 1.593, 2.136, 2.295, ...), the standard "drum" inharmonicity; m≥1 modes are doubly degenerate so any rotation is valid.
- A membrane (f ∝ k) is the cheapest, cleanest model for generating pretty patterns; a true Chladni plate is dispersive (§2) and has a free (not fixed) boundary.

### Gaps
- DLMF's own numeric zero table (Table 10.21.x, from Abramowitz & Stegun 9.5) was not retrievable through the fetch tool; the numbers above are computed, not quoted.

---

## 2. Free circular and square thin plates (Kirchhoff theory), dispersion, Chladni's law

### Takeaway
A thin plate obeys ρh w_tt + D∇⁴w = 0 so ω = k²·sqrt(D/ρh) (f ∝ k², dispersive), versus ω = ck for a membrane. Chladni's empirical law is f ≈ C(m+2n)^p with p≈2 (m = nodal diameters, n = nodal circles); Kirchhoff showed it is asymptotic for high frequency; at low order it is a poor fit and fitted exponents/offsets are needed (fits below).

### Cited Findings
- Plate equation (dimensional): ∂²u/∂t² + D²∇⁴u = 0 with D² = q l²/(12ρ(1−μ²)) (q Young's modulus, l thickness, ρ density, μ Poisson ratio; NOTE this "D²" is the rigidity divided by ρh, units m⁴/s²). Free-edge conditions: u_xx + μ u_yy = 0 and u_xxx + (2−μ)u_xyy = 0 on x = ±1 (analogous on y = ±1), and u_xy = 0 at corners. — [Dalessi et al. 2021](https://www.math.uwaterloo.ca/~sdalessi/SN-AppliedSciences2021.pdf); Springer version: [link](https://link.springer.com/article/10.1007/s42452-020-04062-6)
- Same equation in operator form: (∇²∇² − λ)W = 0 with λ = ρ_s d ω²/D, D = E d³/[12(1−ν²)]; free-edge: bending moment and effective shear vanish (W_nn + νW_ss = 0, W_nnn + (2−ν)W_nss = 0), corner twisting moment zero (W_ns = 0); for rectangles eigenvalues/modes have no closed form. — [Bristol (Marp) report on free-edge rectangular plates](https://people.maths.bris.ac.uk/~marp/abstracts/free-edge.pdf)
- Chladni's law: f ~ (m+2n)², m = number of nodal diameters, n = number of nodal circles; Kirchhoff showed it holds asymptotically for large f. — [Dalessi et al. 2021](https://www.math.uwaterloo.ca/~sdalessi/SN-AppliedSciences2021.pdf)
- Generalizations: Rossing (1982) f_{m,n} = C_n(m+2n)^p; Perrin et al. (1985) f_{m,n} = C(m+bn)^p with empirical b. — [Rossing-era abstract, ASA 1996](https://auditory.org/asamtgs/asa96haw/5pMU/5pMU8.html)
- For flat circular plates p ≈ 2; for cymbals, handbells, church bells p ranges 1.4–2.4 and can change with mode family. — [Wikipedia: Chladni's law](https://en.wikipedia.org/wiki/Chladni%27s_law) (formula image not in extracted text; text only)
- Closed-form exact solutions exist for the circular plate (Bessel J and modified Bessel I); square free plates need numerics. — [Tuan-related PMC article, Symmetry 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10969725/)
- Dalessi's aluminum plate: side 2a = 24 cm, thickness 0.09 cm [as extracted; text says l = 0.09 cm, which implies D² ≈ 1.936 m⁴/s² only if h ≈ 0.9 mm (my check: E=69 GPa, ρ=2700, ν=0.33, h=0.9 mm gives exactly 1.936) — so "0.09 cm" in the extraction is likely 0.09 cm typed vs 0.9 mm; treat h=0.9 mm as consistent with D²=1.936]; ν = 0.33; D²≈1.936 m⁴/s²; a²/D ≈ 0.010 s; ω₀ = (2πa²/D) f ≈ 0.065 f; observed resonances (1–1000 Hz) 190, 340, 490, 800, 955 Hz; "Chladni law Eq. (23)" prediction 12.4 and 62.1 at 190 and 955 Hz respectively vs simulation values 13 … 72; numerical-grid resonance shift ω₀ ≈ π²(m²+n²) − ε₁π⁴(m⁴+n⁴), ε₁=h²/12. — [Dalessi et al. 2021](https://link.springer.com/article/10.1007/s42452-020-04062-6)

### Formulas
Plate (standard, consistent with the cited equations):
- Dispersion: ω = k² sqrt(D/(ρh)), D = E h³/(12(1−ν²)). Membrane: ω = ck. Phase velocity v_p = ω/k = k·sqrt(D/ρh) (increases with k) vs c (constant). Group velocity v_g = 2 v_p. [DERIVED from the cited PDE: plane wave exp(i(kx−ωt)) → ω² = (D/ρh)k⁴.]
- Consequence for mode density: for a plate the number of modes below ω is N(ω) ≈ A/(4π) · ω·sqrt(ρh/D) ∝ ω — modes are uniformly spaced on average in frequency (2D plates have constant modal density, membranes have density ∝ ω). [DERIVED via k=√(ω/…), N(k)=Ak²/4π]
- Free circular plate (radius R): w = [A J_n(kr) + B I_n(kr)] cos(nθ), with n = nodal diameters. Dimensionless eigenvalue λ² ≡ ω R² sqrt(ρh/D) = (kR)² (Leissa's convention), so  f = λ² /(2π R²) · sqrt(D/(ρh)). Free-edge conditions at r=R:
  - M_r = w'' + ν(w'/r − n²w/r²) = 0
  - V_r = w''' + w''/r − [1+(2−ν)n²] w'/r² + (3−ν)n² w/r³ = 0
  (two linear conditions → 2×2 determinant in (A,B), root-find over kR). [My implementation; formulae are the standard Kirchhoff free-edge conditions in polar coordinates; the cited PAN paper only gives the generic form "M=0, V=0 at ξ=1 (Eqs 8a,8b)".] Note: the cited PAN paper defines its dimensionless frequency with λ to the FIRST power (λ = ωR²√(ρh/D)), so check the convention when comparing tables. — [PAN paper](https://journals.pan.pl//Content/84448/PDF/20_paper.pdf)

### Free circular plate eigenvalues λ² = ωR²√(ρh/D) **[COMPUTED]**, ν = 0.3 (rigid-body n=0,1 zero roots omitted)
(m = nodal diameters, s = nodal circles; values agree with the commonly tabulated Leissa values I recall — 5.358, 9.003, 12.439, 20.475, 21.835 for the first five — but I could not fetch Leissa's table to verify; the characteristic-equation code reproduces them.)
| (diam m, circles s) | λ² (ν=0.3) | f ratio to (2,0) |
|---|---|---|
| (2,0) | 5.358 | 1.000 |
| (0,1) | 9.003 | 1.680 |
| (3,0) | 12.439 | 2.322 |
| (1,1) | 20.475 | 3.821 |
| (4,0) | 21.835 | 4.075 |
| (5,0) | 33.495 | 6.251 |
| (2,1) | 35.26 | 6.581 |
| (0,2) | 38.443 | 7.175 |
| (3,1) | 53.008 | 9.893 |
| (1,2) | 59.812 | 11.16 |
| (2,2) | 84.366 | 15.75 |
| (0,3) | 87.75 | 16.4 |
Further roots: m=0: 156.818 (s=4); m=1: 118.957 (s=3), 197.872 (s=4); m=2: 153.306 (s=3); m=3: 111.945 (s=2), 190.692 (s=3); m=4: 73.543 (s=1), 142.431 (s=2); m=5: 96.755 (s=1), 175.735 (s=2).
Same table at ν = 0.33 (more relevant for aluminum): (2,0) 5.262, (0,1) 9.069, (3,0) 12.244, (1,1) 20.513, (4,0) 21.527, (5,0) 33.062, (2,1) 35.243, (0,2) 38.507, (3,1) 52.921, (1,2) 59.859. **[COMPUTED]**
Computed asymptotics: for fixed m, successive roots in k = √λ² are spaced approximately π (e.g. m=0: k = 3.00, 6.20, 9.37, 12.52), so λ² → (π/2)²(m+2s+c)² — i.e. Chladni's law with C → π²/4 = 2.467 and p = 2 asymptotically. **[COMPUTED/DERIVED]**

### Chladni's law fits to the computed table (ν=0.3, 11 modes) **[COMPUTED]**
- Pure (m+2n)^p form: λ² ≈ 1.114 (m+2n)^2.388 (exponent > 2 at low order, rough fit).
- Perrin form C(m+bn)^p: λ² ≈ 1.147 (m + 2.636 n)^2.165.
- So at low mode order a fixed integer b=2, p=2 only reproduces frequencies to tens of percent (e.g., (0,1): index 2 predicts same λ² as (2,0)=5.358 vs true 9.003). Use the exact Bessel/characteristic-equation values for implementations; use (m+2n)² only for qualitative ordering.

### Square plate: Ritz-computed free-edge eigenvalues **[COMPUTED]**
Method: Ritz with free-free Euler–Bernoulli beam modes (cos k cosh k = 1) as basis, N=14 per direction, ν = 0.3, λ² = ω a²√(ρh/D) with a = SIDE length. Eigenvalues (excluding 3 rigid-body zeros): 13.474, 19.670, 24.335, 34.897 (×2, degenerate pair), 61.281 (×2), 63.799, 69.587, 77.442, 105.708. These agree with the standard published free-square-plate values to within ~0.5% as I recall them (≈13.47, 19.60, 24.27, 34.80 ×2) but I could not verify against Leissa's tables here.
Absolute test case from the cited Dalessi plate: side 0.24 m, D²=1.936 → √(D/ρh)=1.391 m²/s: f = λ² · 1.391/(2π · 0.24²) = λ² × 3.843 Hz → (2,0)-(0,2) lowest mode 13.474 → 51.8 Hz; ring mode 19.67 → 75.6 Hz; 24.335 → 93.5 Hz; 34.897 → 134.1 Hz. [COMPUTED using the Dalessi constants; real plates differ with clamping at the center drive/mass loading.] Observed resonances 190/340/490/800/955 Hz in that paper's plate correspond to λ² = 49.4, 88.4, 127, 208, 248 under this scaling; the first matches a computed Ritz level near 49 only approximately (not computed in detail) — do not rely.
Bristol report Ritz values for a free square plate with ν=0.225 (λ = ρ_s d ω² a⁴/D, a = half-side, N=48): SS mode 2 = 25.9900, SA=AS mode 2 = 80.9341, AA mode 2 = 321.0 (320.969), SS mode 3 = 35.6495, SA/AS mode 3 = 235.500, AA mode 3 = 375.420 (listed by symmetry class; "mode 1" values include the rigid-body zero). — [Bristol report](https://people.maths.bris.ac.uk/~marp/abstracts/free-edge.pdf). (Convert: λ_report = (λ²_Leissa-style with side 2a)² /16 → compare: 25.99 ⇒ λ²_side = 4·√25.99 = 20.4 for ν=0.225 vs 19.67 at ν=0.3: plausible, ν-dependence ~ few %.)

### Inferences
- Frequency→pattern for a plate: pick all modes with ω_n near the drive; use f ∝ k² to convert: k = sqrt(2πf)/(D/ρh)^{1/4}. Pattern complexity (number of nodal lines) grows like √f (k ∝ √f), whereas for a membrane it grows ∝ f. So plate patterns get complex more slowly with frequency than membrane patterns.
- (m+2n)^p with p≈2 is the plate scaling f ∝ k² in disguise: the number of half-wavelengths along a radius is ≈ m·(1/2)+n... so k ∝ (m+2n).

### Gaps
- Could not fetch Leissa "Vibration of Plates" tables or Rayleigh's *Theory of Sound* text; circular/square plate eigenvalues are my own computations (self-consistent with known first values).
- Wikipedia's Chladni's-law formula image did not survive extraction; formula taken from Dalessi/ASA abstract instead.
- Exact C, p values for flat circular plates not found in a primary source (only "p ≈ 2").

---

## 3. Square-plate patterns: cos–cos combinations, + vs −, degenerate mixing

### Takeaway
Approximate free-square-plate patterns: ψ± = cos(nπx/L)cos(mπy/L) ± cos(mπx/L)cos(nπy/L) on |x|,|y| ≤ L. Plus-combination is symmetric under x↔y and is nonzero at the plate center, so it couples to a center driver; minus-combination vanishes at the origin and on the diagonals and is not excited by a central point drive. This is an idealized model (zero-slope edge), not the true Kirchhoff free-edge mode; use for plausible-looking patterns, not accurate frequencies.

### Cited Findings
- Free-edge model with ∂ψ/∂n = 0: eigenmodes ψ = A cos(n_xπx/L) cos(n_yπy/L) cos ωt, ω² ∝ (n_x² + n_y²); for n_x ≠ n_y modes (n_x,n_y) and (n_y,n_x) are degenerate; ψ⁻ = cos(n_xπx/L)cos(n_yπy/L) − cos(n_yπx/L)cos(n_xπy/L) vanishes at the origin; ψ⁺ (with +) is the one that couples to a center driver; modes with sin((n+½)πx/L) vanish at the origin and are not excited. — [LibreTexts, Physics of Waves (Georgi) 11.3 Chladni plates](https://phys.libretexts.org/Bookshelves/Waves_and_Acoustics/The_Physics_of_Waves_(Goergi)/11%3A_Two_and_Three_Dimensions/11.03%3A_Chladni_Plates)
  - ψ⁺(1,0) = cos(πx/L)+cos(πy/L): nodes at y = ±L ± x (diagonals).
  - ψ⁺(1,1) = 2cos(πx/L)cos(πy/L): nodes at x = ±L/2 or y = ±L/2.
  - ψ⁺(2,0) = cos(2πx/L)+cos(2πy/L): nodes y = ±L/2 ± x or y = ±3L/2 ± x.
  - ψ⁺(2,1): with c_x=cos(πx/L), c_y=cos(πy/L): nodal set (c_x+c_y)(2c_xc_y − 1)=0.
  - ψ⁺(3,1): nodal set c_x c_y (4c_x²+4c_y²−6)=0 (the source's intermediate line had a typo; the extracted final form is as given).
- The plate (biharmonic) version with basis cos(mπx)cos(nπy) on [−1,1]²: ω_mn = π²(m²+n²) (dimensionless), vs membrane ω_mn = (πc/a)√(m²+n²); degenerate pair cos(2πx/a)cos(πy/a) and cos(πx/a)cos(2πy/a) at ω₁₂=ω₂₁ = 5π² (plate); symmetric forcing (point drive at center) gives C = D, so nodal lines satisfy cos(2πx/a)cos(πy/a) + cos(πx/a)cos(2πy/a) = 0; initial condition used for tests: U₀ = cos(πx)cos(2πy)+cos(2πx)cos(πy). — [Dalessi et al. 2021](https://www.math.uwaterloo.ca/~sdalessi/SN-AppliedSciences2021.pdf)
- Free-plate eigenmodes split into four symmetry classes (SS, SA, AS, AA) under x and y reflection; modes from different classes are orthogonal; the Ritz approach uses free-free beam modes. — [Bristol report](https://people.maths.bris.ac.uk/~marp/abstracts/free-edge.pdf)
- Wheatstone (1833) notes some modes never produce straight lines (nodal lines can curve); Chladni notation "3|0" counts nodal lines per direction. — [Net Advance of Physics RETRO, Wheatstone excerpt](https://web.mit.edu/redingtn/www/netadv/SP20140804.html)

### Formulas for implementation
- Pattern(x,y) = cos(nπx/L)cos(mπy/L) ± cos(mπx/L)cos(nπy/L), x,y ∈ [−L,L]; sand density ~ exp(−(ψ/ψ₀)²) or ∝ 1/(ε+|ψ|).
- Symmetries: ψ⁺ is symmetric under x↔y (and has dihedral-D4 symmetry in general); ψ⁻ is antisymmetric under x↔y, so ψ⁻ = 0 on x = ±y [DERIVED]. Use + when the drive is at the plate center (or any point where ψ⁺≠0); use − when exciting off-center or off-diagonal (a driver on the diagonal still gets zero from ψ⁻ — move it off-diagonal) [DERIVED/inference].
- General degenerate superposition at drive position r_d: modal weights ∝ φ_a(r_d) (§5). For two-fold degenerate pair (φ_a, φ_b), the excited combination is aφ_a + bφ_b with (a,b) = (φ_a(r_d), φ_b(r_d)) (up to common factor). For cos–cos pair at center: φ_a(0)=φ_b(0)=1 → "+" combination. Off-center drive at (x_d,y_d) gives a·ψ_a + b·ψ_b with a = cos(nπx_d/L)cos(mπy_d/L), b = cos(mπx_d/L)cos(nπy_d/L) [DERIVED].
- Dimensional frequency model (ideal cos–cos): ω = sqrt(D/ρh)·(π/L)²(n²+m²) with plate side 2L [DERIVED from ω = k²√(D/ρh), k² = (π/L)²(n²+m²)]. The true free-plate frequencies (Ritz table above) are not exactly proportional to n²+m²; for instance, true free square plate (2,0)/(0,2) pair splits (13.47 and 24.34 in λ²) while the cos–cos model has them degenerate. Use Ritz λ² table for frequency selection if accuracy matters.
- Degeneracy lifted in reality: nominally degenerate modes in a real (not perfectly symmetric) plate split slightly; with Q ~ 10² the two peaks can overlap and the observed pattern is a mixture whose weights depend on drive position — Dalessi: "all modes are excited, but modes sharing a frequency dominate over time" for the forced case. — [Dalessi et al. 2021](https://link.springer.com/article/10.1007/s42452-020-04062-6)

### Inferences
- The cos–cos ± family reproduces the visual vocabulary of classic Chladni figures (diagonals for (1,0)+, grid for (1,1), curved "X/diamond" figures for (2,1)+, (3,1)+), which is why it is the standard cheap generator.
- It satisfies zero-slope edges but not free-edge moment/shear conditions, so patterns can differ from real plates near the boundary and corners. Real nodal lines curve (Wheatstone).

### Gaps
- No source found giving a formal "Ritz/approximate form" justification of ± for the TRUE free-edge plate (e.g., Rayleigh's *Theory of Sound* §§223–225 / Ritz 1909 on Chladni figures); statement of that lineage is [RECALLED] only. I did not find the original text.

---

## 4. Spherical cymatics

### Takeaway
Standing waves of a scalar wave equation on a sphere are spherical harmonics Y_l^m (degree l, order m), eigenvalue of the Laplace–Beltrami operator −l(l+1)/R², giving f ∝ sqrt(l(l+1)) (≈ l for large l) with (2l+1)-fold degeneracy. Real elastic spherical shells/membranes have different formulas, and a pressurized/tensioned membrane gives f ∝ sqrt(l(l+1) − 2); capillary drops give Rayleigh's ω² ∝ l(l−1)(l+2).

### Cited Findings
- Spherical harmonics of degree ℓ are eigenfunctions of the Laplace–Beltrami operator; on the 2-sphere the eigenvalue is −ℓ(ℓ+1); for each ℓ there are 2ℓ+1 independent solutions (m = −ℓ..ℓ); nodal lines of Y_ℓ^m consist of ℓ circles in total: |m| meridian (longitude) circles and ℓ−|m| latitude circles; real harmonics are "cosine type" (m>0) and "sine type" (m<0). Y₀⁰ = 1/√(4π) by orthonormality (derived by the extractor, not quoted). — [Wikipedia: Spherical harmonics](https://en.wikipedia.org/wiki/Spherical_harmonics)
- Rayleigh drop oscillation: ω² = (σ/ρ) ℓ(ℓ−1)(ℓ+2)/R³ (σ surface tension, ρ density, R radius, ℓ spherical-harmonic degree), attributed to Rayleigh (1879)/Lamb (1932); frequency depends only on ℓ and modes with m≠0 are non-axisymmetric but degenerate with m=0. — [ar5iv 1905.05844](https://ar5iv.arxiv.org/html/1905.05844)
- Thin spherical shells: each degree n has two distinct frequencies (a "lower branch" bending-influenced approaching a finite limit and an "upper branch" extensional increasing without limit); mode shapes in Legendre polynomials of degree n; membrane theory only accurate for very thin shells and low n; breathing mode (n=0) is purely radial. — [Abaqus Benchmarks Manual, spherical shell free vibration](https://ceae-server.colorado.edu/v2016/books/bmk/ch01s04ach37.html)
- Thin-shell free vibration of a full sphere/holed spheres by energy method (E=190 GPa, ν=0.3, ρ=8000 kg/m³, R/h=100): paper gives dimensionless frequencies for sphere with holes but no closed form in n. — [Free Vibration Characteristics of Thin Spherical Shells](https://cot.unhas.ac.id/journals/index.php/epiije/article/download/1372/998)
- Non-symmetric thin-shell hemisphere analysis reduces to a sixth-order system solved by associated Legendre functions; Poisson ratio enters Legendre degree via a "(3/2)² + ν-term"; inextensional frequencies are very low and scale with thickness/radius. — [Ross, Natick Labs TR 67-74-OSD (DTIC AD0651475)](https://apps.dtic.mil/sti/pdfs/AD0651475.pdf)

### Formulas for implementation
- Scalar/Helmholtz sphere ("spherical drumhead" in curved 2D): ∇_S² Y_l^m = −l(l+1) Y_l^m; ω_l = (c/R) sqrt(l(l+1)) **[DERIVED from the cited eigenvalue]**. Tabulate: sqrt(l(l+1)) for l=0..5 = 0, 1.4142, 2.4495, 3.4641, 4.4721, 5.4772. Frequency spacing ≈ c/R for large l (equally spaced), unlike the Bessel-zero spacing in a flat disk. **[COMPUTED]**
- Tensioned (inflated) spherical membrane, radial displacement w, restoring term from curvature change: σ w_tt = T(∇_S² w + 2w/R²) ⇒ ω² = (T/(σR²)) (l(l+1) − 2): l=1 gives ω=0 (rigid translation — physically required), l=2 gives ω = 2√(T/σ)/R... this form is **[DERIVED by me, not from a fetched source]**; l(l+1)−2 = (l−1)(l+2) — compare Rayleigh's l(l−1)(l+2) for drops which carries an extra factor l from fluid inertia. Values sqrt(l(l+1)−2): 0, 0, 2.0000, 3.1623, 4.2426, 5.2915 for l=0..5 (l=0 negative: breathing handled separately). **[COMPUTED]**
- Thin elastic shell (Kirchhoff–Love): at fixed degree l there are two branches (see Abaqus Benchmarks); the low branch for l ≥ 2 is bending-dominated with ω ∝ (h/R)·(...)—the exact quadratic membrane-theory frequency equation was not retrievable from sources; I did not reproduce it from memory. For an implementation, use f_l ∝ sqrt(l(l+1)) (scalar sphere) or (l−1)(l+2) form (tensioned membrane) as a model; label as a model, not a physical thin shell.
- Nodal geometry for display: Y_l^m real parts: cos(mφ) P_l^m(cos θ) and sin(mφ) P_l^m(cos θ); P_l^m(cosθ) has l−|m| zeros in θ ∈ (0,π) (latitude circles), cos(mφ) has |m| nodal meridian half-planes → 2|m| half-meridians forming |m| great circles. For a sphere driven at a point (north pole), only m=0 (zonal) couples — drive position selects the combination exactly as for plates (weight ∝ Y_l^m(r_d)). [DERIVED]

### Inferences
- "f ∝ sqrt(l(l+1))" in the user's prompt is exactly the scalar-wave-on-sphere result (cited eigenvalue + c/R) and is the right model for a "spherical membrane/shell" in a visual simulator. The 2l+1 degeneracy means any rotated nodal pattern is valid at one frequency; pick m by drive position.
- True shell/drop physics differ in the offset (l−1)(l+2) and in extra branches.

### Gaps
- No fetched source gives the thin-spherical-shell membrane-theory frequency formula in closed form (extractions were garbled/missing); no primary source (e.g., Lamb 1882, Love, Rayleigh *Theory of Sound* vol. II ch. on spheres, Soedel) was retrieved.
- No fetched experimental "Chladni figures on a sphere" source found.

---

## 5. Driven response: damped resonance superposition, Q, off-resonance patterns

### Takeaway
A driven damped plate/membrane responds as a modal sum Σ e_n(ω_d) φ_n(x,y) with Lorentzian weights e_n ∝ ⟨φ_n, F⟩ / (ω_n² − ω_d² + iγ_nω_d). The amplitude weight is 1/sqrt((ω_n²−ω_d²)² + γ_n²ω_d²), peaking at ω_d ≈ ω_n with half-power width Δω ≈ γ_n; Q ≈ ω_n/γ_n. Between resonances the pattern is a mixture dominated by the nearest mode(s), with weights falling as 1/|ω_n²−ω_d²| away from peaks.

### Cited Findings
- Modal superposition: Z(x,y,ω_d) = Σ_mn Z_mn(x,y) e_mn(ω_d), modal weight (experimental) |e_mn|² = |∫ Z_mn* Z dA|²; for a driven plate: e_mn(ω_d) = [∫_A Z_mn(x,y) F_ac(x,y) dA] / [ω_mn² − ω_d² + i γ_mn ω_d], γ_mn = phenomenological damping, F_ac spatial amplitude of the AC driving force; Q-factors were used to set γ (their listed γ and Q values suggest Q ≈ f/γ, but the paper does not state this relation explicitly). — [Observing off-resonance motion of nanomechanical resonators as modal superposition, arXiv 2008.02040](https://arxiv.org/pdf/2008.02040)
- Dalessi et al.: forced response with point drive Q = δ(x)δ(y)cos(ω₀t) excites all modes, modes sharing a frequency dominate; beat phenomena arise between drive and eigen-frequencies, with T_long = 2π/[½|ω₀−ω_mn|]. — [Dalessi et al. 2021](https://link.springer.com/article/10.1007/s42452-020-04062-6)
- Tuan et al. (EPL 2015): modern Chladni figures form at resonant frequencies and classical figures at non-resonant frequencies; the plate–driver system is modeled by an inhomogeneous Kirchhoff–Love equation with the driver as a point scatterer; the resulting resonance-frequency formula is identical to a meromorphic function from singular billiards; modern figures show avoided crossings of nodal lines, classical figures a regular grid of nodal lines; strong coupling between plate and driver drives the formation of the modern figures. — [Tuan et al., EPL 111, 64004 (2015) abstract](https://epljournal.edpsciences.org/10.1209/0295-5075/111/64004)
- Another paper fitting nodal lines to modern-driver patterns uses a response function F_R(θ,r) = A cos(Nθ) + C (N = number of sides) and shows deviations from ideal eigenmodes due to geometry and mode mixing at higher frequencies. — [PMC10969725 (Symmetry 2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10969725/)

### Formulas (standard single-DOF modal oscillator; consistent with the cited e_mn form; Q relation [DERIVED])
- Per-mode equation: q̈_n + γ_n q̇_n + ω_n² q_n = (⟨φ_n, F⟩/M_n) cos(ω_d t); with φ_n orthonormal (M_n=1).
- Complex modal coefficient: q_n = ⟨φ_n,F⟩ / (ω_n² − ω_d² + i γ_n ω_d) (matches cited Eq. 6, time convention e^{+iωt} sign aside).
- Amplitude weight: |q_n| = |⟨φ_n,F⟩| / sqrt[(ω_n² − ω_d²)² + γ_n² ω_d²]. Phase: arg(q_n) = −atan2(γ_nω_d, ω_n²−ω_d²): ≈0 for ω_d ≪ ω_n, −π/2 at resonance, → −π for ω_d ≫ ω_n.
- For a point drive at r_d: ⟨φ_n,F⟩ = φ_n(r_d)·F₀.
- Quality factor: Q_n = ω_n/γ_n, FWHM of |q|² ≈ γ_n = ω_n/Q_n (valid Q ≫ 1). Normalized amplitude about resonance: A(ω_d)/A_peak ≈ 1/sqrt(1 + 4Q²(ω_d−ω_n)²/ω_n²), the Lorentzian; peak amplitude relative to static response = Q.
- Worked test: two modes at 1000 and 1100 Hz, Q=50 each, equal overlaps, drive 1050 Hz: normalized weights 1/sqrt((1−(f/fn)²)²+(f/(Q fn))²) → 9.558 (1000 Hz mode) and 11.005 (1100 Hz mode); on-resonance peak = Q = 50. So at the midpoint both modes contribute almost equally (ratio 0.87) with ~5x smaller amplitude than on resonance. **[COMPUTED]**
- Pattern for display: w(x,y) = Re[ Σ_n q_n φ_n(x,y) ] (instantaneous) or the sand-relevant magnitude. Because adjacent modes' phases differ by up to π across resonances, using only real-valued amplitudes |q_n| with sign(Re q_n) (quasi-static weights) is a reasonable approximation off resonance; at resonance the dominant mode has phase −π/2 and everything else is nearly in phase quadrature-free → pattern ≈ φ_n alone. Inference, not cited.
- Practical Q values: not found for a given plate (see Gaps); the nanomechanical drums in the cited arXiv paper had Q ≈ 18–26. Typical thin metal Chladni plates have Q of order 10²–10³ in air [RECALLED, unverified]; the drive-frequency window over which a single mode dominates is ≈ ±ω_n/(2Q).

### Inferences
- Implementation recipe: (1) enumerate modes (ω_n, φ_n) (membrane: Bessel; plate: Ritz or cos–cos; sphere: Y_l^m); (2) set Q (or γ) per mode; (3) pick drive point r_d and compute weights ∝ φ_n(r_d)/sqrt(...); (4) sum, then render nodal set |w|≈0. Choosing a modest Q (≈30–100) gives smooth morphing between patterns as frequency is swept; a high Q gives near-pure modes only within narrow windows.
- Tuan's result implies a driver at a point shifts resonances from the free-plate values and creates avoided crossings — a pure free-plate eigenmode model will be off by a few percent, with the shift larger when the driver is heavy/stiff.
- "Classical" figures (grid of straight lines) at non-resonant frequencies correspond to forced response dominated by the nonresonant sum (many modes) — the Tuan classification maps onto the weights above.

### Gaps
- No source found with measured Q for typical Chladni plates, or an explicit Q ↔ γ definition for plates (only the nanomechanical drum paper using Q to set γ).
- Tuan et al.'s explicit resonance equation not retrievable (abstract only).

---

## 6. Why sand collects at nodal lines; experimental evidence

### Takeaway
Coarse grains driven by vertical plate accelerations larger than g are kicked off antinodes and randomly walk until they come to rest on nearly motionless nodal lines (equilibrium/maximum-entropy accumulation); this is the standard Chladni observation (1787) and also what Hooke saw (1680). Caveats: very fine powder can collect at antinodes (air streaming, Faraday), and at accelerations below g grains go to antinodes even without air (van Gerner et al., 2010).

### Cited Findings
- Chladni published *Entdeckungen über die Theorie des Klanges* in 1787 (11 plates, 166 figures); *Die Akustik* (1802); Hooke's earlier sand/flour-on-bell experiment dated July 8, 1680 per APS (Chladni likely unaware). — [APS News, This Month in Physics History (2017)](https://www.aps.org/apsnews/2017/07/first-experiments-chladni-figures)
- Wheatstone, "On the Figures obtained by strewing Sand on Vibrating Surfaces," Phil. Trans. 123, 593 (1833), summarizing Chladni's notation and the sound-pitch table for square plates; Galileo noticed bristles on a sounding board move on some parts and not others; Hooke proposed flour on a vibrating bell. — [Net Advance of Physics RETRO](https://web.mit.edu/redingtn/www/netadv/SP20140804.html)
- Savart's 1830 experiment, building on Chladni's method: a horizontal plate dusted with powder, driven by a sinusoidal pressure force, at resonance bounces the powder into the non-vibrating nodal areas — the Chladni lines/pattern. — [arXiv 1805.05460](https://arxiv.org/pdf/1805.05460)
- "The nodal points, where the sand collects, correspond to the points of zero displacement," described as equilibrium/maximum-entropy states. — [PMC10969725](https://pmc.ncbi.nlm.nih.gov/articles/PMC10969725/)
- "Sand settles on nodal lines, the stationary regions of the plate. Fine particles can collect at antinodes forming 'inverse patterns'; air currents cause this in ordinary conditions. Gerner et al. found that when plate acceleration stays below g, particles roll to antinodes regardless of size, even without air." — [Dalessi et al. 2021](https://www.math.uwaterloo.ca/~sdalessi/SN-AppliedSciences2021.pdf)
- Chladni found that very thin powder collected at antinodal regions (heaping near nodes explained historically by acoustic streaming); Faraday showed by evacuation that the antinode accumulation is due to air permeating the moving grains; the free-fall terminal velocity v_t = ν q d²/(18μ) (their notation) matters when comparable to plate velocity, for 10–20 μm particles on a plate at 50 Hz with acceleration amplitude g; Pak et al. (1995) found heaping disappears as ambient gas pressure → 0 or as particle size increases; standing-wave patterns in granular layers appear for Γ = 4π²Af²/g above ≈2.4 (flat layer below). — [Aranson & Tsimring, Patterns and collective behavior in granular media (arXiv cond-mat/0507419)](https://arxiv.org/pdf/cond-mat/0507419)
- van Gerner, van der Hoef, van der Meer, van der Weele, "Inversion of Chladni patterns by tuning the vibrational acceleration," Phys. Rev. E 82, 012301 (2010): challenges the view that inverse patterns need air; argue theoretically and numerically that for plate acceleration below g, particles go to the antinodes regardless of size, even without air. — [PRE abstract](https://link.aps.org/doi/10.1103/PhysRevE.82.012301)
- Tuan et al. (2015): measured the resonant spectrum to separate modern (resonant) from classical (non-resonant) figures. — [EPL abstract](https://epljournal.edpsciences.org/10.1209/0295-5075/111/64004)

### Formulas for rendering / simulation (physics-consistent)
- Plate vertical acceleration amplitude at point r: a(r) = ω²|w(r)|; grains are hopped when a ≳ g, i.e. |w| ≳ g/ω². Sand collects where |w| (hence a) is below this threshold → nodal lines. Γ = a/g (Γ = 4π²f²A/g with A = displacement amplitude). Thus sand density map: bright where |w(x,y)| < w_c = g/ω² (at moderate Γ) or ∝ exp(−|w|²/2σ²). [DERIVED from cited Γ criterion]
- For Γ < 1 (very gentle drive) or very fine powder (air-dominated) the pattern inverts (antinodes) — implement as an optional "inverse" toggle.

### Inferences
- The nodal-line rule is robust for the "standard" demonstration (grains ~100 μm, Γ ≳ 1); the physical selection of nodal sets is exactly the zero set of the dominant (or summed) mode, justifying the "draw zeros of Σ q_nφ_n" implementation.

### Gaps
- Waller's classic Chladni-figure studies (Mary D. Waller, *Chladni Figures: A Study in Symmetry*, 1961) and Rayleigh's *Theory of Sound* treatment were not retrieved by search/fetch; I report no verified claims about them. Searches for Waller returned unrelated results (an 1833 Wheatstone article, a Bridges paper "Chladni Figures Revisited: A Peek Into The Third Dimension" listed but not fetched).
- Chladni's own sand-vs-fine-powder claim is only reported second-hand (Aranson & Tsimring review).
- No direct fetch of Faraday's 1831 Phil. Trans. paper on vibrating surfaces.

---

## Implementation checklist (compact)
1. Membrane (disk): modes (m,n) with j_{m,n} table; f = j c/(2πR); u = J_m(j r/R)cos(mθ+φ); nodal circles r_i/R = j_{m,i}/j_{m,n}; check: f_{0,1}(R=0.1,c=100) = 382.74 Hz.
2. Free circular plate: f = λ²/(2πR²)·√(D/ρh), λ² from Leissa table above (ν=0.3: 5.358, 9.003, 12.439, 20.475, 21.835, 33.495, 35.26, 38.443, ...) with w = A J_m(kr)+B I_m(kr), k=√λ²/R; B/A from free-edge conditions (code root-find). Use A/B = −[ M-condition ratio ] — compute from the 2×2 determinant. Dispersion f ∝ k².
3. Free square plate: Ritz λ² (side L): 13.474, 19.670, 24.335, 34.897×2, 61.281×2,... (ν=0.3); f = λ² √(D/ρh)/(2π L²). Visual approximation: cos–cos ± combos; + for center drive.
4. Sphere: f_l = (c/2πR)√(l(l+1)); modes Y_l^m, degeneracy 2l+1; nodal lines: l circles total.
5. Driven response: weights φ_n(r_d)/√((ω_n²−ω²)²+(γ_nω)²), Q=ω_n/γ_n; sum modes.
6. Sand: collect where |w| small (nodal set), inverse pattern for Γ<1 or fine powder.

## Files / reproducibility
Scripts used for computed numbers (not saved to research_notes): /tmp/claude-0/-home-claude/ed44008e-1b6a-5db0-a0ea-85f304d885f7/scratchpad/circ.py (free circular plate root finder, run with ν as argument) and /tmp/claude-0/-home-claude/ed44008e-1b6a-5db0-a0ea-85f304d885f7/scratchpad/sq.py (free square plate Ritz).
