"""Schemaläggare för Syna: vilka lag duellerar i vilken rond, för 2–6 lag och när ett lag hoppar av."""
from collections import Counter
from itertools import combinations, product

SORTER = ["kropp", "röst", "huvud"]
DUELLER = {2: 6, 3: 4, 4: 3, 5: 2, 6: 2}  # dueller per lag vid start


def varv(lag):
    """Cirkelmetoden för jämnt antal lag: i varje varv duellerar alla lag exakt en gång."""
    l, n, out = list(lag), len(lag), []
    for _ in range(n - 1):
        out.append([(l[i], l[n - 1 - i]) for i in range(n // 2)])
        l = [l[0], l[-1]] + l[1:-1]
    return out


def sok(behov, mott, tak, senast, seq):
    """Fyll varje lags behov av dueller; inget par oftare än tak; helst inte samma lag två ronder i rad."""
    if not any(behov.values()):
        return seq
    kvar, storst = sum(behov.values()), max(behov.values())
    if kvar % 2 or storst > kvar - storst:
        return None
    kand = [p for p in combinations(sorted(behov), 2) if behov[p[0]] and behov[p[1]] and mott[frozenset(p)] < tak]
    kand.sort(key=lambda p: ((p[0] in senast) + (p[1] in senast), -(behov[p[0]] + behov[p[1]]), mott[frozenset(p)]))
    for p in kand:
        behov[p[0]] -= 1; behov[p[1]] -= 1; mott[frozenset(p)] += 1
        r = sok(behov, mott, tak, p, seq + [p])
        behov[p[0]] += 1; behov[p[1]] += 1; mott[frozenset(p)] -= 1
        if r is not None:
            return r
    return None


def planera(behov, mott=None, senast=()):
    for tak in range(1, 9):
        r = sok(dict(behov), Counter(mott or {}), tak, senast, [])
        if r is not None:
            return r
    return None


def nytt_schema(lag):
    n, d = len(lag), DUELLER[len(lag)]
    if n == 2:
        return [tuple(lag)] * d
    if n % 2 == 0:
        return [p for v in varv(lag)[:d] for p in v]   # hela varv: sista varvet kan ge dubbla poäng
    return planera({t: d for t in lag})


def sorter(schema):
    """Sort per duell så att inget lag får samma sort oftare än nödvändigt (uttömmande sökning)."""
    def kostnad(val):
        per = Counter()
        for (a, b), s in zip(schema, val):
            per[(a, s)] += 1; per[(b, s)] += 1
        tot = Counter(val)
        return (max(per.values()), sum(v - 1 for v in per.values()), max(tot.values()) - min(tot[s] for s in SORTER))
    return min(product(SORTER, repeat=len(schema)), key=kostnad)


def avhopp(schema, efter, ut):
    """Lag 'ut' lämnar efter rond 'efter'. Planera om så att kvarvarande lag slutar på lika många dueller."""
    spelat = schema[:efter]
    kvar = sorted({t for p in schema for t in p} - {ut})
    gjort = Counter({t: 0 for t in kvar}); gjort.update(t for p in spelat for t in p if t != ut)
    mott = Counter(frozenset(p) for p in spelat if ut not in p)
    best = None
    for mal in range(max(gjort.values()), max(gjort.values()) + 4):
        behov = {t: mal - gjort[t] for t in kvar}
        if sum(behov.values()) == 0 or sum(behov.values()) % 2:
            continue
        r = planera(behov, mott, spelat[-1] if spelat else ())
        if r is not None and (best is None or abs(efter + len(r) - len(schema)) < abs(best[0] - len(schema))):
            best = (efter + len(r), mal, r)
    if best is None:
        # Går inte att jämna ut (t.ex. två lag kvar med olika antal): spela planerat antal, räkna snitt per duell.
        d = max(Counter(t for p in schema for t in p).values())
        behov = {t: max(0, d - gjort[t]) for t in kvar}
        if sum(behov.values()) % 2:
            behov[max(behov, key=behov.get)] -= 1
        r = planera(behov, mott, spelat[-1] if spelat else ()) or []
        best = (efter + len(r), None, r)
    return best


if __name__ == "__main__":
    print("Start: schema per antal lag")
    for n in range(2, 7):
        lag = list("ABCDEF"[:n])
        s = nytt_schema(lag); so = sorter(s)
        antal = Counter(t for p in s for t in p)
        assert len(set(antal.values())) == 1, "olika antal dueller"
        par = max(Counter(frozenset(p) for p in s).values())
        per_lag = {t: sorted(so[i] for i, p in enumerate(s) if t in p) for t in lag}
        olika = min(len(set(v)) for v in per_lag.values())
        sista = s[-(n // 2):]
        dubbel = n % 2 == 0 and len({t for p in sista for t in p}) == n
        print(f"{n} lag: {len(s)} ronder  " + " ".join(a + b for a, b in s)
              + f"  | dueller per lag {antal[lag[0]]}, samma par högst {par} ggr, minst {olika} olika sorter per lag,"
              + f" dubbla poäng i sista varvet: {'ja' if dubbel else 'nej'}")
    print()
    print("Avhopp: lag D lämnar ett spel med 4 lag")
    s4 = nytt_schema(list("ABCD"))
    for efter in range(1, 6):
        tot, mal, rest = avhopp(s4, efter, "D")
        print(f"efter rond {efter}: spelat {' '.join(a + b for a, b in s4[:efter])} | resten {' '.join(a + b for a, b in rest)}"
              f" | {tot} ronder totalt, {mal} dueller per lag")
    print()
    print("Avhopp: lag C lämnar ett spel med 3 lag efter rond 2")
    s3 = nytt_schema(list("ABC"))
    tot, mal, rest = avhopp(s3, 2, "C")
    slut = Counter(t for p in s3[:2] + rest for t in p if t != "C")
    print(f"spelat {' '.join(a + b for a, b in s3[:2])} | resten {' '.join(a + b for a, b in rest)} | {tot} ronder totalt, "
          + (f"{mal} dueller per lag" if mal else f"ojämnt ({dict(slut)}): poängen räknas som snitt per duell"))
