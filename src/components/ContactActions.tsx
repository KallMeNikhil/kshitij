export function ContactActions({ phone, name }: { phone: string; name: string }) {
  const digits = phone.replace(/\D/g, "");
  return (
    <div className="contact-actions">
      <a className="contact-actions__link" href={`tel:${phone}`} aria-label={`Call ${name}`}>
        Call
      </a>
      <a
        className="contact-actions__link"
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp ${name}`}
      >
        WhatsApp
      </a>
    </div>
  );
}
