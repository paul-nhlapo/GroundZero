import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

export function Toggle(props: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={`toggle${props.checked ? ' on' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  );
}

export function Segmented<T extends string>(props: {
  value: T | null;
  options: Array<{ value: T; label: string; tone?: 'buy' | 'sell' }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={`${props.value === o.value ? 'selected' : ''} ${o.tone ?? ''}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled form control. Text inputs get a real <label>; button groups such as
 * Segmented name themselves, so they only get a caption (a wrapping <label> would
 * make a tap on the caption press the first button).
 */
export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  const child = props.children;
  const isInput = isValidElement(child) && child.type === 'input';
  return (
    <div className="field">
      {isInput ? (
        <label className="field-label" htmlFor={id}>{props.label}</label>
      ) : (
        <span className="field-label">{props.label}</span>
      )}
      {isInput ? cloneElement(child as ReactElement<{ id?: string }>, { id }) : child}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </div>
  );
}

export function Row(props: { title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <div className="row-title">{props.title}</div>
        {props.detail && <div className="row-detail">{props.detail}</div>}
      </div>
      {props.children}
    </div>
  );
}
