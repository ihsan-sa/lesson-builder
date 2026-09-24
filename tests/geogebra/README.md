# geogebra — the sample GeoGebra section works in a built lesson, on a phone

Evidence for `<GeoGebraGraph>` (`references/bootstrap/_lesson-core/ui/GeoGebraGraph.jsx`).
`run.sh` bootstraps a throwaway workspace, scaffolds the template lesson with
`lesson/geogebra_demo.jsx` (the sample section `references/geogebra.md` points authors at), builds
it with `vite build`, serves `dist/` with `vite preview` and runs `check.cjs` in Chrome.

```
GEOGEBRA_BROWSER=/usr/bin/google-chrome tests/geogebra/run.sh
KEEP=1 GEOGEBRA_BROWSER=/usr/bin/google-chrome tests/geogebra/run.sh   # keep the workspace
```

It needs a Chromium and https://www.geogebra.org, so `tests/check.sh` lists it rather than
running it. It uses the scaffolded lesson's own Playwright, so there's nothing to install here.
About two minutes; `vite preview` is stopped on exit.

## What `check.cjs` asserts

Each case opens its own page and asserts only on what that page did.

| case | page | must hold |
| --- | --- | --- |
| phone | 390×844, touch | both figures reach `data-ggb="ready"`; no CSP violation and no page error; GeoGebra accepted every command; nothing scrolls sideways; each applet is drawn inside its column; moving `P` round the circle leaves ∠APB unchanged and equal to half ∠AOB; the circle is round; the 3D figure holds the saddle |
| desktop | 1440×900, then 700 wide | both figures ready; each applet narrows with its column |
| blocked | 390×844, every geogebra.org request aborted | both figures settle as `failed` inside the bound with the fallback text, none is left on "Loading figure...", and the failure is logged once |
| bad command | 390×844, `?bad=1` | a third figure with an unclosed bracket is ready and names the rejected command, the command after it still ran, the good figures carry no note, and no GeoGebra modal appears |

The blocked and bad-command cases are the negative controls: they show the check sees a figure
fail rather than only ever staying quiet.
