import React from 'react';

/**
 * HIVE Input. The dark input well used across the deck (launch briefing, steer,
 * auth). Renders a `textarea` when `multiline`, with an optional mono label.
 */
export interface InputProps {
  label?: string;
  multiline?: boolean;
  mono?: boolean;
  className?: string;
  id?: string;
  rows?: number;
  name?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement & HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement & HTMLTextAreaElement>;
  onInput?: React.FormEventHandler<HTMLInputElement & HTMLTextAreaElement>;
  'aria-label'?: string;
}

export function Input({ label, multiline = false, mono = false, className = '', id, ...rest }: InputProps) {
  const cls = ['hv-input', mono ? 'hv-input--mono' : '', className].filter(Boolean).join(' ');
  const field = multiline ? (
    <textarea className={cls} id={id} {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
  ) : (
    <input className={cls} id={id} {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />
  );
  if (!label) return field;
  return (
    <label className="hv-field" htmlFor={id}>
      <span className="hv-field-label">{label}</span>
      {field}
    </label>
  );
}
