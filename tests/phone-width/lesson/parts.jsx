// The three squeezable parts of a lesson that are not equations, shared by the
// three demo lessons so all of them measure the same markup: a figure, a table
// and a code block. Kept small on purpose — a wide one would scroll the page
// sideways and fail a case this fixture already has.
//
// `what` goes into each part's text so the squeezed control (squeezed_demo.jsx)
// can tell the copy it squeezed from the copy it left alone by name.
export function Figure({ what = "sample" }) {
  return (
    <div className="figure-block">
      <svg viewBox="0 0 200 60" style={{ width: "100%", display: "block" }} role="img" aria-label={`${what} figure`}>
        <rect x="1" y="1" width="198" height="58" fill="none" stroke="currentColor" />
      </svg>
      <p className="figure-caption">{what} figure</p>
    </div>
  );
}

export function Table({ what = "sample" }) {
  return (
    <div className="data-table">
      <table>
        <thead><tr><th>{what} table</th><th>value</th></tr></thead>
        <tbody><tr><td>row</td><td>1</td></tr></tbody>
      </table>
    </div>
  );
}

export function Code({ what = "sample" }) {
  return <pre><code>{`// ${what} code\nconst x = 1;`}</code></pre>;
}
