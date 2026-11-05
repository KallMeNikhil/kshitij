import { useTeamRoster } from "../hooks/useEntity";
import { ContactActions } from "./ContactActions";
import type { TeamDoc } from "../../shared/types";

export function TeamRoster({ team }: { team: TeamDoc }) {
  const roster = useTeamRoster(team.teamId);
  const captain = roster.find((p) => p.participantId === team.captainParticipantId);

  return (
    <div className="team-roster">
      <div className="team-roster__header">
        <h4>{team.teamName}</h4>
        <span className="team-roster__college">{team.college}</span>
      </div>
      {captain && (
        <div className="team-roster__captain">
          <span className="team-roster__captain-label">Captain</span>
          <span>{captain.name}</span>
          <ContactActions phone={captain.phone} name={captain.name} />
        </div>
      )}
      <ul className="team-roster__members">
        {roster.map((p) => (
          <li key={p.participantId} className={p.participantId === team.captainParticipantId ? "is-captain" : ""}>
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
