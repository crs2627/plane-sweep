"use strict";

const ui = {
  scene: document.querySelector("#scene"),
  axes: document.querySelector("#axes-layer"),
  segments: document.querySelector("#segments-layer"),
  sweep: document.querySelector("#sweep-layer"),
  intersections: document.querySelector("#intersections-layer"),
  labels: document.querySelector("#labels-layer"),
  currentEvent: document.querySelector("#current-event"),
  eventQueue: document.querySelector("#event-queue"),
  activeOrder: document.querySelector("#active-order"),
  explanation: document.querySelector("#explanation-text"),
  nextButton: document.querySelector("#next-button"),
  resetButton: document.querySelector("#reset-button"),
  stepCount: document.querySelector("#step-count"),
};

let trace = null;
let stepIndex = 0;
let labels = new Map();

const plot = { left: 55, bottom: 470, scale: 36, maxX: 13, maxY: 11 };

function toScreen([x, y]) {
  // SVG y increases downward
  return [plot.left + x * plot.scale, plot.bottom - y * plot.scale];
}

function svgElement(tag, attributes, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  if (text !== undefined) element.textContent = text;
  return element;
}

function drawAxes() {
  ui.axes.replaceChildren();
  const [left, bottom] = toScreen([0, 0]);
  const [right] = toScreen([plot.maxX, 0]);
  const [, top] = toScreen([0, plot.maxY]);
  ui.axes.append(
    svgElement("line", { x1: left, y1: bottom, x2: right, y2: bottom, stroke: "#888" }),
    svgElement("line", { x1: left, y1: bottom, x2: left, y2: top, stroke: "#888" }),
    svgElement("text", { x: right + 15, y: bottom + 5 }, "x"),
    svgElement("text", { x: left - 5, y: top - 15 }, "y"),
  );
  for (let x = 0; x <= plot.maxX; x++) {
    const [sx] = toScreen([x, 0]);
    ui.axes.append(
      svgElement("line", { x1: sx, y1: bottom, x2: sx, y2: bottom + 5, stroke: "#888" }),
      svgElement("text", { x: sx, y: bottom + 23, "text-anchor": "middle" }, x),
    );
  }
  for (let y = 1; y <= plot.maxY; y++) {
    const [, sy] = toScreen([0, y]);
    ui.axes.append(
      svgElement("line", { x1: left - 5, y1: sy, x2: left, y2: sy, stroke: "#888" }),
      svgElement("text", { x: left - 10, y: sy + 5, "text-anchor": "end" }, y),
    );
  }
}

function drawSegments(records, snapshot) {
  const active = new Set(snapshot.active_after);
  const affected = new Set(snapshot.event?.segment_ids ?? []);
  ui.segments.replaceChildren();
  ui.labels.replaceChildren();
  for (const segment of records) {
    const [x1, y1] = toScreen(segment.start);
    const [x2, y2] = toScreen(segment.end);
    const color = affected.has(segment.id) ? "#b45309"
      : active.has(segment.id) ? "#1455b5" : "#777";
    const group = svgElement("g", { id: `segment-${segment.id}` });
    group.append(
      svgElement("title", {}, `${segment.label}: (${segment.start}) to (${segment.end})`),
      svgElement("line", { x1, y1, x2, y2, stroke: color, "stroke-width": affected.has(segment.id) ? 3 : 2 }),
      svgElement("circle", { cx: x1, cy: y1, r: 3, fill: color }),
      svgElement("circle", { cx: x2, cy: y2, r: 3, fill: color }),
    );
    ui.segments.append(group);
    ui.labels.append(svgElement("text", {
      x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 12,
      "text-anchor": "middle",
    }, segment.label));
  }
}

function eventText(event) {
  const names = event.segment_ids.map(id => labels.get(id)).join("/");
  return `${event.type}: ${names} at (${event.point.join(", ")})`;
}

function renderList(element, items) {
  element.replaceChildren();
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    element.append(item);
  }
}

