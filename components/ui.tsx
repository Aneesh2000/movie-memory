import type { ComponentProps, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900 ${className}`}
    >
      {children}
    </section>
  );
}

const buttonStyles = {
  primary:
    "bg-amber-500 text-stone-950 hover:bg-amber-400 focus-visible:outline-amber-500 disabled:bg-amber-500/50",
  secondary:
    "border border-stone-300 text-stone-700 hover:bg-stone-100 focus-visible:outline-stone-400 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800",
  ghost:
    "text-stone-600 hover:bg-stone-100 focus-visible:outline-stone-400 dark:text-stone-300 dark:hover:bg-stone-800",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:py-16">{children}</main>;
}
