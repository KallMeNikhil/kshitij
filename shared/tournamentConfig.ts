import { z } from "zod";

export const tournamentConfigurationSchema = z
  .object({
    seeding: z.enum(["MANUAL", "RANDOM", "RANKING"]).default("MANUAL"),
    byePolicy: z.enum(["TOP_SEEDS"]).default("TOP_SEEDS"),
  })
  .strict();

export type TournamentConfiguration = z.infer<typeof tournamentConfigurationSchema>;

export const defaultTournamentConfiguration: TournamentConfiguration = {
  seeding: "MANUAL",
  byePolicy: "TOP_SEEDS",
};
