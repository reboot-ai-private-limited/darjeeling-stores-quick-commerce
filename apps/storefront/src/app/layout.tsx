import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreProvider } from "../state/StoreContext";
import { Header } from "../components/layout/Header";
import { BottomNav } from "../components/layout/BottomNav";
import { CartDrawer } from "../components/cart/CartDrawer";
import { LocationModal } from "../components/location/LocationModal";
import { LoginModal } from "../components/auth/LoginModal";
import { Footer } from "../components/layout/Footer";
import { OfflineBanner } from "../components/layout/OfflineBanner";
import { FloatingCartBar } from "../components/cart/FloatingCartBar";

export const metadata: Metadata = {
  title: "Darjeeling Stores — Groceries & Tea Delivered Fast",
  description:
    "Shop authentic Darjeeling tea, fresh organic hill produce, snacks, and daily kitchen essentials delivered to your door in minutes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <OfflineBanner />
          <Header />
          <div style={{ minHeight: "calc(100vh - 140px)", paddingBottom: 0 }}>
            {children}
          </div>
          <Footer />
          <FloatingCartBar />
          <BottomNav />
          <CartDrawer />
          <LocationModal />
          <LoginModal />
        </StoreProvider>
      </body>
    </html>
  );
}
