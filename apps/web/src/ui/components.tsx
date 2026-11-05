import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h1 className="panel-head">{title}</h1>
      <div className="panel-body">{children}</div>
    </section>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link';
}

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}

export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
