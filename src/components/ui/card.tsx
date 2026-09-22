import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-border px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-text", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "success" | "warning" | "danger" | "brand" }) {
  const variants: Record<string, string> = {
    default: "bg-bg-subtle text-muted",
    // Tons 700/800 en thème clair, et non 600 : sur un fond teinté à 15 %, le
    // ton 600 tombait sous le seuil WCAG AA (success 3,28:1, warning 2,84:1,
    // danger 3,97:1 pour 4,5:1 requis). Le jaune demande le ton 800, le 700 ne
    // suffisant pas (4,47:1). Le thème sombre est inchangé : ses tons 400
    // atteignent déjà 5,37:1 à 7,87:1.
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
    danger: "bg-red-500/15 text-red-700 dark:text-red-400",
    brand: "bg-brand/15 text-brand",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
