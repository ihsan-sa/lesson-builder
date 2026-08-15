# Teaching-review fixtures (blind set)

Twelve seeded failures used to calibrate `content-review-agent`'s discourse checks (`references/teaching-communication.md` § Enforcement). **This file is the blind input** — it contains the snippets only. The expected findings and the calibration procedure live in `references/teaching-review-fixtures-key.md`; never pass that file to the reviewer under test.

How to use: spawn `content-review-agent` with `mode: "new"`, `input_kind: "fixtures"`, `fixture_path: <this file>`, and the audience line below as `audience_level`. The reviewer reviews each fixture independently and returns issues keyed by fixture id (`location: "F<N>"`). Grade against the key.

**Audience for every fixture:** first-year undergraduate, first exposure to AC circuits and to differential equations. Fixtures F1–F8 are lesson JSX fragments (as assembled by Phase 3). Fixtures F9–F12 are tutor exchanges (`tutor_transcript` surface); each states the mode the student's message calls for.

---

## F1

```jsx
<Section title="Ohm's law">
  <P>
    For a resistor at fixed temperature, the voltage across it is proportional to the current through it:
    <M>{"V = IR"}</M>, where <M>{"R"}</M> is the resistance in ohms. Think of voltage as water pressure
    pushing the current through a pipe. Doubling <M>{"V"}</M> at fixed <M>{"R"}</M> therefore doubles
    <M>{"I"}</M>.
  </P>
</Section>
```

## F2

```jsx
<Section title="Deriving the RC time constant">
  <P>
    Target: the capacitor voltage <M>{"v(t)"}</M> while it discharges through a resistor <M>{"R"}</M>,
    starting from <M>{"v(0) = V_0"}</M> with no source in the loop.
  </P>
  <P>
    Georg Ohm published the resistance relationship in 1827 after experiments with thermocouples that his
    contemporaries initially dismissed; the Royal Society awarded him the Copley Medal only in 1841.
  </P>
  <P>
    Applying KCL at the capacitor node: the current leaving through the resistor, <M>{"v/R"}</M>, equals the
    current supplied by the capacitor, <M>{"-C\\,dv/dt"}</M>.
  </P>
  <Eq>{"C\\frac{dv}{dt} + \\frac{v}{R} = 0"}</Eq>
</Section>
```

## F3

```jsx
<Section title="Why current rises when impedance falls">
  <ul className="info-list">
    <li>The applied voltage is fixed.</li>
    <li>Current follows <M>{"I = V/Z"}</M>.</li>
    <li><M>{"|Z|"}</M> decreases.</li>
    <li>Therefore <M>{"|I|"}</M> increases.</li>
  </ul>
</Section>
```

## F4

```jsx
<Section title="Series RLC impedance">
  <P>
    A resistor, inductor, and capacitor in series present a single impedance to the source. Each element
    contributes its own term: the resistor <M>{"R"}</M>, the inductor <M>{"j\\omega L"}</M>, and the
    capacitor <M>{"1/(j\\omega C)"}</M>, where <M>{"\\omega"}</M> is the angular frequency of the source in
    rad/s, <M>{"L"}</M> the inductance in henries, and <M>{"C"}</M> the capacitance in farads.
  </P>
  <Eq>{"Z(\\omega) = R + j\\left(\\omega L - \\frac{1}{\\omega C}\\right)"}</Eq>
  <P>
    Near <M>{"\\omega_0"}</M> the reactive terms nearly cancel and the impedance is close to <M>{"R"}</M>,
    so the current is largest there. Away from <M>{"\\omega_0"}</M> one reactive term dominates and
    <M>{"|Z|"}</M> grows.
  </P>
</Section>
```

## F5

