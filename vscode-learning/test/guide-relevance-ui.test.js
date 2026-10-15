"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createUI() {
  function element(tag = "div") {
    const attributes = {};
    const classes = new Set();
    const node = {
      tag, attributes, children: [], hidden: false, disabled: false,
      textContent: "", value: "", style: { top: "20%" }, dataset: {},
      events: {}, clientHeight: 800, offsetTop: 0,
      classList: { add(k) { classes.add(k); }, remove(k) { classes.delete(k); },
        contains(k) { return classes.has(k); }, toggle(k, yes) {
          if (yes) classes.add(k); else classes.delete(k);
        } },
      setAttribute(k, v) { attributes[k] = String(v); },
      getAttribute(k) { return attributes[k]; },
      addEventListener(k, cb) { this.events[k] = cb; },
      click() { if (!this.disabled && this.events.click) this.events.click(); },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) {
        this.children = children.flatMap(child => child.fragment ? child.children : [child]);
      },
      querySelectorAll(selector) {
        if (selector === "button") return this.children.filter(n => n.tag === "button");
        if (selector === ".word.guided") return this.children.filter(n => n.classList.contains("guided"));
        return [];
      },
      scrollTo(position) { this.lastScroll = position; }
    };
    return node;
  }
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) {
      const node = element();
      if (["guidePanel","guideBroaderSection","guideBroaderSteps","guideReviewInfo",
           "guideActive","guideResults"].includes(id)) node.hidden = true;
      elements.set(id, node);
    }
    return elements.get(id);
  };
  const messages = [];
  const overlay = element("overlay");
  overlay.children = Array.from({length:10}, () => element("word"));
  const stage = element("stage");
  stage.parentElement = element("reader");
  const sandbox = {};
  const document = {
    createElement: tag => element(tag),
    createDocumentFragment() {
      const f = element("fragment");
      f.fragment = true;
      return f;
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "../media/guide-viewer.js"), "utf8");
  vm.runInNewContext(source, { globalThis: sandbox, document,
    setTimeout: () => ({timer:true}), clearTimeout: () => {} });
  const viewer = sandbox.setupPrecisionPDFGuided({
    host: {postMessage: value => messages.push(value)}, el, overlay, stage
  });
  el("guidedMode").click();
  return { el, viewer, overlay, messages };
}

const guidePlan = (direct, broad) => {
  const steps = [];
  for (let i = 0; i < direct + broad; i++) steps.push({
    evidenceId: "p1-w" + i, page: 1, start_word: i, end_word: i,
    quote: "word" + i, section:"Reading One", explanation: "Explanation " + i,
    why:"Reason " + i, reviewReason:"Review " + i,
    relevance: i < direct ? "direct" : "broader"
  });
  return {type:"guided",overview:"Direct summary",pages:2,steps,
    directCount:direct,broaderCount:broad,rejectedCount:1};
};

test("default tour lists only direct passages and keeps broader evidence hidden", () => {
  const {el,viewer}=createUI();
  assert.equal(viewer.onMessage({type:"guide-plan",plan:guidePlan(1,2)}),true);
  assert.equal(el("guideSteps").children.length,1);
  assert.equal(el("guideBroaderSteps").children.length,2);
  assert.equal(el("guideBroaderSteps").hidden,true);
  assert.equal(el("guideBroaderSection").hidden,false);
  assert.equal(el("guidePlay").disabled,false);
  assert.match(el("guideStatus").textContent,/1 direct, 2 optional broader, 1 excluded/);
  assert.equal(el("guideReviewInfo").hidden,false);
  assert.match(el("guideReviewInfo").textContent,/AI judgments/);
  assert.match(el("guideReviewInfo").textContent,/contextual examples/);
});

test("broader evidence requires an explicit opt-in and can be hidden again", () => {
  const {el,viewer,messages,overlay}=createUI();
  viewer.onMessage({type:"guide-plan",plan:guidePlan(1,1)});
  el("guideNext").click();
  assert.equal(messages.length,0);
  el("guideBroaderToggle").click();
  assert.equal(el("guideBroaderSteps").hidden,false);
  assert.equal(el("guideBroaderToggle").getAttribute("aria-expanded"),"true");
  el("guideBroaderSteps").children[0].click();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:"guideGoto",number:1});
  viewer.onMessage({type:"guide-activate",number:1,step:guidePlan(1,1).steps[1]});
  assert.match(el("guideEvidenceReview").textContent,/broader connection/);
  assert.equal(overlay.children[1].classList.contains("guided"),true);
  el("guideBroaderToggle").click();
  assert.equal(el("guideBroaderSteps").hidden,true);
  assert.equal(overlay.children[1].classList.contains("guided"),false);
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:"guideGoto",number:0});
});

