import { generateBracket, type Entrant } from "../../shared/bracket";
import type {
  SportDoc,
  CompetitionDoc,
  ParticipantDoc,
  TeamDoc,
  FixtureDoc,
  MatchStateDoc,
} from "../../shared/types";
import { emptySetsPointsState, incrementPoint } from "../../shared/scoring/sets-points";
import { emptyCricketState } from "../../shared/scoring/cricket-innings";
import { emptyFootballState, addEvent } from "../../shared/scoring/football-events";
import { emptyBasketballState, addPoints } from "../../shared/scoring/basketball-points";
import { emptyTennisState, winPoint } from "../../shared/scoring/tennis-sets-games";

const COLLEGES = [
  "NIT Jaipur",
  "IIT Mandi",
  "BITS Pilani",
  "LNMIIT Jaipur",
  "MNIT Jaipur",
  "IIIT Kota",
  "SKIT Jaipur",
  "Poornima College of Engineering, Sitapura Campus",
];

let phoneCounter = 9800000001;
function nextPhone(): string {
  return String(phoneCounter++);
}

function person(name: string, college: string, sportId: string, competitionId: string, idSuffix: string): ParticipantDoc {
  return {
    participantId: `${competitionId}-${idSuffix}`,
    name,
    phone: nextPhone(),
    college,
    sportId,
    competitionId,
  };
}

const FIRST_NAMES = ["Arjun", "Riya", "Kabir", "Ishaan", "Ananya", "Vivaan", "Diya", "Reyansh", "Myra", "Aarav", "Zara", "Kian"];
const LAST_NAMES = ["Sharma", "Patel", "Mehta", "Iyer", "Reddy", "Nair", "Gupta", "Chauhan", "Bose", "Verma"];

function randomName(i: number): string {
  return `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 3) % LAST_NAMES.length]}`;
}

export interface DemoBundle {
  sports: SportDoc[];
  competitions: CompetitionDoc[];
  participants: ParticipantDoc[];
  teams: TeamDoc[];
  fixtures: FixtureDoc[];
  matchStates: MatchStateDoc[];
  announcements: { title: string; body: string; sportId: string | null }[];
}

function buildBracketWithStates(
  competitionId: string,
  sportId: string,
  entrants: Entrant[],
  applyLiveAndCompleted: (fixtures: FixtureDoc[], matchStates: MatchStateDoc[]) => void
): { fixtures: FixtureDoc[]; matchStates: MatchStateDoc[] } {
  const { fixtures } = generateBracket(competitionId, sportId, entrants);
  fixtures.forEach((f) => {
    if (f.status === "DRAFT") f.status = "SCHEDULED";
  });
  const matchStates: MatchStateDoc[] = [];
  applyLiveAndCompleted(fixtures, matchStates);
  return { fixtures, matchStates };
}

