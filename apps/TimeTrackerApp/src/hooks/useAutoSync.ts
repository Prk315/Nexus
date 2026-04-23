import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./useAppDispatch";
import { runSync } from "../store/slices/syncSlice";

export function useAutoSync() {
  const dispatch = useAppDispatch();
  const autoSync = useAppSelector((s) => s.settings.config?.supabase.auto_sync ?? false);

  useEffect(() => {
    if (!autoSync) return;
    const id = setInterval(() => dispatch(runSync()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoSync, dispatch]);
}
