"""Bud och syn: lönar det sig att syna alltid? Monte Carlo, antaganden står i koden."""
import numpy as np

rng = np.random.default_rng(7)
N = 400_000
mu = rng.uniform(8, 16, N)               # lagets sanna medelprestation (antal)
perf = rng.normal(mu, 0.20 * mu)         # utfall i ronden, spridning 20 % av medel
own = mu * (1 + rng.normal(0, 0.10, N))  # lagets egen bild av sin förmåga, brus 10 %
obs = mu * (1 + rng.normal(0, 0.15, N))  # motståndarnas bild av laget, brus 15 %

print("A. Fast budkvot (bud = kvot x egen bild)")
print("kvot  klarar  poäng/rond   netto per syn vid straff 0 / 2 / 3")
for k in (0.7, 0.8, 0.9, 1.0, 1.1, 1.2):
    bid = np.maximum(1, np.round(k * own))
    ok = perf >= bid
    pts = np.where(ok, bid, 0).mean()
    ev = [np.where(ok, -p, bid / 2).mean() for p in (0, 2, 3)]
    print(f"{k:4.1f}   {ok.mean():4.2f}    {pts:5.2f}       {ev[0]:5.2f}  {ev[1]:5.2f}  {ev[2]:5.2f}")

print()
print("B. Blandad grupp: budkvot ~ N(0.95, 0.12), dvs många budar nära sitt medel")
k = rng.normal(0.95, 0.12, N)
bid = np.maximum(1, np.round(k * own))
ok = perf >= bid
print(f"andel klarade bud: {ok.mean():.2f}")
print("strategi                    andel synade   netto per rond vid straff 0 / 2 / 3")
for name, sel in (("syna alltid", np.ones(N, bool)),
                  ("syna om bud > 0.9 x min bild", bid > 0.9 * obs),
                  ("syna om bud > min bild", bid > obs),
                  ("syna om bud > 1.1 x min bild", bid > 1.1 * obs),
                  ("syna aldrig", np.zeros(N, bool))):
    ev = [np.where(sel, np.where(ok, -p, bid / 2), 0).mean() for p in (0, 2, 3)]
    print(f"{name:28s}   {sel.mean():4.2f}        {ev[0]:5.2f}  {ev[1]:5.2f}  {ev[2]:5.2f}")

print()
print("C. Känslighet: hur mycket bättre är att tänka efter än att syna alltid?")
print("gruppens budkvot  straff  syna alltid  bästa tröskel  (andel synade)  skillnad")
for km in (0.85, 0.95, 1.05):
    k = rng.normal(km, 0.12, N)
    bid = np.maximum(1, np.round(k * own))
    ok = perf >= bid
    for p in (2, 3, 4):
        pay = np.where(ok, -p, bid / 2)
        alw = pay.mean()
        best = max(((np.where(bid > t * obs, pay, 0).mean(), t, (bid > t * obs).mean())
                    for t in np.arange(0.6, 1.41, 0.05)), key=lambda x: x[0])
        print(f"     {km:4.2f}          {p}       {alw:5.2f}        {best[0]:5.2f} (>{best[1]:.2f})     {best[2]:4.2f}        {best[0]-alw:+.2f}")
