import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // Dev-tool fields hold URLs/JSON/headers/tokens, not prose — kill the
        // WKWebView (Tauri) autocorrect/auto-capitalize/spellcheck that keeps
        // "helpfully" capitalizing and correcting as users type. Placed before
        // {...props} so a genuinely prose field can opt back in per-instance.
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
