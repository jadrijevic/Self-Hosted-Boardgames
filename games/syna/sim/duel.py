"""Duellpoäng: klarat bud = BASE, djärvaste klarade bud i duellen = +BONUS.
Söker jämvikt i budgivningen (fictitious play) och prövar synregeln mot den.
Antaganden: utfall ~ N(mu, sigma*mu); lagets egen bild av mu har 10 % brus,
åskådarnas bild 15 % brus; bud = kvot x egen bild, kvot ur ett rutnät."""
import numpy as np

rng = np.random.default_rng(3)
N = 120_000
ks = np.round(np.arange(0.50, 1.31, 0.05), 2)
K = len(ks)
BASE, BONUS = 3, 2


def setup(sigma, skill_b=1.0):
    mu = rng.uniform(8, 16, N)
    mu_a, mu_b = mu, mu * skill_b
    out = []
    for m in (mu_a, mu_b):
        perf = rng.normal(m, sigma * m)
        own = m * (1 + rng.normal(0, 0.10, N))
        obs = m * (1 + rng.normal(0, 0.15, N))
        bids = np.stack([np.maximum(1, np.round(k * own)) for k in ks])
        out.append((bids, perf >= bids, obs))
    return out


def matrices(a, b):
    (ba, oka, _), (bb, okb, _) = a, b
    pa = np.zeros((K, K)); pb = np.zeros((K, K))
    for i in range(K):
        for j in range(K):
            x, y, ox, oy = ba[i], bb[j], oka[i], okb[j]
            wa = (ox & (~oy | (x > y))).mean(); wb = (oy & (~ox | (y > x))).mean()
            tie = (ox & oy & (x == y)).mean()
            pa[i, j] = BASE * ox.mean() + BONUS * (wa + tie / 2)
            pb[i, j] = BASE * oy.mean() + BONUS * (wb + tie / 2)
    return pa, pb


def fict(pa, pb, iters=6000):
    ca = np.ones(K); cb = np.ones(K)
    for _ in range(iters):
        ca[np.argmax(pa @ (cb / cb.sum()))] += 1
        cb[np.argmax((ca / ca.sum()) @ pb)] += 1
    return ca / ca.sum(), cb / cb.sum()


def report(label, sigma, skill_b=1.0):
    a, b = setup(sigma, skill_b)
    pa, pb = matrices(a, b)
    xa, xb = fict(pa, pb)
    ok_a = float(xa @ a[1].mean(axis=1)); ok_b = float(xb @ b[1].mean(axis=1))
    print(f"{label:34s} budkvot A {xa @ ks:.2f} B {xb @ ks:.2f} | klarar A {ok_a:.2f} B {ok_b:.2f} | "
          f"poäng/duell A {xa @ pa @ xb:.2f} B {xa @ pb @ xb:.2f}")
    return a, xa


print(f"Duellpoäng: klarat bud {BASE}, djärvaste klarade bud +{BONUS}")
res = {}
for s in (0.10, 0.20, 0.35):
    res[s] = report(f"jämna lag, spridning {int(s*100)} %", s)
report("lag B 25 % starkare, spridning 20 %", 0.20, 1.25)

print()
print("Syn mot jämviktsbuden (spridning 20 %): netto per rond för det synande laget")
(bids, ok, obs), mix = res[0.20]
idx = rng.choice(K, size=N, p=mix)
bid = bids[idx, np.arange(N)]; okk = ok[idx, np.arange(N)]
print(f"andel missade bud: {1 - okk.mean():.2f}")
print("rätt/fel   syna alltid   bästa tröskel (andel synade)   skillnad")
for g, p in ((2, 1), (2, 2), (3, 2)):
    pay = np.where(okk, -p, g)
    alw = pay.mean()
    best = max(((np.where(bid > t * obs, pay, 0).mean(), t, (bid > t * obs).mean())
                for t in np.arange(0.6, 1.41, 0.05)), key=lambda z: z[0])
    print(f" +{g}/-{p}       {alw:5.2f}        {best[0]:5.2f} (bud > {best[1]:.2f} x bild, {best[2]:.2f})      {best[0]-alw:+.2f}")

print()
print("Jämförelse: gamla regeln 'bud = poäng', bästa budkvot, spridning 20 %")
for name, m in (("Släkten (ca 5 namn)", 5), ("Tornet (ca 12 muggar)", 12), ("Ballongen (ca 40 sekunder)", 40)):
    perf = rng.normal(m, 0.2 * m, N); own = m * (1 + rng.normal(0, 0.10, N))
    best = max(np.where(perf >= np.maximum(1, np.round(k * own)), np.maximum(1, np.round(k * own)), 0).mean() for k in ks)
    print(f"{name:28s} {best:5.1f} poäng per rond")
