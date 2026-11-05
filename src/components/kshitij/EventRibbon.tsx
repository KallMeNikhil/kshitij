import { Marquee } from "../immersive/Marquee";
import { SportIcon } from "./SportIcon";
import { useAnnouncements } from "../../hooks/useFirestoreData";
import { usePublicDetails, usePublicSports } from "../../lib/PublicDataContext";
import { siteContent } from "../../config/siteContent";

export function EventRibbon() {
  const sports = usePublicSports() ?? [];
  const { eventLabel, tagline } = usePublicDetails();
  const phrases = [siteContent.eventName, eventLabel, tagline];
  const latest = useAnnouncements(1)?.[0] ?? null;
  const items = phrases.flatMap((text, i) => {
    const sport = sports.length > 0 ? sports[i % sports.length] : null;
    const announcement =
      i === 0 && latest
        ? [
            <span className="event-ribbon__announce" key="a">
              <span className="event-ribbon__tag">Latest</span>
              <strong>{latest.title}</strong>
              <span>{latest.body}</span>
            </span>,
            <span className="event-ribbon__mark" key="am" aria-hidden="true">
              <span className="event-ribbon__diamond" />
            </span>,
          ]
        : [];
    return [
      <span className={`event-ribbon__text ${i % 2 === 1 ? "is-outline" : ""}`} key={`t${i}`}>
        {text}
      </span>,
      <span className="event-ribbon__mark" key={`m${i}`} aria-hidden="true">
        {sport ? <SportIcon slug={sport.slug} size={20} /> : <span className="event-ribbon__diamond" />}
      </span>,
      ...announcement,
    ];
  });

  return (
    <section className="event-ribbon" aria-label={`${siteContent.eventName}. ${eventLabel}. ${tagline}.${latest ? ` Latest announcement: ${latest.title}. ${latest.body}` : ""}`}>
      <Marquee items={items} durationSeconds={36} />
    </section>
  );
}
