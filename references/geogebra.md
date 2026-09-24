# GeoGebra figures — `<GeoGebraGraph>`

A GeoGebra applet in the lesson: a figure the student drags, zooms or rotates. Read this before
writing one. The worked example is `tests/geogebra/lesson/geogebra_demo.jsx`, and
`tests/geogebra/run.sh` is its evidence at phone and desktop widths.

## When to use it

Use it where moving the figure is the lesson: a property that holds however the figure is
dragged, or a shape only rotating makes legible.

- **Geometric constructions** — an invariant under dragging (inscribed angle, triangle centres,
  a locus). One drawing shows one position and asks the student to take the rest on trust.
- **3D** — surfaces, solids, planes and their intersections, a saddle point, a gradient at a
  point. A static projection hides depth.
- **Vector fields and 2D figures with points to drag** — a field with a movable test point, a
  phasor diagram, a force triangle.

Use something else when:

- **2D curves with sliders** → `<DesmosGraph>` (`references/desmos-schema.md`). It's lighter
  and its expression panel is the better interface for "change a and watch".
- **One static shape tells the story** → inline SVG. The first applet on a page fetches several
  MB and takes about 7 s on a warm line.
- **A bespoke interaction** (a custom widget, lesson-state driven) → an interactive demo.

Cap it at two applets per visible topic: each is a full GeoGebra instance, and a phone pays for
every one.

## How

```jsx
import { GeoGebraGraph } from "@core";

const INSCRIBED = [            // module-level, so the array is stable across renders
  "c = Circle((0, 0), 3)",
  "A = (3; -30°)", "B = (3; 60°)",
  "P = Point(c)", "SetCoords(P, -2.12, -2.12)",
  "SetFixed(A, true)", "SetFixed(B, true)",
  "angP = Angle(A, P, B)",
  "ZoomIn(-4, -4, 4, 4)", "SetAxesRatio(1, 1)",
];

<GeoGebraGraph view="geometry" commands={INSCRIBED} height={380} mid="inscribed-angle"/>
```

| prop | |
| --- | --- |
| `view` | `"graphing"` (axes and grid), `"geometry"` (plain canvas) or `"3d"`. Default `"graphing"`. |
| `commands` | GeoGebra input-bar commands, run in order once the applet is up. |
| `height` | Pixels, default 420. Width is the column's, and follows it when the window changes. |
| `algebra` | Show the algebra view beside the figure. Default off, because on a phone it takes half the width. |
| `toolbar` | Show the construction toolbar. Default off. |
| `params` | GeoGebra applet parameters, applied last; `{ material_id: "…" }` loads a geogebra.org material instead of building from commands. |
| `onReady` | Called with the applet's API (`getValue`, `setValue`, `evalCommand`, `setCoords`, …) once the commands have run. |

The applet always has a reset button and zoom buttons, and never a menu, input bar or right-click
menu. GeoGebra's error dialogs are off, so a bad command can't cover the figure with a modal.

### Gotchas

- **Name everything you create** (`angP = Angle(A, P, B)`, not `Angle(A, P, B)`). GeoGebra answers
  `false` for every scripting command (`SetColor`, `SetFixed`, `ZoomIn`) even when it worked, so
  the component checks only named definitions. A rejected one is named under the figure and in
  the console; a bare command that failed is silent.
- **`Point(c, t)` is pinned.** A point on a path given a parameter is dependent and cannot be
  dragged. Use `P = Point(c)` and then `SetCoords(P, x, y)`.
- **`Slider(min, max, step)` starts at `min`.** Follow it with `SetValue(a, 1)`.
- **After `ZoomIn`, add `SetAxesRatio(1, 1)`** in geometry. A phone's tall figure otherwise draws a
  circle as an ellipse.
- **Keep `commands` stable.** The applet rebuilds whenever the commands change, so build the
  array at module level or in `useMemo`.

## What it needs from outside

No account and no API key. Two things load from `https://www.geogebra.org/apps/`: `deployggb.js`
(fetched by `hooks/useGeoGebra.js` on the first `<GeoGebraGraph>`, never on a lesson without one)
and the versioned applet codebase that script pulls in. GeoGebra's loader runs in one hidden
`about:blank` iframe. The lesson template's CSP (`object-src 'none'; frame-src 'none'; base-uri
'self'; form-action 'self'`) allows all of it unchanged, because it leaves `script-src` and
`connect-src` open and a blank frame fetches nothing; `tests/geogebra` checks there's no
violation. A site that tightens `script-src` or `connect-src` must allow `https://www.geogebra.org`.

GeoGebra's licence (https://www.geogebra.org/license) lets anyone use it for non-commercial
purposes, which these lessons are. A lesson sold or put behind a paywall needs a commercial licence.

If geogebra.org can't be reached, each figure becomes a dashed "GeoGebra figure unavailable" box
within 8 s. If the script arrives but the applet hasn't started after 25 s, a note says so above
the figure, and a late start clears it.

## The tutor

The tutor can't drive a GeoGebra figure yet: there is no `<<GEOGEBRA>>` tag like `<<DESMOS>>`.
That's a later step.
