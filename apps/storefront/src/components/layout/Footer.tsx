"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getCategories } from "../../lib/api";
import type { Category } from "../../lib/types";
import { useStore } from "../../state/StoreContext";
import { Icon } from "../ui/Icon";

/** Same number the Help page uses for WhatsApp and calls. */
const SUPPORT_PHONE = "+91 90000 00002";
const SUPPORT_TEL = "+919000000002";
const WHATSAPP = "https://wa.me/919000000002?text=Hi%20Darjeeling%20Stores,%20I%20need%20help";

/** Pages where a footer would only get in the way of finishing an order. */
const HIDE_ON = ["/checkout", "/pay/", "/tracking/"];


const PAYMENT_LOGOS = [
  { name: "Visa", src: "/payments/visa.jpg" },
  { name: "Mastercard", src: "/payments/mastercard.jpg" },
  { name: "Google Pay", src: "/payments/gpay.jpg" },
  { name: "PhonePe", src: "/payments/phonepe.jpg" },
  { name: "Paytm", src: "/payments/paytm.jpg" },
  { name: "UPI", src: "/payments/upi.jpg" },
];

/** Accepted payment methods, shown as the official logos on white cards. */
const PaymentLogos: React.FC = () => (
  <ul className="foot-pay" aria-label="Accepted payment methods">
    {PAYMENT_LOGOS.map((p) => (
      <li key={p.name} title={p.name}>
        <img src={p.src} alt={p.name} loading="lazy" />
      </li>
    ))}
  </ul>
);

export const Footer: React.FC = () => {
  const pathname = usePathname();
  const { zone, storeStatus, setIsLocationModalOpen, signedIn, setIsLoginModalOpen } = useStore();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!zone) {
      setCategories([]);
      return;
    }
    getCategories(zone.id)
      .then((c) => setCategories(c.slice(0, 7)))
      .catch(() => setCategories([]));
  }, [zone]);

  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  const eta = storeStatus ? `${storeStatus.etaMinMinutes}-${storeStatus.etaMaxMinutes} minutes` : "minutes";
  const gate = (href: string) => (e: React.MouseEvent) => {
    if (!signedIn) {
      e.preventDefault();
      setIsLoginModalOpen(true);
    } else {
      void href;
    }
  };

  return (
    <footer className="site-footer">
      <div className="foot-dark">
      <div className="page-container">
        {/* Promise strip */}
        <div className="foot-promises">
          <div>
            <Icon name="zap" size={20} color="var(--yellow)" />
            <span>
              <b>Delivery in {eta}</b>
              <small>Straight to your door</small>
            </span>
          </div>
          <div>
            <Icon name="feather" size={20} color="var(--yellow)" />
            <span>
              <b>Fresh &amp; local</b>
              <small>Sourced from Darjeeling</small>
            </span>
          </div>
          <div>
            <Icon name="credit-card" size={20} color="var(--yellow)" />
            <span>
              <b>Pay your way</b>
              <small>Cash, UPI or cards</small>
            </span>
          </div>
          <div>
            <Icon name="phone" size={20} color="var(--yellow)" />
            <span>
              <b>Here to help</b>
              <small>Call or WhatsApp us</small>
            </span>
          </div>
        </div>

        <div className="foot-grid">
          {/* Brand */}
          <div className="foot-brand">
            <Link href="/" className="foot-logo">
              <span className="brand-mark">
                <Icon name="shopping-bag" size={18} color="var(--maroon)" />
              </span>
              <span>Darjeeling Stores</span>
            </Link>
            <p>
              Authentic Darjeeling tea, fresh hill produce, snacks and daily kitchen essentials, delivered from local stores to your doorstep in minutes.
            </p>
            <button className="foot-loc" onClick={() => setIsLocationModalOpen(true)}>
              <Icon name="map-pin" size={15} color="var(--yellow)" />
              {zone ? `Delivering in ${zone.name}` : "Set your delivery location"}
            </button>
          </div>

          {/* Shop */}
          <nav aria-label="Shop">
            <h3>Shop</h3>
            <ul>
              <li>
                <Link href="/categories">All categories</Link>
              </li>
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/category/${c.id}`}>{c.name}</Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Account */}
          <nav aria-label="Your account">
            <h3>Your account</h3>
            <ul>
              <li>
                <Link href="/account/orders" onClick={gate("/account/orders")}>
                  My orders
                </Link>
              </li>
              <li>
                <Link href="/account/addresses" onClick={gate("/account/addresses")}>
                  Saved addresses
                </Link>
              </li>
              <li>
                <Link href="/account/favourites">Favourites</Link>
              </li>
              <li>
                <Link href="/account/refunds" onClick={gate("/account/refunds")}>
                  Refunds
                </Link>
              </li>
              <li>
                <Link href="/account/notifications" onClick={gate("/account/notifications")}>
                  Notification settings
                </Link>
              </li>
              <li>
                <Link href="/account" onClick={gate("/account")}>
                  Profile
                </Link>
              </li>
            </ul>
          </nav>

          {/* Help */}
          <nav aria-label="Help">
            <h3>Help &amp; support</h3>
            <ul>
              <li>
                <Link href="/help">FAQs</Link>
              </li>
              <li>
                <Link href="/contact">Contact us</Link>
              </li>
              <li>
                <Link href="/search">Search products</Link>
              </li>
              <li>
                <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
                  Chat on WhatsApp
                </a>
              </li>
              <li>
                <a href={`tel:${SUPPORT_TEL}`}>Call {SUPPORT_PHONE}</a>
              </li>
              <li>
                <Link href="/help">Delete my account</Link>
              </li>
            </ul>
          </nav>

          {/* Policies */}
          <nav aria-label="Policies">
            <h3>Policies</h3>
            <ul>
              <li>
                <Link href="/terms">Terms &amp; conditions</Link>
              </li>
              <li>
                <Link href="/privacy">Privacy policy</Link>
              </li>
              <li>
                <Link href="/refund-policy">Refund policy</Link>
              </li>
              <li>
                <Link href="/shipping-policy">Shipping policy</Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
      </div>

      <div className="foot-light">
        <div className="page-container">
          <h3 className="foot-accept-title">We accept</h3>
          <PaymentLogos />

          <div className="foot-bottom">
            <span>© {new Date().getFullYear()} Darjeeling Stores. All rights reserved.</span>
            <a className="foot-dev" href="https://rebootai.in/" target="_blank" rel="noopener noreferrer" aria-label="Developed by Reboot AI">
              <span>Developed by</span>
              <img src="/reboot-ai-logo.png" alt="Reboot AI" width={110} height={20} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
