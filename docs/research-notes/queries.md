# Queries and the inverse problem

Phase 5 lets a person or an agent ask a city questions and ask the engine for a city. This note records the choices and their limits.

## The query layer

**Shape.** A query is a small relational expression over one collection: `from`, `where` (conjunctive filters), an optional failure scenario `fail: {kind, index}`, `groupBy` with aggregates (`count`, `sum:f`, `mean:f`, `min:f`, `max:f`), `orderBy` (several keys), `limit` and `fields`. The scope is deliberately less than SQL (no joins, no disjunction, no subqueries). Every collection is already denormalised for the questions people ask: a district row carries its residents, a building row its district, so a join is never needed for the questions in the roadmap, and a smaller language is easier for an agent to produce correctly and for a person to read back.

**Models on demand.** A field is tagged with the model it needs (`infra`, `people`, `fail`), and `cityOf` builds those models lazily, once. A question about heights costs nothing; a question about traffic runs the commute model once and reuses it. The page passes the commute it has already run (`adoptPeople`) so a question never silently re-runs a model with different settings.

**Failure as a scenario, not a collection.** "Which districts lose water if tank 3 fails?" is the same districts query with a scenario attached. `fail` calls `impact()` from the simulation module, so the query answers are by construction the failure model's answers, and the test checks them against `impact()` directly.

**Numbering.** Structured queries are 0-based (they are data). The page and the English parser count from 1 (they are speech): "tank 3" is index 2. An index the city does not have is refused with the count it does have, never answered with zero.

**Precision and missing values.** Filters, groups and orderings use full-precision values; the answer rounds them (four significant figures below 1, three decimals above). A rounded comparison would drop a building of 0.38114 amplitude from `amp > 0.3811`. A missing value (a building with no chord voice, no service lateral) satisfies no ordering, equals only null, sorts last and aggregates to null, so `era < 1` on a single-frequency city matches nothing rather than everything.

## The English parser

A template parser, not a language model. It recognises a fixed set of question shapes (failure of a named asset, counts with a threshold, superlatives, a district's population, inventory counts, the busiest street, a station suggestion) and turns each into a structured query that it shows alongside the answer. Anything else is refused with the examples. The reasons:

- Deterministic and offline: the page has no model and no network.
- Auditable: every answer shows the query that produced it, so a misreading is visible rather than a confident wrong answer.
- Agents do not need it: they get the structured query as a tool.

Asset words are read with the service the question names: "plant" is the power plant in a question about power, the water treatment plant in one about water; a bare "plant" with no service is asked about rather than guessed. Ordinals and number words up to twelve are read ("the 2nd substation", "substation two").

The cost is coverage. Paraphrases outside the templates fail; that is the intended failure mode.

## Where a new metro station would pay off

The suggestion is a coverage gain: residents plus jobs at street nodes that are not within the 1.2 km catchment of any station now and would be within 1.2 km of the candidate, by straight-line distance (the walk-to-station radius used by the commute model). Candidates are street nodes (thinned to about 1,500) at least the transit minimum spacing (700 m) from existing stations and from each other; a site need not carry demand itself. Picks are greedy, each recomputed after the previous pick is placed. The tunnel is the street distance to the nearest station or earlier pick. This is the classic maximal-covering location problem (Church & ReVelle 1974) solved greedily, which is within (1 − 1/e) of optimal for a coverage objective; it ignores ridership elasticity and the line's shape.

## The inverse problem

"Find a frequency whose city has 12 radial boulevards, a central plaza and fewer than 30 lift stations." Generating a city costs between a tenth of a second and several seconds, so the search spends its budget in stages:

1. **Physics scan (free).** Hundreds of frequencies (log-spaced with seeded jitter; Q and drive point drawn from their ranges when varied) are run through the driven response alone. Physics constraints (sharpness, nodal diameters and circles, radial boulevards) prune here. Frequencies that excite the same dominant mode give nearly the same street plan, so the pool keeps one representative per mode, the sharpest.
2. **Staged evaluation.** Representatives are built sharpest first: the plan, then the networks, then the commute, only as deep as the constraints and objective need, and a candidate that already violates a stage's constraints is not taken to the next stage.
3. **Refinement.** 30 % of the budget nudges the closest misses (frequency ±3 % and Q ×1.5^±1, both held inside the ranges the caller gave) to cross a threshold the first pass narrowly missed.
4. **Ranking.** Feasible plans by the objective (or sharpness), one per distinct pattern first, then near-misses ranked by total normalised violation, so the person sees how close the engine came when nothing fits.

Every returned candidate is a profile; regenerating it reproduces the metrics, and the test does exactly that. The search is deterministic for a seed and never builds more cities than the budget; a city that fails to build still spends one, and a search in which every build fails reports why. Malformed constraints are refused up front (`between` without an upper bound, a yes/no metric compared with `>`, a nodal count on a plate that has none).

**Why not a gradient method or a GA.** The metrics are step functions of frequency (the dominant mode changes discretely and with it the whole plan), so gradients are zero almost everywhere. A genetic algorithm would spend most of its budget rediscovering the same handful of modes. Enumerating the modes through the cheap physics step and building each distinct one is the honest search for this landscape.

**Limits.** Near-misses are ranked by the violation of the stages they reached, since a candidate that fails the plan is not taken on to the networks. Cost: a 16-city search on the full city preset takes about a minute; the page runs it in its own worker so it can be stopped. Chords are not searched (the space of two and three voices is large, and a chord's plan is mostly its loudest voice's). One representative per mode can miss a non-representative frequency of the same mode whose Q or drive point makes a plan-level threshold; refinement recovers some of these. `centralPlaza` means no building within max(2 lots, 3 % of the plate) of the centre on plane plates.

## Agent tools

`agentTools()` returns five tools with JSON-schema inputs (`generate_city`, `query_city`, `ask_city`, `suggest_metro_station`, `search_plans`) and a `run(input, state)` per tool, where `state.city` carries the current city between calls. The schemas list the collections, fields, operators and metrics from the same tables the engine uses, so they cannot drift. Outputs are plain JSON.

## Sources

- Church, R. & ReVelle, C. (1974). The maximal covering location problem. *Papers of the Regional Science Association* 32, 101–118.
- Nemhauser, G., Wolsey, L. & Fisher, M. (1978). An analysis of approximations for maximizing submodular set functions. *Mathematical Programming* 14, 265–294 (the 1 − 1/e bound for greedy coverage).
- Codd, E. F. (1970). A relational model of data for large shared data banks. *CACM* 13(6) (selection, projection, grouping).
