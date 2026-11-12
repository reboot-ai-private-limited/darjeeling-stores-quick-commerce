import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../components/ui/Icon";

export const metadata: Metadata = { title: "Contact Us — Darjeeling Stores" };

/** Same number the Help page and footer use. */
const PHONE_LABEL = "+91 90000 00002";
const PHONE_TEL = "+919000000002";
const WHATSAPP = "https://wa.me/919000000002?text=Hi%20Darjeeling%20Stores,%20I%20need%20help";

const TOPICS = [
  { title: "Track or change an order", text: "Open your order from My orders to follow it live, cancel before packing, or report a problem.", href: "/account/orders", cta: "My orders" },
  { title: "Refunds", text: "See the status of a refund you asked for, or read how refunds work.", href: "/account/refunds", cta: "My refunds" },
  { title: "Common questions", text: "Quick answers about delivery, payment and the delivery code.", href: "/help", cta: "Open FAQs" },
];

export default function ContactPage() {
  return (
    <main className="page-container policy">
      <Link href="/" className="policy-back">
        <Icon name="arrow-left" size={16} /> Back to home
      </Link>
      <h1>Contact us</h1>
      <p className="policy-intro">We are here to help with orders, payments, refunds or anything else. Pick the way that suits you best.</p>

      <div className="contact-grid">
        <a className="contact-card primary" href={`tel:${PHONE_TEL}`}>
          <span className="contact-ic">
            <Icon name="phone" size={22} color="var(--maroon)" />
          </span>
          <b>Call us</b>
          <span>{PHONE_LABEL}</span>
        </a>
        <a className="contact-card" href={WHATSAPP} target="_blank" rel="noopener noreferrer">
          <span className="contact-ic">
            <Icon name="message-circle" size={22} color="var(--maroon)" />
          </span>
          <b>Chat on WhatsApp</b>
          <span>Message us with your order number</span>
        </a>
      </div>

      <section className="policy-section">
        <h2>Before you contact us</h2>
        <p>Having these ready helps us help you faster: your order number, the phone number on your account and, for a problem with an item, a photo of it.</p>
      </section>

      <section className="policy-section">
        <h2>Quick help</h2>
        <div className="contact-topics">
          {TOPICS.map((t) => (
            <Link key={t.title} href={t.href} className="contact-topic">
              <b>{t.title}</b>
              <span>{t.text}</span>
              <em>
                {t.cta} <Icon name="arrow-right" size={14} />
              </em>
            </Link>
          ))}
        </div>
      </section>

      <section className="policy-section">
        <h2>Our policies</h2>
        <ul>
          <li>
            <Link href="/terms">Terms &amp; Conditions</Link>
          </li>
          <li>
            <Link href="/privacy">Privacy Policy</Link>
          </li>
          <li>
            <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>
          </li>
          <li>
            <Link href="/shipping-policy">Shipping &amp; Delivery Policy</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
