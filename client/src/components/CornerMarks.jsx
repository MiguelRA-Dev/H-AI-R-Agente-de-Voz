const POSITIONS = ["tl", "tr", "bl", "br"];

export default function CornerMarks() {
  return (
    <div className="corner-marks" aria-hidden="true">
      {POSITIONS.map((pos) => (
        <span key={pos} className={`corner-mark ${pos}`} />
      ))}
    </div>
  );
}
