FFT core adapted from SeedOcean, MIT, copyright 2026 lushiqiang.
Source: https://github.com/reed-soul/SeedOcean
Pinned commit: 115e0ba0d79c46fcb1a0fe27df2046651aa2c103

Only the spectrum/IFFT/cascade modules are vendored. Local modifications repair
foam feedback texture bindings and make foam persistence time-based. The ocean
material, boat dynamics, wake field and integration are project code.

Upstream FFT/spectrum credit Poseidon and gasgiant/FFT-Ocean:
https://github.com/owenyuwono/poseidon — copyright (c) 2026 owenyuwono
https://github.com/gasgiant/FFT-Ocean — copyright (c) 2020 Ivan Pensionerov
Both use the MIT license reproduced in LICENSE, with their respective copyright
notices above applying to their contributions.