test("no direct evidence means no automatic highlight or playback", () => {
  const {el,viewer,messages}=createUI();
  viewer.onMessage({type:"guide-plan",plan:guidePlan(0,1)});
  assert.equal(el("guideSteps").children.length,0);
  assert.equal(el("guidePlay").disabled,true);
  assert.equal(el("guideActive").hidden,true);
  assert.match(el("guideReviewInfo").textContent,/No passage directly explained/);
  assert.equal(messages.length,0);
  el("guideBroaderToggle").click();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:"guideGoto",number:0});
});

test("exact match path remains separate from AI review categories", () => {
  const {el,viewer}=createUI();
  const plan={type:"exact",pages:1,overview:"Found 1 exact occurrence",totalMatches:1,
    shownMatches:1,pageCount:1,steps:[{evidenceId:"exact-p1-w0",page:1,start_word:0,
      end_word:0,quote:"black",context:"a black box"}]};
  viewer.onMessage({type:"guide-plan",plan});
  assert.equal(el("guideBroaderSection").hidden,true);
  assert.equal(el("guideReviewInfo").hidden,true);
  assert.equal(el("guideSteps").children.length,1);
  assert.match(el("guideStatus").textContent,/1 exact match on 1 page/);
});

test("existing playback still uses a 12-second step interval", () => {
  const code=fs.readFileSync(path.join(__dirname,"../media/guide-viewer.js"),"utf8");
  assert.match(code,/setTimeout\(\(\) => go\(guide.index \+ 1\), 12000\)/);
});

test("active headings count direct and broader evidence separately", () => {
  const {el,viewer}=createUI();
  const plan=guidePlan(2,3);
  viewer.onMessage({type:"guide-plan",plan});
  viewer.onMessage({type:"guide-activate",number:0,step:plan.steps[0]});
  assert.match(el("guideActiveTitle").textContent,/Direct evidence 1 of 2 · PDF page 1/);
  assert.match(el("guideSteps").children[1].textContent,/Direct evidence 2 · Page 1/);
  assert.doesNotMatch(el("guideActiveTitle").textContent,/1 of 5/);
  el("guideBroaderToggle").click();
  viewer.onMessage({type:"guide-activate",number:2,step:plan.steps[2]});
  assert.match(el("guideActiveTitle").textContent,/Broader connection 1 of 3/);
  assert.match(el("guideBroaderSteps").children[0].textContent,/Broader connection 1 · Page 1/);
});

test("a guide with zero broader connections has no optional section", () => {
  const {el,viewer}=createUI();
  const plan=guidePlan(2,0);
  viewer.onMessage({type:"guide-plan",plan});
  assert.equal(el("guideBroaderSection").hidden,true);
  assert.equal(el("guideSteps").children.length,2);
  viewer.onMessage({type:"guide-activate",number:1,step:plan.steps[1]});
  assert.match(el("guideActiveTitle").textContent,/Direct evidence 2 of 2/);
});

test("guided overview and context are labeled distinctly from exact search", () => {
  const {el,viewer}=createUI();
  const plan=guidePlan(1,1);
  plan.overview="Neural networks can be difficult to interpret.";
  viewer.onMessage({type:"guide-plan",plan});
  assert.equal(el("guideOverviewTitle").textContent,"Answer from reviewed direct evidence");
  assert.equal(el("guideOverview").textContent,plan.overview);
  assert.equal(el("guideListTitle").textContent,"Direct explanations (AI-reviewed)");
  viewer.onMessage({type:"guide-activate",number:0,step:plan.steps[0]});
  assert.match(el("guideEvidenceRelation").textContent,/How this answers your question:/);
  el("guideBroaderToggle").click();
  viewer.onMessage({type:"guide-activate",number:1,step:plan.steps[1]});
  assert.match(el("guideEvidenceRelation").textContent,/Contextual connection \(not direct proof\):/);
  assert.match(el("guideBroaderToggle").textContent,/contextual examples/);
});
