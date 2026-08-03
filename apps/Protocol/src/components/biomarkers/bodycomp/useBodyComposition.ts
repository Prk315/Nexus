import { useEffect, useState } from "react";
import { fetchBodyComposition } from "./api";
import type { BodyCompositionData } from "./data";

/** Fetches the latest body-composition scan on mount. `data` is null until it
 * resolves and stays null when there's no scan / not authenticated / on error,
 * so the module can fall back to its SAMPLE. */
export function useBodyComposition() {
  const [data, setData] = useState<BodyCompositionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchBodyComposition()
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading };
}
