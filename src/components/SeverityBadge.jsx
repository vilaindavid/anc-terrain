import { SEVERITY_COLOR, severityTextColor } from '../engine/severity.js';

export default function SeverityBadge({ classement, style }) {
  if (!classement || classement === 'Simple constat') return null;
  const bg   = SEVERITY_COLOR[classement] || '#e0e0e0';
  const text = severityTextColor(classement);
  return (
    <span className="severity-stripe" style={{ background: bg, color: text, ...style }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: text, opacity: .7, flexShrink: 0 }} />
      {classement}
    </span>
  );
}
