"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "../../state/StoreContext";

/** /location opens the location picker over the home page. */
export default function LocationPage() {
  const router = useRouter();
  const { setIsLocationModalOpen } = useStore();
  useEffect(() => {
    setIsLocationModalOpen(true);
    router.replace("/");
  }, [router, setIsLocationModalOpen]);
  return null;
}
