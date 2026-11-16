import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "../../components/layout/PolicyPage";
import { DeleteAccountPanel } from "./DeleteAccountPanel";

export const metadata: Metadata = { title: "Delete your account — Darjeeling Stores" };

const sections: PolicySection[] = [
  {
    title: "How to delete your account in the app",
    bullets: [
      "Open the Darjeeling Stores app and sign in.",
      "Go to the Account tab and tap Delete account (you can also find it under Help & support).",
      "Read what will happen, tick the box to confirm and tap Delete my account.",
    ],
  },
  {
    title: "If you cannot use the app",
    paragraphs: [
      "Call or message us on WhatsApp from the Contact us page, from the phone number you use with Darjeeling Stores. We will check it is you and then start the deletion for you.",
    ],
  },
  {
    title: "What happens next",
    bullets: [
      "You are signed out on every device straight away, and codes and notifications for your account stop.",
      "If an order is still being delivered, we finish the deletion after it is delivered.",
      "When we finish, your name is replaced with \"Deleted customer\" and your phone number and email are removed, so the number can be used to register again later.",
    ],
  },
  {
    title: "What we delete",
    bullets: [
      "Your name, mobile number and email.",
      "Your saved addresses, including any house photo or voice note you added.",
      "Your cart, favourites, notification settings and device tokens used for notifications.",
    ],
  },
  {
    title: "What we keep, and why",
    paragraphs: [
      "We keep order, payment and invoice records because tax and accounting rules require it. After the deletion is finished these records are no longer linked to your name or phone number. Photos you sent as proof for a refund are removed after the retention period described in our Privacy policy.",
    ],
  },
];

export default function DeleteAccountPage() {
  return (
    <PolicyPage
      title="Delete your account"
      intro="You can ask us to delete your Darjeeling Stores account and the personal information linked to it at any time. This page explains how, what we delete and what we keep."
      sections={sections}
    >
      <h2 style={{ fontSize: 20, margin: "28px 0 4px" }}>Delete your account now</h2>
      <DeleteAccountPanel />
    </PolicyPage>
  );
}
