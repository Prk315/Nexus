import { cn } from "../utils";

interface AppGridButtonProps {
  name: string;
  /** Pre-resolved URL or data URI for the app icon */
  icon?: string | null;
  onLaunch: () => void;
  disabled?: boolean;
  className?: string;
}

export function AppGridButton({
  name,
  icon,
  onLaunch,
  disabled,
  className,
}: AppGridButtonProps) {
  return (
    <button
      onClick={onLaunch}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-4 rounded-lg",
        "bg-card border border-border",
        "hover:bg-accent hover:text-accent-foreground",
        "transition-colors duration-150 select-none cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "w-full aspect-square",
        className
      )}
    >
      {icon ? (
        <img
          src={icon}
          alt={name}
          className="w-10 h-10 object-contain rounded-md"
        />
      ) : (
        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
          <span className="text-lg font-semibold text-muted-foreground select-none">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <span className="text-xs font-medium truncate w-full text-center leading-tight">
        {name}
      </span>
    </button>
  );
}
