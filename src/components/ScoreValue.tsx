import { useEffect, useRef, useState } from "react";

export function ScoreValue({ value, className = "" }: { value: string | number; className?: string }) {
  const previous = useRef(value);
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setChanges((n) => n + 1);
    }
  }, [value]);

  return (
    <span key={changes} className={`score-value ${changes > 0 ? "is-changed" : ""} ${className}`}>
      {value}
    </span>
  );
}
