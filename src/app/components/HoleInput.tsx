import type { RefObject } from 'react';

/**
 * One hole's score box. After a complete score the cursor moves to the next box in `container`
 * (a leading 1 could be 10-19, so it waits for a second digit).
 */
export function HoleInput({ value, label, onChange, container }: { value: string; label: string; onChange: (v: string) => void; container: RefObject<HTMLElement> }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      data-hole
      aria-label={label}
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 2);
        onChange(v);
        if (v.length === 2 || (v.length === 1 && v !== '1')) {
          const inputs = [...(container.current?.querySelectorAll<HTMLInputElement>('input[data-hole]') ?? [])];
          inputs[inputs.indexOf(e.target) + 1]?.focus();
        }
      }}
    />
  );
}
