import { Link } from "react-router-dom";
import { usePublicDetails, usePublicSports } from "../../lib/PublicDataContext";
import { SportIcon } from "./SportIcon";

const scrollToTop = () => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, left: 0, behavior: reduced ? "instant" : "smooth" });
};

export function KshitijFooter() {
  const { contact, footerNote } = usePublicDetails();
  const sports = usePublicSports() ?? [];
  const hasContact = Boolean(contact.email || contact.phone);

  return (
    <footer className="kshitij-footer">
      <div className="container kshitij-footer__inner">
        <Link to="/" className="kshitij-footer__brand">
          KSHITIJ
        </Link>
        <div className="kshitij-footer__row">
          <div className="kshitij-footer__tag">
            {sports.length > 0 && (
              <div className="kshitij-footer__sports" aria-hidden="true">
                {sports.map((s) => (
                  <SportIcon key={s.sportId} slug={s.slug} size={18} />
                ))}
              </div>
            )}
            <p className="kshitij-footer__note">{footerNote}</p>
          </div>

          <div className={`kshitij-footer__aside${hasContact ? " kshitij-footer__aside--contact" : ""}`}>
            {hasContact && (
              <div className="kshitij-footer__contact">
                {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
              </div>
            )}
            <button type="button" className="kshitij-footer__top" aria-label="Back to top" onClick={scrollToTop}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
