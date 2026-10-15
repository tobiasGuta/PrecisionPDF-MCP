"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareBatches, readModelJson, candidatePrompt, synthesisPrompt, reviewPrompt, generateGuide } = require("../guide");

function fakeIndex() {
  return { pages: 2, complete: true, sha256: "a".repeat(64), page_word_counts: [8, 5],
    excerpts: [
      { id: "p1-w0", page: 1, start_word: 0, end_word: 7,
        text: "Neural networks are opaque and difficult to explain.", boundary: "sentence", section: "Interpretability" },
      { id: "p2-w0", page: 2, start_word: 0, end_word: 4,
        text: "Opacity raises important accountability concerns.", boundary: "sentence", section: "Governance" }
    ] };
}
function finding(id, relevance, idea = "relevant") {
  return { evidenceId:id, relevance, idea, why:"This quote concerns " + idea };
}
function step(id, relevance, explanation = "Explains the evidence.") {
  return { evidenceId:id, relevance, explanation, why:"The text directly discusses " + explanation };
}
function modelSequence(...objects) {
  let calls=0;
  const prompts=[];
  return { prompts, get calls(){return calls},
    sendModel: async prompt => {
      prompts.push(prompt);
      if (calls >= objects.length) throw new Error("unexpected extra model request");
      return JSON.stringify(objects[calls++]);
    } };
}
function standardSequence() {
  return modelSequence(
    { findings: [finding("p1-w0","direct","opacity"), finding("p2-w0","broader","governance")] },
    { overview:"Raw summary should not automatically include broader material.",
      steps: [step("p1-w0","direct","Neural networks are difficult to interpret."),
        step("p2-w0","broader","Companies face accountability questions.")] },
    { reviews:[{evidenceId:"p1-w0",decision:"direct",reason:"Specifically discusses opacity."},
      {evidenceId:"p2-w0",decision:"broader",reason:"Accountability is a downstream concern of opacity.",
        bridgeQuote:"Opacity raises important accountability concerns.",
        link:"Opacity and model interpretability create accountability concerns in deployments."}] }
  );
}

