import React from "react";
import Link from "next/link";
import { Icon } from "../ui/Icon";

export type PolicySection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

interface PolicyPageProps {
  title: string;
  intro: string;
  updated?: string;
  sections: PolicySection[];
}

/** Policy pages other than Contact share this layout: a title, a short intro and numbered sections. */
export const PolicyPage: React.FC<PolicyPageProps> = ({ title, intro, updated = "12 November 2026", sections }) => (
  <main className="page-container policy">
    <Link href="/" className="policy-back">
      <Icon name="arrow-left" size={16} /> Back to home
    </Link>
    <h1>{title}</h1>
    <p className="policy-updated">Last updated: {updated}</p>
    <p className="policy-intro">{intro}</p>

    {sections.map((s, i) => (
      <section key={s.title} className="policy-section">
        <h2>
          {i + 1}. {s.title}
        </h2>
        {s.paragraphs?.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {s.bullets && (
          <ul>
            {s.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </section>
    ))}

    <div className="policy-help">
      <b>Questions about this page?</b>
      <span>
        Visit <Link href="/contact">Contact us</Link> or the <Link href="/help">Help &amp; support</Link> centre.
      </span>
    </div>
  </main>
);
