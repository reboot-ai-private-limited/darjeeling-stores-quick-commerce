import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "../../components/layout/PolicyPage";

export const metadata: Metadata = { title: "Refund & Cancellation Policy — Darjeeling Stores" };

const sections: PolicySection[] = [
  {
    title: "Cancelling an order",
    bullets: [
      "You can cancel an order until the store starts packing it. Open the order and tap Cancel order.",
      "Once your order is being packed or has been picked up by the delivery partner, it can no longer be cancelled from the app. Please contact us and we will do our best to help.",
      "If you paid online and the order is cancelled, the amount is refunded. A coupon used on the order is given back when the whole order is cancelled.",
    ],
  },
  {
    title: "When we refund you automatically",
    bullets: [
      "An item you ordered turns out to be unavailable.",
      "You paid after the payment window closed and we could not accept the order.",
      "You were charged more than the order amount.",
      "The order is cancelled after you paid online.",
    ],
  },
  {
    title: "Problems after delivery",
    paragraphs: ["If something is wrong with your order, open it and tap Report a problem. To keep this fair and quick:"],
    bullets: [
      "Tell us within 24 hours of delivery.",
      "Choose the item or items affected and the reason: damaged, missing, or another problem.",
      "Add a clear photo as proof. You can add up to 3 photos.",
      "Refunds after delivery apply to eligible categories, such as fresh and perishable items.",
    ],
  },
  {
    title: "Items that cannot be returned",
    paragraphs: [
      "Some items, such as eggs, cut vegetables and personal care products, are marked as non-returnable. We cannot take these back or refund them for a change of mind.",
      "If a non-returnable item arrives damaged or is missing, we will still refund it.",
    ],
  },
  {
    title: "How your request is reviewed",
    bullets: [
      "We check each request and approve it or decline it. If we decline it, we tell you the reason.",
      "You can follow the status (requested, approved, refunded or rejected) under My refunds in your account.",
      "You will get a message when your refund is processed.",
    ],
  },
  {
    title: "How and when you get the money",
    bullets: [
      "Online payments are refunded to the original payment method.",
      "For cash on delivery orders, we will refund by UPI or cash, as agreed with you.",
      "The time it takes to show up in your account depends on your bank or payment provider.",
      "You can only be refunded up to the amount you paid for the affected items.",
    ],
  },
  {
    title: "Need help?",
    paragraphs: ["If something is not right with your refund, contact us with your order number and we will look into it."],
  },
];

export default function RefundPolicyPage() {
  return (
    <PolicyPage
      title="Refund & Cancellation Policy"
      intro="We want you to be happy with every order. This page explains when you can cancel, when you are refunded and how to report a problem."
      sections={sections}
    />
  );
}
