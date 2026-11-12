import type { Metadata } from "next";
import { PolicyPage, type PolicySection } from "../../components/layout/PolicyPage";

export const metadata: Metadata = { title: "Privacy Policy — Darjeeling Stores" };

const sections: PolicySection[] = [
  {
    title: "What this policy covers",
    paragraphs: ["This policy explains what personal information Darjeeling Stores collects when you use our website or app, why we collect it, who we share it with and what choices you have."],
  },
  {
    title: "Information we collect",
    bullets: [
      "Account details: your mobile number, and your name and email if you add them.",
      "Delivery details: addresses, landmark, PIN code, contact name and phone, and, if you choose to add them, a photo of your house or a short voice note for the delivery partner.",
      "Location: the place you pick on the map, or your device location if you allow it, so we can check that we deliver to you and show the right store.",
      "Orders and payments: what you ordered, the bill, payment method and payment status. Card and UPI details are entered with our payment provider; we do not store them.",
      "Help requests: messages, refund requests and any photos you send as proof of damage.",
      "Device and usage: basic device information when you sign in, and cookies that keep you signed in and remember your cart and location.",
    ],
  },
  {
    title: "How we use it",
    bullets: [
      "To sign you in, send one-time codes and keep your account secure.",
      "To take, pack, deliver and track your orders, and to take payments and issue refunds.",
      "To tell you about your order by notification, WhatsApp or SMS.",
      "To give support, handle problems and prevent fraud or misuse.",
      "To improve our range, prices and service.",
      "To send offers, only if you have turned this on. You can change this in Notification settings.",
    ],
  },
  {
    title: "Who we share it with",
    bullets: [
      "Delivery partners: your name, phone number, address, landmark and any delivery notes, only so they can deliver your order.",
      "Payment provider: the details needed to take or refund an online payment.",
      "Messaging providers: your phone number, to send one-time codes and order updates by WhatsApp or SMS.",
      "Technology and hosting providers that run our systems for us, under confidentiality obligations.",
      "Authorities, when the law requires it or to protect our rights and the safety of others.",
    ],
    paragraphs: ["We do not sell your personal information."],
  },
  {
    title: "How long we keep it",
    paragraphs: [
      "We keep your information for as long as your account is open and as needed to run the service, meet tax and accounting rules and settle disputes. Photos you send as proof for a refund are kept for a limited time after the order closes and are then deleted.",
    ],
  },
  {
    title: "Cookies",
    paragraphs: [
      "We use cookies and similar storage to keep you signed in, remember your delivery location and keep items in your cart. You can clear them in your browser, but parts of the site may then not work.",
    ],
  },
  {
    title: "Your choices and rights",
    bullets: [
      "See and update your name, email and addresses in your account.",
      "Turn offers and reminders on or off in Notification settings.",
      "Ask us to delete your account from Help & support. We will remove or anonymise your information, except what we must keep by law, such as order and tax records.",
      "Contact us if you want a copy of your information or think something is wrong.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "We use reasonable safeguards to protect your information. Orders are confirmed with a one-time code and a delivery code. No system is completely secure, so please keep your phone and codes private.",
    ],
  },
  {
    title: "Children",
    paragraphs: ["Our service is not meant for children under 13, and we do not knowingly collect their information."],
  },
  {
    title: "Changes to this policy",
    paragraphs: ["We may update this policy. The date at the top shows the latest version. If a change is important, we will tell you in the app or on the website."],
  },
];

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      intro="Your privacy matters to us. This page explains in plain words what we collect, why, and how you stay in control."
      sections={sections}
    />
  );
}
