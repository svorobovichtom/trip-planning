// Loading placeholder: a section heading and a card of rows, shaped like the
// list, so the page doesn't jump when the data arrives. Styles: global.css.
const widths = ["62%", "48%", "70%", "40%", "56%", "66%"];

export function Skeleton({ rows = 6, label = "Загружаю" }: { rows?: number; label?: string }) {
  return (
    <div className="skel" aria-busy="true" aria-label={label}>
      <div className="skel-h" />
      <div className="skel-c">
        {widths.slice(0, rows).map((w, i) => (
          <div className="skel-r" key={i}>
            <i style={{ animationDelay: `${i * 80}ms` }} />
            <i style={{ width: w, animationDelay: `${i * 80}ms` }} />
            <i style={{ animationDelay: `${i * 80}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
