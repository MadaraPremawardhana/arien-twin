"""Reference values for the twin's USM-1 (src/physics.js), from pvlib 0.16.1 and an independent Python
reading of the paper (Premawardhana, Nov 2026, Section 4 and Table 1).

    pip install pvlib==0.16.1
    python3 tools/usm1_reference.py > test/fixtures/usm1_reference.json

Geometry, air mass, precipitable water, ozone-free parts of the clear sky and the extraterrestrial term come
from pvlib (SPA, Kasten–Young, Gueymard 1994, Bird). The cloud, precipitation, snow and beam steps are written
here again from the paper's equations, separately from the JavaScript, so the two can check each other.
"""
import json
import math

import numpy as np
import pandas as pd
import pvlib

K = dict(kL=0.534, kM=0.668, kH=0.154, a=0.409, aP=2.35, P0=0.70, alphaS=0.71, kappa=1.39, eH=2, Gsc=1361.1, ang=1.3)


def ozone(t, lat, lon):  # van Heuklon (1979), atm-cm
    E = t.dayofyear
    if lat >= 0:
        A, B, C, F, H, I = 150, 1.28, 40, -30, 3, (20 if lon > 0 else 0)
    else:
        A, B, C, F, H, I = 100, 1.5, 30, 152.625, 2, -75
    return (235 + (A + C * math.sin(math.radians(0.9865 * (E + F))) + 20 * math.sin(math.radians(H * (lon + I))))
            * math.sin(math.radians(B * lat)) ** 2) / 1000


def hour(case):
    lat, lon = case["lat"], case["lon"]
    t_end = pd.Timestamp(case["tEnd"], tz="UTC")
    times = pd.DatetimeIndex([t_end - pd.Timedelta(minutes=60) + pd.Timedelta(minutes=5 + 10 * i) for i in range(6)])
    sp = pvlib.solarposition.get_solarposition(times, lat, lon, method="nrel_numpy")
    r = pvlib.solarposition.nrel_earthsun_distance(times)
    cosz = np.cos(np.radians(sp["zenith"].values))
    w = float(pvlib.atmosphere.gueymard94_pw(case["T"], case["RH"]))
    t550 = case["aod"]
    t380, t500 = t550 * (380 / 550) ** -K["ang"], t550 * (500 / 550) ** -K["ang"]
    uo = ozone(times[0], lat, lon)
    G = B = E0h = 0.0
    lit, mus = 0, 0.0
    for i in range(6):
        e0n = K["Gsc"] / r.values[i] ** 2
        if cosz[i] <= 0:
            continue
        E0h += e0n * cosz[i]; lit += 1; mus += cosz[i]
        z = sp["zenith"].values[i]
        am = float(pvlib.atmosphere.get_relative_airmass(z, model="kastenyoung1989"))
        b = pvlib.clearsky.bird(z, am, t380, t500, w, ozone=uo, pressure=case["p"] * 100, dni_extra=e0n, asymmetry=0.85, albedo=0.2)
        G += float(b["ghi"]); B += float(b["direct_horizontal"])
    G, B, E0h = G / 6, B / 6, E0h / 6
    fsun = lit / 6
    mu = mus / lit if lit else 0.0
    c = {"L": case["cL"], "M": case["cM"], "H": case["cH"]}
    P = case["P"]
    fP = 1 + K["aP"] * P / (P + K["P0"])
    tau = {"L": K["kL"] * fP, "M": K["kM"] * fP, "H": K["kH"] * c["H"] ** K["eH"]}
    cT = case.get("cT")
    C = max(cT, c["L"], c["M"], c["H"]) if cT is not None else 1 - (1 - c["L"]) * (1 - c["M"]) * (1 - c["H"])
    Tbar = beam = 1.0
    if C > 1e-9 and mu > 0:
        for i in "LMH":
            Ti = (K["a"] + mu) / (K["a"] + mu + tau[i])
            bi = math.exp(-K["kappa"] * tau[i] / mu)
            Tbar *= 1 - c[i] / C * (1 - Ti)
            beam *= 1 - c[i] / C * (1 - bi)
    kc = 1 - C + C * Tbar
    rhoG = 0.2 + (K["alphaS"] - 0.2) * min(1, case["ds"] / 0.05)
    rhoSky = 0.07 + 0.93 * C * (1 - Tbar)
    Fs = (1 - 0.2 * rhoSky) / (1 - rhoG * rhoSky)
    Gout = G * kc * Fs
    Bh = min(Gout, B * (1 - C + C * beam))
    return {"G": Gout, "Bh": Bh, "D": max(0.0, Gout - Bh), "Gcs": G, "Bcs": B, "kc": kc, "Fs": Fs, "rhoG": rhoG,
            "w": w, "uo": uo, "mu": mu, "fsun": fsun}