function renderSnapshot() {
  const snapshot = trace.snapshots[stepIndex];
  highlightPseudocode(snapshot.event?.type ?? "initial");
  drawSegments(trace.segments, snapshot);
  ui.sweep.replaceChildren();
  ui.intersections.replaceChildren();
  if (snapshot.sweep_x !== null) {
    const [x, bottom] = toScreen([snapshot.sweep_x, 0]);
    const [, top] = toScreen([0, plot.maxY]);
    ui.sweep.append(svgElement("line", {
      x1: x, y1: top, x2: x, y2: bottom, stroke: "#555",
      "stroke-dasharray": "6 4",
    }));
  }
  for (const point of snapshot.intersections) {
    const [cx, cy] = toScreen(point);
    ui.intersections.append(svgElement("circle", { cx, cy, r: 4, fill: "#14733c" }));
  }
  if (snapshot.event) {
    const [cx, cy] = toScreen(snapshot.event.point);
    ui.intersections.append(svgElement("circle", {
      cx, cy, r: 7, fill: "none", stroke: "#b45309", "stroke-width": 2,
    }));
  }
  ui.currentEvent.textContent = snapshot.event ? eventText(snapshot.event) : "None";
  renderList(ui.eventQueue, snapshot.pending_events.map(eventText));
  renderList(ui.activeOrder, snapshot.active_after.map(id => labels.get(id)));
  document.querySelector("#queue-empty").hidden = snapshot.pending_events.length > 0;
  document.querySelector("#status-empty").hidden = snapshot.active_after.length > 0;
  ui.explanation.textContent = snapshot.explanation;
  ui.stepCount.textContent = `Step ${stepIndex} of ${trace.snapshots.length - 1}`;
  ui.nextButton.disabled = stepIndex === trace.snapshots.length - 1;
  ui.resetButton.disabled = stepIndex === 0;
}

function highlightPseudocode(kind) {
  const descriptions = {
    initial: "Initialization: queue endpoints and start with an empty active order",
    start: "Start event: insert the segment, then fix adjacencies and check neighbors",
    end: "End event: remove the segment, then check the newly exposed neighbors.",
    intersection: "Crossing event: validate the pair, report and swap it, then check new neighbors",
  };
  for (const block of Object.keys(descriptions)) {
    const element = document.querySelector(`#code-${block}`);
    element.classList.toggle("current-code", block === kind);
    if (block === kind) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  }
  document.querySelector("#pseudocode-status").textContent = descriptions[kind];
}

function loadTrace(data) {
  if (data.version !== 1 || !Array.isArray(data.segments)
      || !Array.isArray(data.snapshots) || data.snapshots.length === 0) {
    throw new Error("Expected a version 1 trace with segments and snapshots.");
  }
  trace = data;
  labels = new Map(trace.segments.map(segment => [segment.id, segment.label]));
  stepIndex = 0;
  renderSnapshot();
}

ui.nextButton.addEventListener("click", () => {
  if (trace && stepIndex < trace.snapshots.length - 1) {
    stepIndex++;
    renderSnapshot();
  }
});

ui.resetButton.addEventListener("click", () => {
  if (trace) {
    stepIndex = 0;
    renderSnapshot();
  }
});

const loadStatus = document.querySelector("#load-status");
document.querySelector("#trace-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    loadTrace(JSON.parse(await file.text()));
    loadStatus.textContent = `Loaded ${file.name}.`;
  } catch (error) {
    loadStatus.textContent = `Could not load trace: ${error.message}`;
  }
});

drawAxes();
if (window.location.protocol === "file:") {
  loadStatus.textContent = "Choose trace.json to load the example.";
} else {
  fetch("trace.json")
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      loadTrace(data);
      loadStatus.textContent = "Loaded trace.json.";
    })
    .catch(error => {
      loadStatus.textContent = `Could not load trace.json: ${error.message}. You can choose it below.`;
    });
}