test("batch format preserves exact source IDs and page references", () => {
  const batches=prepareBatches(fakeIndex());
  assert.equal(batches.length,1);
  assert.match(batches[0],/p1-w0 \[PDF page 1\]/);
  assert.match(batches[0],/PDF outline: Interpretability/);
  assert.match(batches[0],/p2-w0 \[PDF page 2\]/);
});
test("index validation rejects malformed coordinates, IDs and metadata", () => {
  const idx=fakeIndex();idx.complete=false;
  assert.throws(()=>prepareBatches(idx),/Incomplete/);
  idx.complete=true;idx.excerpts.push({...idx.excerpts[0]});
  assert.throws(()=>prepareBatches(idx),/duplicate/);
  idx.excerpts.pop();idx.excerpts[0].end_word=100;
  assert.throws(()=>prepareBatches(idx),/Invalid/);
  idx.excerpts[0].end_word=7;idx.excerpts[0].boundary="invented";
  assert.throws(()=>prepareBatches(idx),/Invalid/);
  idx.excerpts[0].boundary="sentence";idx.excerpts[0].section="X".repeat(141);
  assert.throws(()=>prepareBatches(idx),/Invalid/);
});
test("structured response parser is strict and accepts JSON code fences", () => {
  assert.deepEqual(readModelJson('```json\n{"findings":[]}\n```'),{findings:[]});
  assert.throws(()=>readModelJson("unstructured text"),/structured/);
  assert.throws(()=>readModelJson('{"findings":[]} extra'),/structured/);
});
test("reviewed guide keeps directly supported steps first and broader steps optional", async () => {
  const model=standardSequence();
  const result=await generateGuide({index:fakeIndex(),question:"Why are neural nets black boxes?",sendModel:model.sendModel});
  assert.equal(model.calls,3);
  assert.equal(result.type,"guided");
  assert.equal(result.directCount,1);
  assert.equal(result.broaderCount,1);
  assert.equal(result.rejectedCount,0);
  assert.deepEqual(result.steps.map(x=>x.relevance),["direct","broader"]);
  assert.deepEqual(result.steps.map(x=>x.page),[1,2]);
  assert.match(result.steps[0].reviewReason,/opacity/);
  assert.match(result.overview,/difficult to interpret/);
  assert.doesNotMatch(result.overview,/accountability|Raw summary/i);
  assert.equal(result.steps[0].quote,fakeIndex().excerpts[0].text);
  assert.match(model.prompts[0],/Direct means this excerpt addresses/);
  assert.match(model.prompts[1],/Broader connections require specific evidence-based links/);
  assert.match(model.prompts[2],/skeptical EVIDENCE REVIEWER/);
});
test("a skeptical review may downgrade an apparent direct claim", async () => {
  const model=modelSequence(
    { findings:[finding("p1-w0","direct")] },
    { overview:"",steps:[step("p1-w0","direct")] },
    { reviews:[{evidenceId:"p1-w0",decision:"broader",reason:"It offers context on explainability.",
       bridgeQuote:"Neural networks are opaque and difficult to explain.",
       link:"The opacity of neural networks is broader context for why model behavior can be unclear."}] }
  );
  const result=await generateGuide({index:fakeIndex(),question:"Why are neural nets black boxes?",sendModel:model.sendModel});
  assert.equal(result.directCount,0);
  assert.equal(result.broaderCount,1);
  assert.match(result.overview,/No directly supported answer/);
  assert.equal(result.steps[0].relevance,"broader");
});
test("neither synthesis nor reviewer can upgrade candidate broader evidence", async () => {
  const model=modelSequence(
    { findings:[finding("p2-w0","broader")] },
    { overview:"",steps:[step("p2-w0","direct")] },
    { reviews:[{evidenceId:"p2-w0",decision:"direct",reason:"Interpretability concern is contextual.",
       bridgeQuote:"Opacity raises important accountability concerns.",
       link:"Opacity and interpretability connect to accountability risks as contextual consequences."}] }
  );
  const result=await generateGuide({index:fakeIndex(),question:"Why are neural nets black boxes?",sendModel:model.sendModel});
  assert.equal(result.directCount,0);
  assert.equal(result.steps[0].relevance,"broader");
});
test("explicitly rejected, duplicated and omitted reviews cannot appear", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct"),finding("p2-w0","direct")]},
    {overview:"",steps:[step("p1-w0","direct"),step("p2-w0","direct")]},
    {reviews:[{evidenceId:"p1-w0",decision:"direct",reason:"Supported."},
      {evidenceId:"p2-w0",decision:"reject",reason:"Off topic."},
      {evidenceId:"p1-w0",decision:"direct",reason:"Duplicate."}]}
  );
  const result=await generateGuide({index:fakeIndex(),question:"What does it explain?",sendModel:model.sendModel});
  assert.equal(result.directCount,1);
  assert.equal(result.broaderCount,0);
  assert.equal(result.rejectedCount,1);
  assert.deepEqual(result.steps.map(x=>x.evidenceId),["p1-w0"]);
});
test("missing review decisions and unsupported review IDs are fail-closed", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct")]},
    {overview:"",steps:[step("p1-w0","direct")]},
    {reviews:[{evidenceId:"p999-w0",decision:"direct",reason:"fabricated"}]}
  );
  await assert.rejects(generateGuide({index:fakeIndex(),question:"why?",sendModel:model.sendModel}),/review rejected all passages/);
});
test("relevance claims without a meaningful rationale are omitted", async () => {
  const model=modelSequence(
    {findings:[{evidenceId:"p1-w0",idea:"opaque",relevance:"direct",why:""}]},
  );
  await assert.rejects(generateGuide({index:fakeIndex(),question:"Why?",sendModel:model.sendModel}),/No sufficiently relevant/);
});
test("review rejection of all steps doesn't create an unsupported tour", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct")]},
    {overview:"",steps:[step("p1-w0","direct")]},
    {reviews:[{evidenceId:"p1-w0",decision:"reject",reason:"Explanation was not supported."}]}
  );
  await assert.rejects(generateGuide({index:fakeIndex(),question:"Why?",sendModel:model.sendModel}),/review rejected all/);
});
test("invented candidate and synthesis IDs are never highlighted", async () => {
  const noCandidates=modelSequence({findings:[finding("p404-w0","direct")]});
  await assert.rejects(generateGuide({index:fakeIndex(),question:"Why?",sendModel:noCandidates.sendModel}),/No sufficiently relevant/);
  const synthetic=modelSequence(
    {findings:[finding("p1-w0","direct")]},
    {overview:"",steps:[step("p404-w0","direct")]}
  );
  await assert.rejects(generateGuide({index:fakeIndex(),question:"Why?",sendModel:synthetic.sendModel}),/did not provide relevant/);
});
test("invalid or missing review structure fails without relying on false certainty", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct")]},
    {overview:"",steps:[step("p1-w0","direct")]},
    {foo:"bar"}
  );
  await assert.rejects(generateGuide({index:fakeIndex(),question:"Why?",sendModel:model.sendModel}),/invalid relevance review/);
});
test("different PDF reading sections pass through into reviewed evidence", async () => {
  const model=standardSequence();
  const result=await generateGuide({index:fakeIndex(),question:"Why are neural nets black boxes?",sendModel:model.sendModel});
  assert.deepEqual(result.steps.map(x=>x.section),["Interpretability","Governance"]);
  assert.deepEqual(result.steps.map(x=>x.boundary),["sentence","sentence"]);
  assert.match(model.prompts[1],/independent readings/);
});
test("the reviewer sees exact quotes and is explicitly told to reject topic drift", () => {
  const prompt=reviewPrompt("Interpretability",[{evidenceId:"p1-w0",quote:"Models cannot be explained.",
    explanation:"Opaque systems.",relevance:"direct",why:"Quote explains issue."}]);
  assert.match(prompt,/Models cannot be explained/);
  assert.match(prompt,/Reject: topical drift/);
  assert.match(prompt,/EVIDENCE REVIEWER/);
  assert.match(candidatePrompt("test","p1-w0: source",1,1),/Do not fill a quota/);
  assert.match(synthesisPrompt("test",[],3),/fewer is better/);
});

