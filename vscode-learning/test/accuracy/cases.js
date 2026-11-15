"use strict";

const field = (page, quote) => ({ file: "field.pdf", page, quote });
const replication = quote => ({ file: "replication.pdf", page: 1, quote });
const visual = (page, quote) => ({ file: "visuals.pdf", page, quote });
const scan = quote => ({ file: "scan.pdf", page: 1, quote });
const eligibility = field(6, "Study eligibility was limited to adults over age 65.");
const enrollment = field(6, "The trial enrolled 48 people and followed them for six weeks.");
const intervention = field(6, "The intervention group improved by 12 points on the test.");
const control = field(6, "The comparison group improved by 7 points on the same test.");
const scope = field(6, "The trial did not measure long-term outcomes.");
const cautious = field(6, "The authors described the findings as preliminary.");
const replicationEligibility = replication("Study eligibility included adults ages 18 through 25.");
const replicationMeasure = replication("The intervention group improved by 3 points.");
const replicationControl = replication("The comparison group improved by 4 points.");
const replicationConclusion = replication("The authors did not find evidence of an intervention benefit.");
const travel = field(7, "Travel time fell by 8%.");
const fuel = field(7, "Fuel use rose by 8%.");
const condition = field(8, "The alert triggers only if x < y and y > z.");
const limit = field(8, "The sensor limit is 5 mg, equivalent to 5000 micrograms.");
const indoor = field(8, "The allowance applies only to indoor tests.");
const westGate = scan("The west gate closes at 16:30 on Fridays.");
const eastGate = scan("The east gate stays open until 18:00.");
const season = scan("These hours apply from April through September.");

function caseFor(id, route, question, expected, required, scope) {
  return { id, route, question, expected, required, ...scope };
}

const text = (id, page, question, expected, required = []) =>
  caseFor(id, "text", question, expected, required, { file: "field.pdf", page });
const compare = (id, question, expected, required = []) =>
  caseFor(id, "comparison", question, expected, required, { files: ["field.pdf", "replication.pdf"] });
const chart = (id, question, expected) =>
  caseFor(id, "visual", question, expected, [], { file: "visuals.pdf", page: 1, box: [.08, .10, .62, .47] });
const equation = (id, question, expected) =>
  caseFor(id, "visual", question, expected, [], { file: "visuals.pdf", page: 2, box: [.07, .10, .88, .19] });
const guide = (id, start, end, question, expected, required = []) =>
  caseFor(id, "guide", question, expected, required, { file: "field.pdf", start, end });
const scanned = (id, question, expected, required = []) =>
  caseFor(id, "text", question, expected, required, { file: "scan.pdf", page: 1, ocr: "eng" });

module.exports = [
  text("eligible-age", 6, "Who was eligible for the field trial?", ["Adults over 65. Exactly 65 is excluded."], [eligibility]),
  text("duration", 6, "How long did follow-up last?", ["Six weeks."], [enrollment]),
  text("sample-size", 6, "How many people took part?", ["48 people."], [enrollment]),
  text("group-values", 6, "How much did each group improve?", ["Intervention 12 points. Comparison 7 points."], [intervention, control]),
  text("group-difference", 6, "What was the difference in improvement between the groups?", ["5 points, calculated as 12 minus 7."], [intervention, control]),
  text("long-term", 6, "What was the long-term effect?", [], []),
  text("scope-of-conclusion", 6, "Do these findings establish a definitive conclusion?", ["The authors called the findings preliminary."], [cautious]),
  text("absent-person", 6, "Who led the trial?", [], []),
  text("wrong-page", 1, "What is the exact eligibility rule?", [], []),
  text("column-a", 7, "What happened to travel time in experiment A?", ["Travel time fell by 8%."], [travel]),
  text("column-b", 7, "What happened to fuel use in experiment B?", ["Fuel use rose by 8%."], [fuel]),
  text("column-contrast", 7, "Did both experiments measure the same thing?", ["A measured travel time. B measured fuel use."],
    [field(7, "It measured total travel time."), field(7, "It measured fuel use in liters.")]),
  text("negative-number", 8, "What negative change was allowed?", ["Minus 2 degrees, only for indoor tests."],
    [field(8, "A negative change of -2 degrees is allowed."), indoor]),
  text("strict-inequality", 8, "Does the alert trigger if x equals y?", ["No. x must be strictly less than y."], [condition]),
  text("both-conditions", 8, "Explain the alert conditions.", ["x is less than y and y is greater than z. Both are required."], [condition]),
  text("units", 8, "What is the sensor limit in milligrams and micrograms?", ["5 mg, equivalent to 5000 micrograms."], [limit]),
  text("outdoor", 8, "Does the allowance also apply outside?", ["No. The allowance is for indoor tests only."], [indoor]),
  text("partial", 6, "How many people enrolled and what country was the trial in?", ["48 people. The country is unspecified."], [enrollment]),
  compare("retrieval-boilerplate", "Compare study eligibility in the trial and the replication.",
    ["Field trial: adults over 65. Replication: adults ages 18 to 25."], [eligibility, replicationEligibility]),
  compare("opposite-differences", "Compare how the intervention and comparison groups improved in both reports.",
    ["Field trial 12 vs 7 points. Replication 3 vs 4 points."], [intervention, control, replicationMeasure, replicationControl]),
  compare("different-duration", "Compare trial and replication follow-up duration.",
    ["Field trial six weeks. Replication two weeks."], [enrollment, replication("The replication enrolled 31 people and lasted two weeks.")]),
  compare("unsupported-common-cause", "What shared biological cause did both studies demonstrate?", [], []),
  compare("benefit-misattribution", "Did the replication find evidence of an intervention benefit?",
    ["The replication authors did not find evidence of benefit."], [replicationConclusion]),
  guide("guide-supported-summary", 6, 6, "What did the field trial measure and what are its limits?",
    ["Scores over six weeks. Long-term outcomes were unmeasured and the authors called findings preliminary."],
    [enrollment, scope, cautious]),
  guide("guide-comparison", 7, 7, "How did the outcomes differ between the two experiments?",
    ["A measured travel time, down 8%. B measured fuel use, up 8%."], [travel, fuel]),
  guide("guide-absent", 6, 6, "What did the trial report about childhood development?", [], []),
  chart("chart-value", "How much water did Alpha use?", ["4 liters for one cycle."]),
  chart("chart-difference", "How much more water did Beta use than Alpha?", ["2 liters, calculated as 6 minus 4."]),
  chart("chart-units", "What quantity and unit does the selected chart show?", ["Water use in liters."]),
  chart("chart-other-panel", "Does the selected image region show Beta's electricity use?", []),
  equation("equation-change", "What happens to R if time doubles and distance stays fixed?", ["R halves for positive time."]),
  equation("equation-unit", "What units would R have?", ["Meters per second, inferred from the given units."]),
  equation("equation-missing", "What was the recorded time in the experiment?", []),
  scanned("ocr-west", "What time does the west gate close on Fridays?", ["16:30."], [westGate]),
  scanned("ocr-east", "What time does the east gate remain open until?", ["18:00."], [eastGate]),
  scanned("ocr-season", "Which months do these hours apply to?", ["April through September."], [season]),
  scanned("ocr-absent", "What are the gate hours in December?", [], []),
];