export function generateDemoData(): DemoBundle {
  const sports: SportDoc[] = [
    { sportId: "badminton", name: "Badminton", slug: "badminton", scoringModel: "SETS_POINTS", displayOrder: 1, active: true },
    { sportId: "table-tennis", name: "Table Tennis", slug: "table-tennis", scoringModel: "SETS_POINTS", displayOrder: 2, active: true },
    { sportId: "tennis", name: "Tennis", slug: "tennis", scoringModel: "TENNIS_SETS_GAMES", displayOrder: 3, active: true },
    { sportId: "volleyball", name: "Volleyball", slug: "volleyball", scoringModel: "SETS_POINTS", displayOrder: 4, active: true },
    { sportId: "basketball", name: "Basketball", slug: "basketball", scoringModel: "BASKETBALL_POINTS", displayOrder: 5, active: true },
    { sportId: "football", name: "Football", slug: "football", scoringModel: "FOOTBALL_EVENTS", displayOrder: 6, active: true },
    { sportId: "cricket", name: "Cricket", slug: "cricket", scoringModel: "CRICKET_INNINGS", displayOrder: 7, active: true },
    { sportId: "chess", name: "Chess", slug: "chess", scoringModel: "RESULT_ONLY", displayOrder: 8, active: true },
    { sportId: "carrom", name: "Carrom", slug: "carrom", scoringModel: "RESULT_ONLY", displayOrder: 9, active: true },
  ];

  const competitions: CompetitionDoc[] = [];
  const participants: ParticipantDoc[] = [];
  const teams: TeamDoc[] = [];
  const fixtures: FixtureDoc[] = [];
  const matchStates: MatchStateDoc[] = [];

  let nameIdx = 0;
  const genName = () => randomName(nameIdx++);

  const badmintonCategories: { key: string; name: string; gender: CompetitionDoc["gender"]; type: "INDIVIDUAL" | "PAIR" }[] = [
    { key: "mens-singles", name: "Men's Singles", gender: "MEN", type: "INDIVIDUAL" },
    { key: "womens-singles", name: "Women's Singles", gender: "WOMEN", type: "INDIVIDUAL" },
    { key: "mens-doubles", name: "Men's Doubles", gender: "MEN", type: "PAIR" },
    { key: "womens-doubles", name: "Women's Doubles", gender: "WOMEN", type: "PAIR" },
    { key: "mixed-doubles", name: "Mixed Doubles", gender: "MIXED", type: "PAIR" },
  ];

  badmintonCategories.forEach((cat, idx) => {
    const competitionId = `badminton-${cat.key}`;
    competitions.push({
      competitionId,
      sportId: "badminton",
      name: cat.name,
      categoryKey: cat.key,
      gender: cat.gender,
      participantType: cat.type,
      format: "KNOCKOUT",
      scoring: { bestOf: 3, pointsToWin: 21, capPoints: 30 },
      published: true,
      displayOrder: idx,
    });

    if (cat.type === "INDIVIDUAL") {
      const entrantCount = idx === 0 ? 5 : 8;
      const localParticipants: ParticipantDoc[] = [];
      for (let i = 0; i < entrantCount; i++) {
        const p = person(genName(), COLLEGES[i % COLLEGES.length], "badminton", competitionId, `p${i + 1}`);
        localParticipants.push(p);
        participants.push(p);
      }
      const entrants: Entrant[] = localParticipants.map((p) => ({ id: p.participantId, kind: "PARTICIPANT" }));
      const { fixtures: fx, matchStates: ms } = buildBracketWithStates(competitionId, "badminton", entrants, (built) => {
        const r1a = built.find((f) => f.round === 1)!;
        r1a.status = "LIVE";
        const state = incrementPoint(incrementPoint(emptySetsPointsState(), "A", { bestOf: 3, pointsToWin: 21, capPoints: 30 }), "B", {
          bestOf: 3,
          pointsToWin: 21,
          capPoints: 30,
        });
        matchStates.push({ fixtureId: r1a.fixtureId, scoringModel: "SETS_POINTS", version: 1, data: state as unknown as Record<string, unknown> });
      });
      fixtures.push(...fx);
      matchStates.push(...ms);
    } else {
      const teamCount = 4;
      for (let t = 0; t < teamCount; t++) {
        const college = COLLEGES[t % COLLEGES.length];
        const memberA = person(genName(), college, "badminton", competitionId, `t${t + 1}-p1`);
        const memberB = person(genName(), college, "badminton", competitionId, `t${t + 1}-p2`);
        participants.push(memberA, memberB);
        const team: TeamDoc = {
          teamId: `${competitionId}-team-${t + 1}`,
          teamName: `${college} ${cat.name} Pair ${t + 1}`,
          sportId: "badminton",
          competitionId,
          college,
          captainParticipantId: memberA.participantId,
          memberIds: [memberA.participantId, memberB.participantId],
        };
        teams.push(team);
      }
      const entrants: Entrant[] = teams
        .filter((t) => t.competitionId === competitionId)
        .map((t) => ({ id: t.teamId, kind: "TEAM" }));
      const { fixtures: fx } = buildBracketWithStates(competitionId, "badminton", entrants, () => {});
      fixtures.push(...fx);
    }
  });

  const ttCat = { key: "mens-singles", name: "Men's Singles", gender: "MEN" as const };
  const ttCompetitionId = "table-tennis-mens-singles";
  competitions.push({
    competitionId: ttCompetitionId,
    sportId: "table-tennis",
    name: ttCat.name,
    categoryKey: ttCat.key,
    gender: ttCat.gender,
    participantType: "INDIVIDUAL",
    format: "KNOCKOUT",
    scoring: { bestOf: 5, pointsToWin: 11, capPoints: 21 },
    published: true,
    displayOrder: 0,
  });
  {
    const localParticipants: ParticipantDoc[] = [];
    for (let i = 0; i < 4; i++) {
      const p = person(genName(), COLLEGES[i % COLLEGES.length], "table-tennis", ttCompetitionId, `p${i + 1}`);
      localParticipants.push(p);
      participants.push(p);
    }
    const entrants: Entrant[] = localParticipants.map((p) => ({ id: p.participantId, kind: "PARTICIPANT" }));
    const { fixtures: fx } = buildBracketWithStates(ttCompetitionId, "table-tennis", entrants, (built) => {
      const final = built.find((f) => f.round === 2)!;
      final.status = "COMPLETED";
      matchStates.push({
        fixtureId: final.fixtureId,
        scoringModel: "SETS_POINTS",
        version: 3,
        data: { sets: [{ a: 11, b: 6, completed: true }, { a: 9, b: 11, completed: true }, { a: 11, b: 8, completed: true }], currentSet: 2 },
        result: { winnerSlot: "A", decidedBy: "SETS_POINTS", summary: "11-6, 9-11, 11-8" },
      });
    });
    fixtures.push(...fx);
  }

  const tennisCompetitionId = "tennis-singles";
  competitions.push({
    competitionId: tennisCompetitionId,
    sportId: "tennis",
    name: "Singles",
    categoryKey: "singles",
    gender: null,
    participantType: "INDIVIDUAL",
    format: "KNOCKOUT",
    scoring: { bestOf: 3 },
    published: true,
    displayOrder: 0,
  });
  {
    const localParticipants: ParticipantDoc[] = [];
    for (let i = 0; i < 3; i++) {
      const p = person(genName(), COLLEGES[i % COLLEGES.length], "tennis", tennisCompetitionId, `p${i + 1}`);
      localParticipants.push(p);
      participants.push(p);
    }
    const entrants: Entrant[] = localParticipants.map((p) => ({ id: p.participantId, kind: "PARTICIPANT" }));
    const { fixtures: fx } = buildBracketWithStates(tennisCompetitionId, "tennis", entrants, (built) => {
      const playedR1 = built.find((f) => f.round === 1 && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE");
      if (playedR1) {
        playedR1.status = "LIVE";
        let state = emptyTennisState(3);
        state = winPoint(state, "A");
        state = winPoint(state, "A");
        matchStates.push({ fixtureId: playedR1.fixtureId, scoringModel: "TENNIS_SETS_GAMES", version: 1, data: state as unknown as Record<string, unknown> });
      }
    });
    fixtures.push(...fx);
  }

  for (const sportId of ["volleyball", "basketball"] as const) {
    for (const genderCat of [
      { key: "mens-team", name: "Men's Team", gender: "MEN" as const },
      { key: "girls-team", name: "Girls' Team", gender: "WOMEN" as const },
    ]) {
      const competitionId = `${sportId}-${genderCat.key}`;
      competitions.push({
        competitionId,
        sportId,
        name: genderCat.name,
        categoryKey: genderCat.key,
        gender: genderCat.gender,
        participantType: "TEAM",
        format: "KNOCKOUT",
        teamSize: { min: 6, max: 12 },
        scoring: sportId === "volleyball" ? { bestOf: 3, pointsToWin: 25, capPoints: 30 } : { quarters: 4, quarterMinutes: 10 },
        published: true,
        displayOrder: 0,
      });

      const isEmptyCategory = sportId === "basketball" && genderCat.key === "girls-team";
      if (!isEmptyCategory) {
        const teamCount = 4;
        const localTeams: TeamDoc[] = [];
        for (let t = 0; t < teamCount; t++) {
          const college = COLLEGES[t % COLLEGES.length];
          const memberIds: string[] = [];
          const rosterSize = 7;
          for (let m = 0; m < rosterSize; m++) {
            const p = person(genName(), college, sportId, competitionId, `t${t + 1}-p${m + 1}`);
            participants.push(p);
            memberIds.push(p.participantId);
          }
          const team: TeamDoc = {
            teamId: `${competitionId}-team-${t + 1}`,
            teamName: t === 0 ? `${college} Titans (Extended Squad Name For Overflow Testing)` : `${college} ${sportId === "volleyball" ? "Spikers" : "Ballers"}`,
            sportId,
            competitionId,
            college,
            captainParticipantId: memberIds[0],
            memberIds,
          };
          teams.push(team);
          localTeams.push(team);
        }
        const entrants: Entrant[] = localTeams.map((t) => ({ id: t.teamId, kind: "TEAM" }));
        const { fixtures: fx } = buildBracketWithStates(competitionId, sportId, entrants, (built) => {
          const r1 = built.find((f) => f.round === 1 && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE");
          if (r1) {
            r1.status = "LIVE";
            if (sportId === "basketball") {
              let state = emptyBasketballState();
              state = addPoints(state, "A", 3);
              state = addPoints(state, "B", 2);
              matchStates.push({ fixtureId: r1.fixtureId, scoringModel: "BASKETBALL_POINTS", version: 1, data: state as unknown as Record<string, unknown> });
            } else {
              const state = incrementPoint(emptySetsPointsState(), "A", { bestOf: 3, pointsToWin: 25, capPoints: 30 });
              matchStates.push({ fixtureId: r1.fixtureId, scoringModel: "SETS_POINTS", version: 1, data: state as unknown as Record<string, unknown> });
            }
          }
        });
        fixtures.push(...fx);
      }
    }
  }

  const footballCompetitionId = "football-team";
  competitions.push({
    competitionId: footballCompetitionId,
    sportId: "football",
    name: "Football",
    categoryKey: "team",
    gender: null,
    participantType: "TEAM",
    format: "KNOCKOUT",
    teamSize: { min: 11, max: 18 },
    published: true,
    displayOrder: 0,
  });
  {
    const teamCount = 4;
    const localTeams: TeamDoc[] = [];
    for (let t = 0; t < teamCount; t++) {
      const college = COLLEGES[t % COLLEGES.length];
      const memberIds: string[] = [];
      for (let m = 0; m < 11; m++) {
        const p = person(genName(), college, "football", footballCompetitionId, `t${t + 1}-p${m + 1}`);
        participants.push(p);
        memberIds.push(p.participantId);
      }
      const team: TeamDoc = {
        teamId: `${footballCompetitionId}-team-${t + 1}`,
        teamName: `${college} FC`,
        sportId: "football",
        competitionId: footballCompetitionId,
        college,
        captainParticipantId: memberIds[0],
        memberIds,
      };
      teams.push(team);
      localTeams.push(team);
    }
    const entrants: Entrant[] = localTeams.map((t) => ({ id: t.teamId, kind: "TEAM" }));
    const { fixtures: fx } = buildBracketWithStates(footballCompetitionId, "football", entrants, (built) => {
      const r1Live = built.find((f) => f.round === 1 && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE");
      if (r1Live) {
        r1Live.status = "LIVE";
        const teamA = localTeams.find((t) => t.teamId === r1Live.slotA.teamId)!;
        const teamB = localTeams.find((t) => t.teamId === r1Live.slotB.teamId)!;
        let state = emptyFootballState();
        state = addEvent(state, { id: "e1", type: "GOAL", side: "A", playerId: teamA.memberIds[9], minute: 23 });
        state = addEvent(state, { id: "e2", type: "YELLOW_CARD", side: "B", playerId: teamB.memberIds[4], minute: 41 });
        matchStates.push({ fixtureId: r1Live.fixtureId, scoringModel: "FOOTBALL_EVENTS", version: 1, data: state as unknown as Record<string, unknown> });
      }
      const r1Second = built.filter((f) => f.round === 1 && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE")[1];
      if (r1Second) {
        r1Second.status = "COMPLETED";
        const teamA = localTeams.find((t) => t.teamId === r1Second.slotA.teamId)!;
        let state = emptyFootballState();
        state = addEvent(state, { id: "e3", type: "GOAL", side: "A", playerId: teamA.memberIds[7], minute: 12 });
        state = addEvent(state, { id: "e4", type: "GOAL", side: "A", playerId: teamA.memberIds[9], minute: 65 });
        state = addEvent(state, { id: "e5", type: "RED_CARD", side: "B", playerId: teamA.memberIds[2], minute: 70 });
        matchStates.push({
          fixtureId: r1Second.fixtureId,
          scoringModel: "FOOTBALL_EVENTS",
          version: 3,
          data: state as unknown as Record<string, unknown>,
          result: { winnerSlot: "A", decidedBy: "FOOTBALL_EVENTS", summary: "2-0" },
        });
      }
    });
    fixtures.push(...fx);
  }

  const cricketCompetitionId = "cricket-team";
  competitions.push({
    competitionId: cricketCompetitionId,
    sportId: "cricket",
    name: "Cricket",
    categoryKey: "team",
    gender: null,
    participantType: "TEAM",
    format: "KNOCKOUT",
    teamSize: { min: 11, max: 16 },
    scoring: { oversPerInnings: 12 },
    published: true,
    displayOrder: 0,
  });
  {
    const teamCount: number = 3;
    const localTeams: TeamDoc[] = [];
    for (let t = 0; t < teamCount; t++) {
      const college = COLLEGES[t % COLLEGES.length];
      const memberIds: string[] = [];
      for (let m = 0; m < 11; m++) {
        const p = person(genName(), college, "cricket", cricketCompetitionId, `t${t + 1}-p${m + 1}`);
        participants.push(p);
        memberIds.push(p.participantId);
      }
      const team: TeamDoc = {
        teamId: `${cricketCompetitionId}-team-${t + 1}`,
        teamName: `${college} XI`,
        sportId: "cricket",
        competitionId: cricketCompetitionId,
        college,
        captainParticipantId: memberIds[0],
        memberIds,
      };
      teams.push(team);
      localTeams.push(team);
    }
    const entrants: Entrant[] = localTeams.map((t) => ({ id: t.teamId, kind: "TEAM" }));
    const { fixtures: fx } = buildBracketWithStates(cricketCompetitionId, "cricket", entrants, (built) => {
      const r1Live = built.find((f) => f.round === 1 && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE");
      if (r1Live) {
        r1Live.status = "LIVE";
        const state = emptyCricketState(12, "A");
        state.innings1.runs = 98;
        state.innings1.wickets = 6;
        state.innings1.oversCompleted = 12;
        state.currentInnings = 2;
        state.innings2.runs = 40;
        state.innings2.wickets = 2;
        state.innings2.oversCompleted = 6;
        state.innings2.ballsInOver = 2;
        matchStates.push({ fixtureId: r1Live.fixtureId, scoringModel: "CRICKET_INNINGS", version: 1, data: state as unknown as Record<string, unknown> });
      }
    });
    fixtures.push(...fx);
  }

  for (const sportId of ["chess", "carrom"] as const) {
    const competitionId = `${sportId}-open`;
    competitions.push({
      competitionId,
      sportId,
      name: "Open",
      categoryKey: "open",
      gender: null,
      participantType: "INDIVIDUAL",
      format: "KNOCKOUT",
      published: true,
      displayOrder: 0,
    });
    const localParticipants: ParticipantDoc[] = [];
    for (let i = 0; i < 6; i++) {
      const p = person(genName(), COLLEGES[i % COLLEGES.length], sportId, competitionId, `p${i + 1}`);
      localParticipants.push(p);
      participants.push(p);
    }
    const entrants: Entrant[] = localParticipants.map((p) => ({ id: p.participantId, kind: "PARTICIPANT" }));
    const { fixtures: fx } = buildBracketWithStates(competitionId, sportId, entrants, (built) => {
      const completed = built.find((f) => f.round === 1 && f.status === "SCHEDULED" && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE");
      if (completed) {
        completed.status = "COMPLETED";
        matchStates.push({
          fixtureId: completed.fixtureId,
          scoringModel: "RESULT_ONLY",
          version: 1,
          data: { outcome: "A" },
          result: { winnerSlot: "A", decidedBy: "RESULT_ONLY", summary: `${sportId === "chess" ? "Checkmate" : "Won"}` },
        });
      }
    });
    fixtures.push(...fx);
  }

  const announcements = [
    { title: "Opening Ceremony", body: "Kshitij opens Friday 5 PM at the Main Ground.", sportId: null },
    { title: "Football Schedule Update", body: "Round 1 football fixtures moved to the East Ground due to rain.", sportId: "football" },
  ];

  return { sports, competitions, participants, teams, fixtures, matchStates, announcements };
}
