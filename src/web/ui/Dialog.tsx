import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { cn } from "./utils";

const DismissDialog = React.createContext<(() => void) | undefined>(undefined);
export function DialogRoot({children,open,defaultOpen=false,onOpenChange,...props}:DialogPrimitive.DialogProps) {
  const [localOpen,setLocalOpen]=React.useState(defaultOpen);
  const change=(next:boolean)=>{setLocalOpen(next);onOpenChange?.(next);};
  return <DialogPrimitive.Root {...props} open={open??localOpen} onOpenChange={change}><DismissDialog.Provider value={()=>change(false)}>{children}</DismissDialog.Provider></DialogPrimitive.Root>;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: DialogPrimitive.DialogContentProps) {
  const content=React.useRef<HTMLDivElement>(null),dismiss=React.useContext(DismissDialog);
  const latest=React.useRef({dismiss,onEscapeKeyDown:props.onEscapeKeyDown});
  latest.current={dismiss,onEscapeKeyDown:props.onEscapeKeyDown};
  React.useEffect(()=>{
    // Optional content can mount another portal after its parent. Consume Escape
    // once at the visible top dialog, before library document-level listeners.
    const key=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||!content.current)return;
      const dialogs=document.querySelectorAll('[data-slot="dialog-content"][data-state="open"]');
      if(dialogs.item(dialogs.length-1)!==content.current)return;
      latest.current.onEscapeKeyDown?.(event);
      if(!event.defaultPrevented)latest.current.dismiss?.();
      event.preventDefault();event.stopImmediatePropagation();
    };
    window.addEventListener('keydown',key,true);
    return()=>window.removeEventListener('keydown',key,true);
  },[]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        ref={content}
        data-slot="dialog-content"
        className={cn(
          "ds fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl border border-line bg-background p-6 text-foreground shadow-floating",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      className={cn("m-0 text-xl font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-2 text-sm text-muted", className)}
      {...props}
    />
  );
}

export function DialogActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-wrap gap-2.5", className)}
      {...props}
    />
  );
}