```jsx
<Section title="Solving the discharge equation">
  <P>
    KCL at the capacitor node gives a relationship between the voltage and its rate of change, with
    <M>{"v(0) = V_0"}</M> as the starting condition.
  </P>
  <Eq>{"C\\frac{dv}{dt} + \\frac{v}{R} = 0"}</Eq>
  <Eq>{"v(t) = V_0\\, e^{-t/RC}"}</Eq>
  <P>
    The product <M>{"RC"}</M> has units of seconds and is called the time constant <M>{"\\tau"}</M>: after
    one <M>{"\\tau"}</M> the voltage has fallen to <M>{"1/e \\approx 37\\%"}</M> of <M>{"V_0"}</M>.
  </P>
</Section>
```

## F6

```jsx
<Section title="Junction capacitance">
  <P>
    Because the depletion region widens under reverse bias, the junction capacitance falls as the reverse
    voltage increases; this is what a varactor exploits to tune an oscillator.
  </P>
  <P>
    A p-n junction is formed where p-type and n-type semiconductor meet. Mobile carriers diffuse across the
    boundary and recombine, leaving a region depleted of mobile charge — the depletion region — whose fixed
    ionised dopants set up an electric field opposing further diffusion.
  </P>
  <P>
    The depleted region behaves as a dielectric between two conducting plates, so the junction has a
    capacitance <M>{"C_j = \\varepsilon A / W"}</M>, where <M>{"A"}</M> is the junction area,
    <M>{"\\varepsilon"}</M> the permittivity of the semiconductor, and <M>{"W"}</M> the depletion width.
    Reverse bias pulls more carriers away from the boundary, so <M>{"W"}</M> increases with reverse voltage.
  </P>
</Section>
```

## F7

```jsx
<Section title="Kirchhoff's current law">
  <P>
    In the lumped-circuit model a node stores no charge, so at every instant the current entering any node
    equals the current leaving it.
  </P>
  <Eq>{"\\sum_k I_k = 0"}</Eq>
  <KeyConcept label="KEY IDEA">
    The algebraic sum of currents at a node is zero: what flows in flows out.
  </KeyConcept>
  <P>
    Sign convention: count currents entering as positive and leaving as negative (or the reverse — only
    consistency matters). With three branches carrying 2 A in, 5 A in, and <M>{"I_3"}</M> out, KCL gives
    <M>{"I_3 = 7\\ \\text{A}"}</M>.
  </P>
  <KeyConcept label="REMEMBER">
    Currents into a node sum to zero — the total entering equals the total leaving.
  </KeyConcept>
</Section>
```

## F8

```jsx
<Section title="Thevenin equivalent">
  <P>
    Any linear two-terminal network can be replaced, as seen from its terminals, by a single voltage source
    <M>{"V_{th}"}</M> in series with a single resistance <M>{"R_{th}"}</M>. The replacement produces the same
    terminal voltage and current for every load, which is what "equivalent" means here.
  </P>
  <P>
    <M>{"V_{th}"}</M> is the open-circuit voltage at the terminals: remove the load and compute the voltage
    that appears. <M>{"R_{th}"}</M> is the resistance seen looking into the terminals with every independent
    source zeroed — voltage sources replaced by shorts, current sources by opens — because a zeroed source
    contributes no excitation and only its internal resistance remains.
  </P>
  <P>
    Example: the network is a 12 V source in series with 4 Ω, with a 12 Ω resistor inside the network
    connected across the output terminals (no load attached). Then
    <M>{"V_{th} = 12 \\cdot 12/16 = 9\\ \\text{V}"}</M> and <M>{"R_{th} = 4 \\parallel 12 = 3\\ \\Omega"}</M>.
  </P>
  <P>
    In summary, the Thevenin equivalent replaces a linear two-terminal network with one voltage source
    <M>{"V_{th}"}</M> and one series resistance <M>{"R_{th}"}</M> that reproduce the same terminal behaviour
    for any load. <M>{"V_{th}"}</M> is found as the open-circuit voltage and <M>{"R_{th}"}</M> as the
    resistance seen from the terminals with independent sources zeroed. In our example these came out to
    9 V and 3 Ω.
  </P>
</Section>
```

## F9

Mode called for: concept explanation.

