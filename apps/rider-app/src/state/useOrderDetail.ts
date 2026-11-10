import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { getOrder, type LatLng, type OrderDetail } from "../api/rider";

/** Loads one order from the API, with loading and error state and a way to reload. */
export function useOrderDetail(id: string | undefined) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!id) { setLoading(false); setError("This order could not be found."); return null; }
    setLoading(true); setError("");
    try { const d = await getOrder(id); setDetail(d); return d; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this order."); return null; }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  return { detail, error, loading, reload };
}

/** The phone's position if the rider has allowed location; null otherwise. Never throws and never asks for permission. */
export async function currentFix(): Promise<{ location: LatLng; accuracyM: number | null } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { location: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracyM: p.coords.accuracy ?? null };
  } catch { return null; }
}

export const isCod = (d: Pick<OrderDetail, "paymentMethod" | "alreadyPaid" | "amountDue">) => d.paymentMethod === "cod" && !d.alreadyPaid && d.amountDue > 0;
