import type { FailReason, ProblemType } from "./api/rider";

/** What the rider picks on screen, and the value the API expects. */
export const FAIL_REASONS: { label: string; value: FailReason }[] = [
  { label: "Customer not reachable", value: "customer_unreachable" },
  { label: "Customer refused the order", value: "refused" },
  { label: "Wrong or incomplete address", value: "wrong_address" },
  { label: "Road blocked", value: "road_blocked" },
  { label: "Bad weather", value: "weather" },
  { label: "Something else", value: "other" },
];

export const PROBLEM_REASONS: { label: string; value: ProblemType }[] = [
  { label: "Bike trouble", value: "vehicle_issue" },
  { label: "Road blocked", value: "road_blocked" },
  { label: "Problem with the customer", value: "customer_issue" },
  { label: "Something else", value: "other" },
];