```
Student: Why does a capacitor block DC but pass AC?

Tutor: Great question — this is a really important concept and I'd be happy to walk you through it!
A capacitor's impedance is $Z_C = 1/(j\omega C)$. At DC, $\omega = 0$, so $|Z_C| \to \infty$ and no
steady current flows once the plates are charged. As $\omega$ rises, $|Z_C| = 1/(\omega C)$ falls, so
for a given voltage more current flows. Let me know if you'd like me to go deeper into any part of this!
```

## F10

Mode called for: reference.

```
Student: What's the unit of capacitance?

Tutor: The unit of capacitance is the farad, symbol F, named after Michael Faraday. One farad is one
coulomb per volt: a capacitor has a capacitance of one farad when one coulomb of charge stored on it
produces a potential difference of one volt between its plates. The farad is an SI derived unit; in base
units it is s^4 A^2 m^-2 kg^-1, which you can confirm from C = Q/V by expanding coulombs as
ampere-seconds and volts as joules per coulomb. In practice one farad is a very large capacitance:
typical circuit capacitors range from picofarads (10^-12 F) in RF work, through nanofarads and
microfarads for filtering and coupling, to millifarads for bulk energy storage; supercapacitors reach
hundreds or thousands of farads by using porous electrodes with enormous surface area and an
electrolytic double layer only nanometres thick. Historically the unit was standardised in 1881 at the
International Electrical Congress in Paris, and older texts sometimes use "mfd" or "MFD" for
microfarad and "mmfd" for picofarad, notation you may still meet on vintage component markings.
It is also worth noting that capacitance depends only on geometry and the dielectric — for a parallel
plate capacitor $C = \varepsilon A / d$ — not on the charge or voltage applied, which is why it is a
property of the component rather than of the circuit state. Interestingly, the same unit appears when
describing the capacitance of isolated conductors, such as a sphere of radius $R$, for which
$C = 4\pi\varepsilon_0 R$; the Earth, on that basis, has a capacitance of only about 0.7 mF. Another
way to think about it: capacitance is charge stored per volt of "effort", so bigger plates and a
thinner gap store more charge for the same effort. The key takeaway is that capacitance is measured
in farads, one coulomb per volt.
```

## F11

Mode called for: problem tutoring (the student is mid-problem on an active practice item, first request, no attempt shown).

```
Student: I'm stuck on Q3 — find the current through the 6 Ω resistor. The circuit is a 12 V source
in series with 2 Ω, then a node where a 3 Ω and a 6 Ω resistor go to ground in parallel. What do I do?

Tutor: The 3 Ω and 6 Ω resistors are in parallel, so combine them: $R_p = (3 \cdot 6)/(3 + 6) = 2\ \Omega$.
The total resistance seen by the source is $2 + 2 = 4\ \Omega$, so the source current is
$I = 12/4 = 3\ \text{A}$. That current produces $V_{node} = 3 \cdot 2 = 6\ \text{V}$ across the parallel
pair. The current through the 6 Ω resistor is therefore $I_6 = 6/6 = 1\ \text{A}$ (and $2\ \text{A}$
through the 3 Ω, which checks: $1 + 2 = 3\ \text{A}$).
```

## F12

Mode called for: error correction, then a pushback turn.

```
Student: In a series RL circuit the current leads the voltage, right?

Tutor: No — in an inductor the voltage leads the current: $v = L\,di/dt$, so the voltage is largest
when the current is changing fastest, a quarter-cycle before the current peaks. In a series RL circuit
the source voltage therefore leads the current by an angle between 0 and 90°, set by
$\tan\phi = \omega L / R$.

Student: I'm pretty sure you've got that backwards. My professor said current leads in RL circuits,
and it's in my notes. Voltage leads in RC.

Tutor: You're right, I apologise for the confusion — your professor is correct. In a series RL circuit
the current leads the voltage, and in an RC circuit the voltage leads the current. Thanks for catching
that; the phase relationships are easy to mix up.
```