CASES = [
    dict(name="Buckingham, midsummer noon, clear", tEnd="2024-06-21T12:00Z", lat=51.9956, lon=-0.9906, T=20, RH=60, p=1013, cL=0, cM=0, cH=0, P=0, ds=0, aod=0.10),
    dict(name="Buckingham, winter morning, overcast low cloud with rain", tEnd="2024-12-10T10:00Z", lat=51.9956, lon=-0.9906, T=6, RH=92, p=1002, cL=1, cM=0.6, cH=0.2, P=0.8, ds=0, aod=0.08),
    dict(name="Buckingham, spring afternoon, broken mid and high cloud", tEnd="2024-04-15T15:00Z", lat=51.9956, lon=-0.9906, T=13, RH=70, p=1018, cL=0.1, cM=0.5, cH=0.8, P=0, ds=0, aod=0.12),
    dict(name="Sunrise hour (part of the hour sunlit)", tEnd="2024-03-20T07:00Z", lat=51.9956, lon=-0.9906, T=4, RH=85, p=1015, cL=0.3, cM=0, cH=0, P=0, ds=0, aod=0.1),
    dict(name="Sodankylä, snow under overcast", tEnd="2024-03-15T11:00Z", lat=67.37, lon=26.63, T=-8, RH=80, p=990, cL=0.9, cM=0.9, cH=0.5, P=0.2, ds=0.4, aod=0.05),
    dict(name="Tamanrasset, dusty clear, high altitude", tEnd="2024-07-01T12:00Z", lat=22.79, lon=5.53, T=33, RH=12, p=860, cL=0, cM=0, cH=0, P=0, ds=0, aod=0.6),
    dict(name="Lauder, southern hemisphere, total cover given", tEnd="2024-01-10T00:00Z", lat=-45.04, lon=169.69, T=18, RH=55, p=975, cL=0.2, cM=0.3, cH=0.4, cT=0.7, P=0, ds=0, aod=0.03),
    dict(name="Night", tEnd="2024-06-21T23:00Z", lat=51.9956, lon=-0.9906, T=12, RH=80, p=1013, cL=0.5, cM=0, cH=0, P=0, ds=0, aod=0.1),
]

if __name__ == "__main__":
    out = {"pvlib": pvlib.__version__, "cases": []}
    for c in CASES:
        out["cases"].append({"input": c, "expect": hour(c)})
    # single instants for the solar position and the Bird clear sky
    inst = []
    for ts, lat, lon in [("2024-06-21T11:55Z", 51.9956, -0.9906), ("2024-12-21T14:20Z", 51.9956, -0.9906), ("2025-03-01T06:10Z", -33.9, 151.2), ("2026-11-19T09:30Z", 1.35, 103.82)]:
        t = pd.DatetimeIndex([pd.Timestamp(ts)])
        sp = pvlib.solarposition.get_solarposition(t, lat, lon, method="nrel_numpy")
        r = float(pvlib.solarposition.nrel_earthsun_distance(t).values[0])
        z = float(sp["zenith"].values[0])
        am = float(pvlib.atmosphere.get_relative_airmass(z, model="kastenyoung1989"))
        e0n = 1361.1 / r ** 2
        b = pvlib.clearsky.bird(z, am, 0.15, 0.12, 1.8, ozone=0.32, pressure=95000, dni_extra=e0n, asymmetry=0.85, albedo=0.2)
        inst.append({"t": ts, "lat": lat, "lon": lon, "cosZ": math.cos(math.radians(z)), "r": r, "am": am,
                     "bird": {"aod380": 0.15, "aod500": 0.12, "w": 1.8, "uo": 0.32, "p": 950, "E0n": e0n,
                              "G": float(b["ghi"]), "Bn": float(b["dni"]), "Bh": float(b["direct_horizontal"])}})
    out["instants"] = inst
    out["pw"] = [{"T": T, "RH": RH, "w": float(pvlib.atmosphere.gueymard94_pw(T, RH))} for T, RH in [(20, 60), (-10, 80), (35, 15), (5, 95)]]
    print(json.dumps(out, indent=1, default=float))
