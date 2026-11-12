import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "../../components/layout/PolicyPage";

export const metadata: Metadata = { title: "Shipping & Delivery Policy — Darjeeling Stores" };

const sections: PolicySection[] = [
  {
    title: "Where we deliver",
    paragraphs: [
      "We deliver to areas around our stores. When you choose your location, we check whether we can deliver there and show you what is available in your area.",
      "If we do not deliver to you yet, you can leave your number on the waitlist and we will let you know when we do.",
    ],
  },
  {
    title: "Delivery time",
    bullets: [
      "Most orders arrive within the time shown at the top of the website and at checkout, for example 15-20 minutes.",
      "The time is an estimate. It can change with the distance, how busy the store is, the weather and traffic.",
      "You can follow your delivery partner live on the tracking page.",
    ],
  },
  {
    title: "Store hours and pre-orders",
    paragraphs: [
      "When the store is closed or paused, a banner tells you. If pre-orders are available, you can choose a delivery slot for later instead of Deliver now.",
    ],
  },
  {
    title: "Delivery charges",
    bullets: [
      "Any delivery fee, small-order fee and surcharge is shown in your bill before you pay. Nothing is added after you place the order.",
      "Some areas offer free delivery above a certain order value. The progress bar in your cart shows how much more you need to add.",
      "A surcharge may apply in bad weather or late at night. We show a notice on the home page when it does.",
      "A tip for the delivery partner is optional and goes to them in full.",
    ],
  },
  {
    title: "Your address",
    bullets: [
      "Please give a complete address with a landmark. A house photo and a short voice note help the delivery partner find you.",
      "Make sure your phone is on and you can take a call near the delivery time.",
    ],
  },
  {
    title: "Receiving your order",
    bullets: [
      "Each order has a 4-digit delivery code, shown on your order and tracking page.",
      "Tell the code to the delivery partner only when you receive your order.",
      "For cash on delivery, please keep the exact amount ready.",
    ],
  },
  {
    title: "Orders from more than one store",
    paragraphs: ["If your items come from more than one store, your order may be split into separate deliveries. You can see each one on your order page. The bill stays one single bill."],
  },
  {
    title: "If we cannot deliver",
    bullets: [
      "If we cannot reach you or find the address, the delivery partner will try to contact you.",
      "If an order cannot be delivered, it is marked as a failed delivery. Contact us and we will help sort it out. If you paid online, you are refunded in line with our Refund & Cancellation Policy where it applies.",
    ],
  },
];

export default function ShippingPolicyPage() {
  return (
    <PolicyPage
      title="Shipping & Delivery Policy"
      intro="Here is how we deliver: where, how fast, what it costs and what we need from you to get your order to your door."
      sections={sections}
    />
  );
}
