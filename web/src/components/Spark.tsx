interface Props {
  values: number[] | undefined;
}

const W = 72;
const H = 24;

export function Spark({ values }: Props) {
  if (!values || values.length < 2) return <span className="spark" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(' ');
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg className={`spark ${rising ? 'up' : 'down'}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