test("focused query excludes off-topic environmental passages before synthesis", async () => {
  const idx=fakeIndex();
  idx.excerpts[1].text="Data centers consume massive water resources.";
  const model=modelSequence(
    {findings:[finding("p1-w0","direct","opacity"),finding("p2-w0","broader","water consumption")]},
    {overview:"Two themes",steps:[step("p1-w0","direct","Opacity can make systems difficult to explain.")]},
    {reviews:[{evidenceId:"p1-w0",decision:"direct",reason:"The quote states the networks are opaque."}]}
  );
  const guide=await generateGuide({index:idx,question:"What is the black box problem?",sendModel:model.sendModel});
  assert.equal(guide.directCount,1);
  assert.equal(guide.broaderCount,0);
  assert.equal(guide.rejectedCount,1);
  assert.doesNotMatch(JSON.stringify(guide),/water consumption|Data centers/);
  assert.doesNotMatch(model.prompts[1],/Data centers/);
});

test("zero broader connections is a valid result", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct","opacity")]},
    {overview:"Opacity",steps:[step("p1-w0","direct","Networks are opaque.")]},
    {reviews:[{evidenceId:"p1-w0",decision:"direct",reason:"Source defines opacity."}]}
  );
  const result=await generateGuide({index:fakeIndex(),question:"black box",sendModel:model.sendModel});
  assert.equal(result.directCount,1);
  assert.equal(result.broaderCount,0);
  assert.equal(result.steps.length,1);
});

test("reject broader claims without an exact source quote and specific semantic bridge", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct","opacity"),finding("p2-w0","broader","accountability")]},
    {overview:"",steps:[step("p1-w0","direct"),step("p2-w0","broader")]},
    {reviews:[
      {evidenceId:"p1-w0",decision:"direct",reason:"Clear evidence."},
      {evidenceId:"p2-w0",decision:"broader",reason:"Related to opacity.",
       bridgeQuote:"Nonexistent invented sentence",
       link:"Opacity is a source of accountability questions in interpretability."}
    ]}
  );
  const result=await generateGuide({index:fakeIndex(),question:"black box",sendModel:model.sendModel});
  assert.equal(result.directCount,1);
  assert.equal(result.broaderCount,0);
  assert.equal(result.rejectedCount,1);
});

test("broader reviewer cannot describe a passage as directly answering the question", async () => {
  const model=modelSequence(
    {findings:[finding("p1-w0","direct","opacity"),finding("p2-w0","broader","accountability")]},
    {overview:"",steps:[step("p1-w0","direct"),step("p2-w0","broader","This directly answers the question.")]},
    {reviews:[
      {evidenceId:"p1-w0",decision:"direct",reason:"Relevant evidence."},
      {evidenceId:"p2-w0",decision:"broader",reason:"This directly answers the question.",
       bridgeQuote:"Opacity raises important accountability concerns.",
       link:"Opacity and interpretability are linked with accountability concerns."}
    ]}
  );
  const result=await generateGuide({index:fakeIndex(),question:"black box",sendModel:model.sendModel});
  assert.equal(result.broaderCount,0);
  assert.equal(result.rejectedCount,1);
});

test("accepted broader steps use reviewer connection rather than misleading drafted claims", async () => {
  const m=standardSequence();
  const result=await generateGuide({index:fakeIndex(),question:"black box",sendModel:m.sendModel});
  assert.equal(result.broaderCount,1);
  assert.match(result.steps[1].explanation,/^Related context:/);
  assert.doesNotMatch(result.steps[1].explanation,/directly answers/i);
  assert.equal(result.steps[1].why,"Opacity and model interpretability create accountability concerns in deployments.");
  assert.match(m.prompts[2],/bridgeQuote/);
});
