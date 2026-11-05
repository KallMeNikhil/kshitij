import { Reveal } from "../immersive/Reveal";

export function SectionHeading({
  title,
  lead,
  centered = false,
}: {
  title: string;
  lead?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "section-heading section-heading--center" : "section-heading"}>
      <div className="section-heading__body">
        <h2 className="section-heading__title">
          <Reveal variant="mask" viewportMargin="0px">{title}</Reveal>
        </h2>
        {lead && <p className="section-heading__lead">{lead}</p>}
      </div>
      <hr className="section-heading__rule" />
    </div>
  );
}
