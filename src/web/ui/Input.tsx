import * as React from "react";
import { cn } from "./utils";

const fieldClass =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, "min-h-18 resize-y", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(fieldClass, "w-auto cursor-pointer", className)}
      {...props}
    />
  );
}
