// diagrams/registry.mjs — every diagram layout, in one synchronous map.
//
// Static imports (never readdir) so menu(), validation and compilation stay
// deterministic and synchronous. Add a layout by importing it and adding it here.
import flow from './layouts/process/flow.mjs';
import pipeline from './layouts/process/pipeline.mjs';
import cycle from './layouts/process/cycle.mjs';
import decision from './layouts/process/decision.mjs';
import timeline from './layouts/time/timeline.mjs';
import funnel from './layouts/time/funnel.mjs';
import beforeAfter from './layouts/narrative/before-after.mjs';
import comparison from './layouts/narrative/comparison.mjs';
import hierarchy from './layouts/structure/hierarchy.mjs';
import architecture from './layouts/structure/architecture.mjs';
import relationship from './layouts/structure/relationship.mjs';
import layers from './layouts/structure/layers.mjs';
import table from './layouts/charts/table.mjs';
import lineChart from './layouts/charts/line-chart.mjs';
import areaChart from './layouts/charts/area-chart.mjs';
import scatter from './layouts/charts/scatter.mjs';
import pie from './layouts/charts/pie.mjs';
import stackedBars from './layouts/charts/stacked-bars.mjs';
import waterfall from './layouts/charts/waterfall.mjs';
import sankey from './layouts/charts/sankey.mjs';
import heatmap from './layouts/charts/heatmap.mjs';
import gauge from './layouts/charts/gauge.mjs';
import ranking from './layouts/charts/ranking.mjs';
import bullet from './layouts/charts/bullet.mjs';
import swimlane from './layouts/process/swimlane.mjs';
import sequence from './layouts/process/sequence.mjs';
import stateMachine from './layouts/process/state-machine.mjs';
import forkJoin from './layouts/process/fork-join.mjs';
import approvalChain from './layouts/process/approval-chain.mjs';
import erd from './layouts/structure/erd.mjs';
import dataFlow from './layouts/structure/data-flow.mjs';
import deployment from './layouts/structure/deployment.mjs';
import mindMap from './layouts/structure/mind-map.mjs';
import venn from './layouts/structure/venn.mjs';
import pyramid from './layouts/structure/pyramid.mjs';
import matrix from './layouts/structure/matrix.mjs';
import quadrant from './layouts/structure/quadrant.mjs';
import treemap from './layouts/structure/treemap.mjs';
import gantt from './layouts/time/gantt.mjs';
import calendar from './layouts/time/calendar.mjs';
import milestones from './layouts/time/milestones.mjs';
import journeyMap from './layouts/time/journey-map.mjs';
import flywheel from './layouts/time/flywheel.mjs';
import prosCons from './layouts/narrative/pros-cons.mjs';
import oldVsNew from './layouts/narrative/old-vs-new.mjs';
import iceberg from './layouts/narrative/iceberg.mjs';
import spectrum from './layouts/narrative/spectrum.mjs';
import balance from './layouts/narrative/balance.mjs';
import bullseye from './layouts/narrative/bullseye.mjs';
import annotatedScreenshot from './layouts/interface/annotated-screenshot.mjs';
import wireframe from './layouts/interface/wireframe.mjs';
import code from './layouts/interface/code.mjs';
import terminal from './layouts/interface/terminal.mjs';
import chat from './layouts/interface/chat.mjs';
import post from './layouts/interface/post.mjs';
import map from './layouts/interface/map.mjs';
import lowerThird from './layouts/interface/lower-third.mjs';
import iconGrid from './layouts/interface/icon-grid.mjs';

const LAYOUTS = {
  flow,
  pipeline,
  cycle,
  timeline,
  funnel,
  'before-after': beforeAfter,
  comparison,
  decision,
  hierarchy,
  architecture,
  relationship,
  layers,
  table,
  'line-chart': lineChart,
  'area-chart': areaChart,
  scatter,
  pie,
  'stacked-bars': stackedBars,
  waterfall,
  sankey,
  heatmap,
  gauge,
  ranking,
  bullet,
  swimlane,
  sequence,
  'state-machine': stateMachine,
  'fork-join': forkJoin,
  'approval-chain': approvalChain,
  erd,
  'data-flow': dataFlow,
  deployment,
  'mind-map': mindMap,
  venn,
  pyramid,
  matrix,
  quadrant,
  treemap,
  gantt,
  calendar,
  milestones,
  'journey-map': journeyMap,
  flywheel,
  'pros-cons': prosCons,
  'old-vs-new': oldVsNew,
  iceberg,
  spectrum,
  balance,
  bullseye,
  'annotated-screenshot': annotatedScreenshot,
  wireframe,
  code,
  terminal,
  chat,
  post,
  map,
  'lower-third': lowerThird,
  'icon-grid': iconGrid,
};

export function getLayout(name) {
  return Object.prototype.hasOwnProperty.call(LAYOUTS, name) ? LAYOUTS[name] : null;
}

export function layoutNames() {
  return Object.keys(LAYOUTS);
}

/** The menu summary: what the model is allowed to name. */
export function listLayouts() {
  return Object.values(LAYOUTS).map((l) => ({
    name: l.name,
    what: l.description,
    frame: l.frame,
    fields: l.fields,
  }));
}
