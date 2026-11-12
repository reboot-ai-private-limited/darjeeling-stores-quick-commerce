import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "../../components/layout/PolicyPage";

export const metadata: Metadata = { title: "Terms & Conditions — Darjeeling Stores" };

const sections: PolicySection[] = [
  {
    title: "Using Darjeeling Stores",
    paragraphs: [
      "These terms apply when you browse or order on the Darjeeling Stores website or mobile app. By placing an order you agree to them.",
      "You must be able to enter into a binding contract to order. If you are under 18, please use the service with a parent or guardian.",
    ],
  },
  {
    title: "Your account",
    bullets: [
      "You sign in with your mobile number and a one-time code (OTP) sent by WhatsApp or SMS.",
      "Keep your phone and codes private. You are responsible for orders placed from your account.",
      "Give us correct details: name, delivery address, landmark and a phone number we can reach.",
    ],
  },
  {
    title: "Products, prices and availability",
    bullets: [
      "What you can buy depends on your delivery location. Items, prices and stock are shown for your area.",
      "Prices are shown in Indian rupees and include applicable taxes unless the bill says otherwise.",
      "Stock changes quickly. If an item sells out after you add it, we will tell you and it will not be charged.",
      "Pictures and descriptions are for guidance. Pack sizes, brands and appearance of fresh produce can vary slightly.",
    ],
  },
  {
    title: "Orders and bill",
    paragraphs: [
      "Your bill is shown before you place the order. It can include the item total, delivery fee, any surcharge for weather or late hours, a small-order or platform fee where applicable, taxes, discounts and an optional tip for the delivery partner.",
      "An order is confirmed when you see the order confirmation. We may cancel an order if an item is unavailable, the address is outside our delivery area, or we cannot verify the order. If you have already paid, you will be refunded.",
    ],
  },
  {
    title: "Payments",
    bullets: [
      "You can pay with cash on delivery, or online by UPI, debit or credit card, or netbanking.",
      "Online payments are processed by our payment provider. We do not see or store your card number or UPI PIN.",
      "For cash on delivery, please keep the exact amount ready.",
    ],
  },
  {
    title: "Delivery",
    paragraphs: [
      "Delivery times shown are estimates. Details on areas, timings and fees are in our Shipping & Delivery Policy.",
      "Each order has a 4-digit delivery code. Please share it only with the delivery partner at your door so that your order reaches the right person.",
    ],
  },
  {
    title: "Cancellations and refunds",
    paragraphs: ["You can cancel until the store starts packing your order. After delivery, you can report a problem for a short time. Our Refund & Cancellation Policy explains how this works."],
  },
  {
    title: "Coupons and offers",
    bullets: [
      "Coupons and offers have conditions, such as a minimum order value, first-order-only use, an expiry date or a usage limit. These are shown with the offer.",
      "Only one coupon can be used on an order, and a coupon has no cash value.",
      "We can change or withdraw an offer, and we can refuse a coupon that is misused.",
    ],
  },
  {
    title: "What we expect from you",
    bullets: [
      "Do not misuse the service, place false orders, or try to get around payments, offers or limits.",
      "Be respectful to our delivery partners and staff.",
      "Do not copy, scrape or interfere with the website or app.",
    ],
  },
  {
    title: "Our responsibility",
    paragraphs: [
      "We take care to deliver what you order, safe and on time. To the extent the law allows, we are not liable for delays or failures caused by things outside our control, such as bad weather, road closures, strikes or network problems, or for indirect losses.",
      "Nothing in these terms limits your rights under applicable consumer protection law.",
    ],
  },
  {
    title: "Privacy",
    paragraphs: ["How we handle your information is described in our Privacy Policy."],
  },
  {
    title: "Changes and governing law",
    paragraphs: [
      "We may update these terms from time to time. The date at the top shows when they were last changed. Continuing to use the service means you accept the updated terms.",
      "These terms are governed by the laws of India.",
    ],
  },
];

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms & Conditions"
      intro="Please read these terms before you use Darjeeling Stores. They explain how ordering, payment and delivery work and what we each can expect."
      sections={sections}
    />
  );
}
